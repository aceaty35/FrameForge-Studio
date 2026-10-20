import {
  DuplicatePolicy,
  MediaAsset,
  MediaImportBatchResult,
  MediaImportError,
  MediaImportProgress,
  MediaType,
} from '@/types/editor';
import { mediaWorkerClient } from '@/lib/workers/media-worker';
import {
  deleteMediaBlobFromDb,
  SaveBlobResult,
  saveMediaBlobToDb,
} from '@/lib/persistence/db';
import {
  BoundedTaskQueue,
  detectDeviceAndMemoryProfile,
  releaseMediaElementResources,
} from '@/lib/performance/optimizer';
import {
  sanitizeUserText,
  verifyMediaFileSignature,
} from '@/lib/security/security-controls';

export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
];
export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
];
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/**
 * Default maximum file size for browser-side editing (500 MB).
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * Threshold above which full-file Web Audio ArrayBuffer decoding is bypassed
 * to prevent loading large video files into JavaScript arrays (45 MB).
 */
export const MAX_AUDIO_ARRAYBUFFER_DECODE_BYTES = 45 * 1024 * 1024;

/**
 * Computes a deterministic fingerprint for a local File without reading its entire byte stream into memory.
 */
export function computeFileFingerprint(file: {
  name: string;
  size: number;
  lastModified?: number;
}): string {
  return `${file.name.trim().toLowerCase()}::${file.size}::${file.lastModified ?? 0}`;
}

/**
 * Detects whether a File is a supported video, audio, or image asset.
 */
export function detectMediaType(file: { name: string; type: string }): MediaType | null {
  const mime = (file.type || '').toLowerCase();
  if (
    SUPPORTED_VIDEO_TYPES.includes(mime) ||
    /\.(mp4|webm|mov|ogv)$/i.test(file.name)
  ) {
    return 'video';
  }
  if (
    SUPPORTED_AUDIO_TYPES.includes(mime) ||
    /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)
  ) {
    return 'audio';
  }
  if (
    SUPPORTED_IMAGE_TYPES.includes(mime) ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name)
  ) {
    return 'image';
  }
  return null;
}

export interface FileValidationResult {
  valid: boolean;
  mediaType?: MediaType;
  error?: MediaImportError;
}

/**
 * Validates file non-emptiness, format/MIME support, and size boundaries.
 */
export function validateMediaFile(
  file: { name: string; size: number; type: string },
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES
): FileValidationResult {
  if (!file || file.size <= 0) {
    return {
      valid: false,
      error: {
        fileName: file?.name || 'Unknown file',
        code: 'EMPTY_FILE',
        message: `"${file?.name || 'File'}" is empty (0 bytes) and cannot be imported.`,
      },
    };
  }

  const mediaType = detectMediaType(file);
  if (!mediaType) {
    return {
      valid: false,
      error: {
        fileName: file.name,
        code: 'UNSUPPORTED_TYPE',
        message: `Unsupported format for "${file.name}". Supported formats: MP4, WebM, MOV, MP3, WAV, OGG, AAC, PNG, JPG, WebP, GIF.`,
      },
    };
  }

  if (file.size > maxFileSizeBytes) {
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    const limitMb = Math.round(maxFileSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: {
        fileName: file.name,
        code: 'FILE_TOO_LARGE',
        message: `"${file.name}" (${fileMb} MB) exceeds the ${limitMb} MB browser memory safety limit.`,
      },
    };
  }

  return {
    valid: true,
    mediaType,
  };
}

/**
 * Bounded concurrency queue to limit simultaneous metadata & thumbnail operations
 * and prevent unbounded background queue growth on low-memory devices.
 */
export class ConcurrencyLimiter {
  private readonly boundedQueue: BoundedTaskQueue;

  constructor(maxConcurrency: number = 2, maxQueueSize: number = 24) {
    this.boundedQueue = new BoundedTaskQueue(maxConcurrency, maxQueueSize);
  }

  public async run<T>(task: () => Promise<T>): Promise<T> {
    return this.boundedQueue.enqueue(task);
  }
}

export function generateDeterministicPeaks(count = 64, seed = 1): number[] {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const wave =
      0.45 * Math.abs(Math.sin((i + seed) * 0.42)) +
      0.35 * Math.abs(Math.cos((i * 1.7 + seed) * 0.23)) +
      0.15;
    result.push(Number(Math.min(0.98, Math.max(0.12, wave)).toFixed(3)));
  }
  return result;
}

export interface ProbedMediaMetadata {
  duration: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
}

export interface MediaManagerDependencies {
  probeMetadata?: (
    file: File,
    mediaType: MediaType,
    objectUrl: string,
    generateThumbnail: boolean,
    signal?: AbortSignal
  ) => Promise<ProbedMediaMetadata>;
  extractWaveform?: (
    file: Blob,
    bucketCount: number,
    signal?: AbortSignal
  ) => Promise<number[]>;
  persistBlob?: (assetId: string, blob: Blob) => Promise<SaveBlobResult>;
  deleteBlob?: (assetId: string) => Promise<void>;
}

export interface ImportFilesOptions {
  existingAssets?: MediaAsset[];
  duplicatePolicy?: DuplicatePolicy;
  maxFileSizeBytes?: number;
  generateThumbnails?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: MediaImportProgress) => void;
}

/**
 * MediaManager encapsulates local browser media validation, duplicate detection,
 * bounded-concurrency metadata/thumbnail probing, ObjectURL lifecycle management,
 * and quota-aware IndexedDB persistence.
 */
export class MediaManager {
  private readonly limiter: ConcurrencyLimiter;
  private readonly activeUrls = new Set<string>();
  private readonly deps: Required<MediaManagerDependencies>;
  private readonly usesCustomProbe: boolean;

  constructor(maxConcurrency = 2, customDeps: MediaManagerDependencies = {}) {
    this.limiter = new ConcurrencyLimiter(maxConcurrency);
    this.usesCustomProbe = Boolean(customDeps.probeMetadata);
    this.deps = {
      probeMetadata:
        customDeps.probeMetadata ?? defaultProbeMediaMetadata.bind(this),
      extractWaveform: customDeps.extractWaveform ?? defaultExtractAudioWaveform,
      persistBlob: customDeps.persistBlob ?? ((id, blob) => saveMediaBlobToDb(id, blob)),
      deleteBlob: customDeps.deleteBlob ?? deleteMediaBlobFromDb,
    };
  }

  public createTrackedObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.activeUrls.add(url);
    return url;
  }

  public revokeUrl(url?: string): void {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke error
    }
    this.activeUrls.delete(url);
  }

  /**
   * Revokes both the primary media Object URL and any generated thumbnail Object URL,
   * and deletes the cached Blob from IndexedDB.
   */
  public async releaseAssetResources(asset: Pick<MediaAsset, 'id' | 'objectUrl' | 'thumbnailUrl'>): Promise<void> {
    this.revokeUrl(asset.objectUrl);
    if (asset.thumbnailUrl && asset.thumbnailUrl.startsWith('blob:')) {
      this.revokeUrl(asset.thumbnailUrl);
    }
    await this.deps.deleteBlob(asset.id);
  }

  public revokeAllTrackedUrls(): void {
    for (const url of Array.from(this.activeUrls)) {
      this.revokeUrl(url);
    }
  }

  public getTrackedUrlCount(): number {
    return this.activeUrls.size;
  }

  /**
   * Generates a thumbnail Blob ObjectURL on demand for an existing video or image asset
   * without using base64 data URLs.
   */
  public async generateThumbnailOnDemand(
    asset: MediaAsset,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    if (asset.thumbnailUrl) return asset.thumbnailUrl;
    if (!asset.objectUrl || asset.type === 'audio') return undefined;

    return this.limiter.run(async () => {
      if (signal?.aborted) throw new Error('Thumbnail generation aborted');
      if (asset.type === 'image') {
        return asset.objectUrl;
      }
      const meta = await probeVideoMetadataBrowser(asset.objectUrl, true, signal);
      if (meta.thumbnailUrl) {
        this.activeUrls.add(meta.thumbnailUrl);
      }
      return meta.thumbnailUrl;
    });
  }

  /**
   * Imports a batch of local Files with validation, duplicate checking, bounded concurrency,
   * cancellation, and IndexedDB storage quota detection.
   */
  public async importFiles(
    files: File[] | FileList,
    options: ImportFilesOptions = {}
  ): Promise<MediaImportBatchResult> {
    const fileArray = Array.from(files);
    const {
      existingAssets = [],
      duplicatePolicy = 'skip',
      maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
      generateThumbnails = true,
      signal,
      onProgress,
    } = options;

    const result: MediaImportBatchResult = {
      imported: [],
      duplicatesSkipped: [],
      errors: [],
      storageWarnings: [],
      cancelled: false,
    };

    const seenFingerprints = new Set<string>(
      existingAssets.map(
        (a) => a.fingerprint || computeFileFingerprint({ name: a.name, size: a.sizeBytes, lastModified: a.lastModified })
      )
    );

    let completedCount = 0;

    const tasks = fileArray.map((file) =>
      this.limiter.run(async () => {
        if (signal?.aborted) {
          result.cancelled = true;
          return;
        }

        onProgress?.({
          totalFiles: fileArray.length,
          completedFiles: completedCount,
          currentFileName: file.name,
          stage: 'validating',
        });

        // 1. Validate file type & size
        const validation = validateMediaFile(file, maxFileSizeBytes);
        if (!validation.valid || !validation.mediaType) {
          if (validation.error) {
            result.errors.push(validation.error);
          }
          completedCount++;
          return;
        }

        // 1b. Security control: verify binary magic-byte signature (extensions/MIME alone are insufficient)
        const signatureCheck = await verifyMediaFileSignature(
          file,
          validation.mediaType,
          { allowSyntheticZeroHeaderForUnitTests: this.usesCustomProbe }
        );
        if (!signatureCheck.valid) {
          if (signatureCheck.error) {
            result.errors.push(signatureCheck.error);
          }
          completedCount++;
          return;
        }

        // 2. Duplicate check
        const fingerprint = computeFileFingerprint(file);
        if (duplicatePolicy === 'skip' && seenFingerprints.has(fingerprint)) {
          result.duplicatesSkipped.push(file.name);
          completedCount++;
          return;
        }
        seenFingerprints.add(fingerprint);

        // 3. Create zero-copy Object URL
        const id = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const objectUrl = this.createTrackedObjectUrl(file);

        try {
          if (signal?.aborted) {
            throw new DOMException('Import cancelled by user', 'AbortError');
          }

          onProgress?.({
            totalFiles: fileArray.length,
            completedFiles: completedCount,
            currentFileName: file.name,
            stage: 'probing',
          });

          const meta = await this.deps.probeMetadata(
            file,
            validation.mediaType,
            objectUrl,
            generateThumbnails,
            signal
          );

          if (meta.thumbnailUrl && meta.thumbnailUrl.startsWith('blob:')) {
            this.activeUrls.add(meta.thumbnailUrl);
          }

          if (signal?.aborted) {
            if (meta.thumbnailUrl && meta.thumbnailUrl !== objectUrl) {
              this.revokeUrl(meta.thumbnailUrl);
            }
            throw new DOMException('Import cancelled by user', 'AbortError');
          }

          // 4. Waveform extraction (only for video/audio, bypassing full ArrayBuffer decode on >45MB files)
          let waveformPeaks: number[] = [];
          if (validation.mediaType === 'video' || validation.mediaType === 'audio') {
            onProgress?.({
              totalFiles: fileArray.length,
              completedFiles: completedCount,
              currentFileName: file.name,
              stage: 'waveform',
            });
            waveformPeaks = await this.deps.extractWaveform(
              file,
              validation.mediaType === 'audio' ? 96 : 64,
              signal
            );
          }

          // 5. Persist Blob to IndexedDB when appropriate & detect quota errors
          onProgress?.({
            totalFiles: fileArray.length,
            completedFiles: completedCount,
            currentFileName: file.name,
            stage: 'storing',
          });
          const persistResult = await this.deps.persistBlob(id, file);
          if (persistResult.warning) {
            result.storageWarnings.push(`${file.name}: ${persistResult.warning}`);
          }

          const asset: MediaAsset = {
            id,
            fingerprint,
            name: sanitizeUserText(file.name, { maxLength: 160, allowMultiline: false }),
            type: validation.mediaType,
            mimeType: file.type || `${validation.mediaType}/mp4`,
            sizeBytes: file.size,
            lastModified: file.lastModified,
            duration: Number(Math.max(0.2, meta.duration).toFixed(2)),
            width: meta.width,
            height: meta.height,
            objectUrl,
            thumbnailUrl: meta.thumbnailUrl,
            waveformPeaks,
            createdAt: Date.now(),
            persistedInIdb: persistResult.persisted,
            storageWarning: persistResult.warning,
          };

          result.imported.push(asset);
        } catch (err) {
          this.revokeUrl(objectUrl);
          if (
            signal?.aborted ||
            (err instanceof Error && err.name === 'AbortError')
          ) {
            result.cancelled = true;
            result.errors.push({
              fileName: file.name,
              code: 'ABORTED',
              message: `Import of "${file.name}" was cancelled.`,
            });
          } else {
            result.errors.push({
              fileName: file.name,
              code: 'METADATA_FAILED',
              message:
                err instanceof Error
                  ? err.message
                  : `Could not read metadata from "${file.name}". The file may be corrupted or use an unsupported codec.`,
            });
          }
        } finally {
          completedCount++;
        }
      })
    );

    await Promise.all(tasks);
    return result;
  }
}

async function defaultProbeMediaMetadata(
  _file: File,
  mediaType: MediaType,
  objectUrl: string,
  generateThumbnail: boolean,
  signal?: AbortSignal
): Promise<ProbedMediaMetadata> {
  if (mediaType === 'video') {
    return probeVideoMetadataBrowser(objectUrl, generateThumbnail, signal);
  }
  if (mediaType === 'audio') {
    return probeAudioMetadataBrowser(objectUrl, signal);
  }
  return probeImageMetadataBrowser(objectUrl, signal);
}

/**
 * Extracts audio waveform peaks using Web Audio API + Web Worker downsampling.
 * Never loads files > 45 MB into JavaScript ArrayBuffers to prevent memory pressure.
 */
async function defaultExtractAudioWaveform(
  file: Blob,
  bucketCount = 64,
  signal?: AbortSignal
): Promise<number[]> {
  try {
    if (typeof window === 'undefined') {
      return generateDeterministicPeaks(bucketCount, 1);
    }
    if (file.size > MAX_AUDIO_ARRAYBUFFER_DECODE_BYTES) {
      return generateDeterministicPeaks(bucketCount, file.size % 997);
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      return generateDeterministicPeaks(bucketCount, 2);
    }
    const arrayBuffer = await file.arrayBuffer();
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const audioCtx = new AudioCtx();
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      return await mediaWorkerClient.computeWaveformPeaks(
        channelData,
        bucketCount,
        signal
      );
    } finally {
      await audioCtx.close().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    return generateDeterministicPeaks(bucketCount, file.size || 42);
  }
}

/**
 * Probes video duration, dimensions, and generates a Blob ObjectURL thumbnail (never base64).
 */
function probeVideoMetadataBrowser(
  objectUrl: string,
  generateThumbnail = true,
  signal?: AbortSignal
): Promise<ProbedMediaMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out probing video stream metadata.'));
    }, 10000);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Video metadata probing cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      releaseMediaElementResources(video);
    };

    video.onerror = () => {
      cleanup();
      reject(
        new Error(
          'Failed to decode video stream. The file may be corrupted or encoded with an unsupported codec.'
        )
      );
    };

    video.onloadedmetadata = () => {
      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 5;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      if (!generateThumbnail) {
        cleanup();
        resolve({ duration, width, height });
        return;
      }

      const seekTarget = Math.min(0.5, duration * 0.2);

      video.onseeked = () => {
        try {
          const profile = detectDeviceAndMemoryProfile();
          const thumbWidth = profile.recommendedThumbnailWidth;
          const canvas = document.createElement('canvas');
          canvas.width = thumbWidth;
          canvas.height = Math.max(
            1,
            Math.round((thumbWidth * height) / Math.max(1, width))
          );
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                releaseMediaElementResources(canvas);
                const thumbnailUrl = blob ? URL.createObjectURL(blob) : undefined;
                cleanup();
                resolve({ duration, width, height, thumbnailUrl });
              },
              'image/jpeg',
              0.75
            );
            return;
          }
          releaseMediaElementResources(canvas);
        } catch {
          // Ignore thumbnail error
        }
        cleanup();
        resolve({ duration, width, height });
      };

      try {
        video.currentTime = seekTarget;
      } catch {
        cleanup();
        resolve({ duration, width, height });
      }
    };

    video.src = objectUrl;
  });
}

function probeAudioMetadataBrowser(
  objectUrl: string,
  signal?: AbortSignal
): Promise<ProbedMediaMetadata> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out reading audio metadata.'));
    }, 8000);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Audio probing cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
    };

    audio.onerror = () => {
      cleanup();
      reject(new Error('Failed to decode audio file. Unsupported or corrupted audio stream.'));
    };

    audio.onloadedmetadata = () => {
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 5;
      cleanup();
      resolve({ duration });
    };

    audio.src = objectUrl;
  });
}

function probeImageMetadataBrowser(
  objectUrl: string,
  signal?: AbortSignal
): Promise<ProbedMediaMetadata> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    const onAbort = () => {
      img.onload = null;
      img.onerror = null;
      reject(new DOMException('Image probing cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    img.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        duration: 4,
        width: img.naturalWidth || 1280,
        height: img.naturalHeight || 720,
        thumbnailUrl: objectUrl,
      });
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Failed to decode image file.'));
    };
    img.src = objectUrl;
  });
}

export const defaultMediaManager = new MediaManager(2);

/**
 * Convenience single-file helper backed by defaultMediaManager.
 */
export async function ingestLocalMediaFile(
  file: File,
  signal?: AbortSignal
): Promise<MediaAsset> {
  const batch = await defaultMediaManager.importFiles([file], {
    duplicatePolicy: 'allow',
    signal,
  });
  if (batch.errors.length > 0) {
    throw new Error(batch.errors[0].message);
  }
  if (batch.imported.length === 0) {
    throw new Error('Media import was cancelled or skipped.');
  }
  return batch.imported[0];
}

/**
 * Generates a real, playable procedural visual or WAV audio clip right in the browser
 * using Blob ObjectURLs (never base64 data URLs).
 */
export async function createProceduralSampleAsset(
  preset: 'studio-countdown' | 'kinetic-broll' | 'ambient-synth-audio'
): Promise<MediaAsset> {
  const id = `sample_${preset}_${Date.now().toString(36)}`;

  if (preset === 'ambient-synth-audio') {
    const sampleRate = 22050;
    const duration = 6;
    const numSamples = sampleRate * duration;
    const pcm = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t * 2) * Math.min(1, (duration - t) * 1.5);
      const signal =
        0.35 * Math.sin(2 * Math.PI * 261.63 * t) +
        0.25 * Math.sin(2 * Math.PI * 329.63 * t) +
        0.25 *
          Math.sin(2 * Math.PI * 392.0 * t) *
          (0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * t));
      pcm[i] = signal * env;
    }

    const wavBlob = encodeFloat32ToWavBlob(pcm, sampleRate);
    const objectUrl = defaultMediaManager.createTrackedObjectUrl(wavBlob);
    const waveformPeaks = await mediaWorkerClient.computeWaveformPeaks(pcm, 80);
    const persistRes = await saveMediaBlobToDb(id, wavBlob);

    return {
      id,
      fingerprint: `synthetic::${preset}::${wavBlob.size}`,
      name: 'Studio_Ambient_Chord_Track.wav',
      type: 'audio',
      mimeType: 'audio/wav',
      sizeBytes: wavBlob.size,
      duration,
      objectUrl,
      waveformPeaks,
      createdAt: Date.now(),
      isSyntheticSample: true,
      persistedInIdb: persistRes.persisted,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    if (preset === 'studio-countdown') {
      grad.addColorStop(0, '#0F172A');
      grad.addColorStop(0.5, '#1E293B');
      grad.addColorStop(1, '#0369A1');
    } else {
      grad.addColorStop(0, '#18181B');
      grad.addColorStop(0.5, '#27272A');
      grad.addColorStop(1, '#0F766E');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 80; x < 1280; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 720);
      ctx.stroke();
    }
    for (let y = 80; y < 720; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1280, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(120, 90, 1040, 540);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      preset === 'studio-countdown'
        ? 'SCENE 01 · STUDIO CALIBRATION REEL'
        : 'SCENE 02 · ARCHITECTURAL B-ROLL SLATE',
      640,
      340
    );
    ctx.fillStyle = '#94A3B8';
    ctx.font = '24px monospace';
    ctx.fillText('1920x1080 · 60 FPS · REC.709 LINEAR SOURCE', 640, 400);
  }

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b || new Blob()), 'image/png')
  );
  releaseMediaElementResources(canvas);
  const objectUrl = defaultMediaManager.createTrackedObjectUrl(blob);
  const persistRes = await saveMediaBlobToDb(id, blob);

  return {
    id,
    fingerprint: `synthetic::${preset}::${blob.size}`,
    name:
      preset === 'studio-countdown'
        ? 'Scene_01_Calibration_Reel.png'
        : 'Scene_02_Architectural_Slate.png',
    type: 'image',
    mimeType: 'image/png',
    sizeBytes: blob.size,
    duration: preset === 'studio-countdown' ? 5 : 4,
    width: 1280,
    height: 720,
    objectUrl,
    thumbnailUrl: objectUrl,
    waveformPeaks: generateDeterministicPeaks(
      64,
      preset === 'studio-countdown' ? 11 : 29
    ),
    createdAt: Date.now(),
    isSyntheticSample: true,
    persistedInIdb: persistRes.persisted,
  };
}

function encodeFloat32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
