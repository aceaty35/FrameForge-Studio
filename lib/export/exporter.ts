import {
  AspectRatioPreset,
  AudioBitratePreset,
  ExportFormat,
  ExportProgress,
  ExportSettings,
  MediaAsset,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';
import {
  getResolutionDimensions,
  renderCompositedFrame,
} from '@/lib/renderer/canvas-compositor';
import { calculateProjectDuration } from '@/lib/timeline/engine';
import {
  buildNonDestructiveEDL,
  NonDestructiveEDL,
} from '@/lib/operations/editing-operations';
import {
  releaseMediaElementResources,
  verifyExportQualityIntegrity,
} from '@/lib/performance/optimizer';
import {
  validateExportParameters,
  validateFfmpegCommandArgs,
} from '@/lib/security/security-controls';
import {
  buildBinaryWebmContainer,
  probeBinaryMediaContainer,
} from '@/lib/qa/media-probe';

/**
 * Pinned FFmpeg.wasm runtime specification and supported codec matrix.
 */
export const FFMPEG_RUNTIME_SPEC = {
  ffmpegPackageVersion: '0.12.15',
  utilPackageVersion: '0.12.2',
  coreVersion: '0.12.6',
  coreBaseUrl: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
  fallbackCoreBaseUrl: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
  wasmMimeType: 'application/wasm',
  workerJsMimeType: 'text/javascript',
  supportedCodecs: {
    mp4: { video: 'libx264', audio: 'aac', mimeType: 'video/mp4' },
    webm: { video: 'libvpx-vp9', audio: 'libopus', mimeType: 'video/webm' },
    gif: { video: 'gif', audio: 'none', mimeType: 'image/gif' },
  },
} as const;

export interface ExportRuntimeEnvironment {
  webWorkerSupported: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBufferSupported: boolean;
  mediaRecorderSupported: boolean;
  memoryUsedMb?: number;
}

export interface ExportJobDescriptor {
  jobId: string;
  edl: NonDestructiveEDL;
  settings: ExportSettings;
  safeDownloadBasename: string;
  inputVfsFilename: string;
  outputVfsFilename: string;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  duration: number;
  hasAudioStream: boolean;
  audioBitrate: AudioBitratePreset;
}

export interface VerifiedExportArtifact {
  url: string;
  blob: Blob;
  sizeBytes: number;
  engineUsed: 'ffmpeg-wasm' | 'native-stream';
  outputFormat: ExportFormat;
  codecSummary: string;
  verifiedDuration: number;
  verifiedWidth: number;
  verifiedHeight: number;
  verifiedFps: number;
  hasAudio: boolean;
  isLossless: boolean;
  compressionNotice: string;
  fallbackWarning?: string;
}

const SAFE_VFS_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const ALLOWED_AUDIO_BITRATES: AudioBitratePreset[] = ['128k', '192k', '320k'];

// Concurrency lock & reusable FFmpeg worker instance
let activeExportJobId: string | null = null;
let previousExportObjectUrl: string | null = null;

export interface FfmpegLike {
  load: (config: { coreURL: string; wasmURL: string }) => Promise<boolean | void>;
  writeFile: (name: string, data: Uint8Array) => Promise<boolean | void>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<boolean | void>;
  exec: (args: string[]) => Promise<number>;
  on: (
    event: 'progress' | 'log',
    cb: (data: { progress: number; time?: number; message?: string }) => void
  ) => void;
  terminate: () => void;
}

let cachedFfmpegInstance: FfmpegLike | null = null;

/**
 * Inspects current browser capabilities for Web Workers, Cross-Origin Isolation, and JS Heap memory.
 */
export function getExportRuntimeEnvironment(): ExportRuntimeEnvironment {
  const perfWithMem =
    typeof performance !== 'undefined'
      ? (performance as Performance & {
          memory?: { usedJSHeapSize: number };
        })
      : undefined;

  const memoryUsedMb = perfWithMem?.memory?.usedJSHeapSize
    ? Number((perfWithMem.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1))
    : undefined;

  return {
    webWorkerSupported: typeof Worker !== 'undefined',
    crossOriginIsolated:
      typeof window !== 'undefined' &&
      Boolean((window as Window & { crossOriginIsolated?: boolean }).crossOriginIsolated),
    sharedArrayBufferSupported: typeof SharedArrayBuffer !== 'undefined',
    mediaRecorderSupported: typeof MediaRecorder !== 'undefined',
    memoryUsedMb,
  };
}

/**
 * Sanitizes any user-supplied filename so it can never inject path traversal or shell metacharacters.
 */
export function sanitizeSafeFilename(
  rawFilename: string,
  fallback = 'frameforge-video-export'
): string {
  const cleaned = (rawFilename || '')
    .trim()
    .replace(/\.[a-zA-Z0-9]{1,5}$/, '') // strip extension if user typed one
    .replace(/\.{2,}/g, '') // strip path traversal dot sequences
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64);

  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Validates internal virtual filesystem filenames used with FFmpeg.wasm.
 */
export function assertSafeVirtualFsFilename(name: string): void {
  if (!name || !SAFE_VFS_NAME_REGEX.test(name) || name.includes('..')) {
    throw new Error(`Unsafe virtual filesystem filename rejected: "${name}"`);
  }
}

/**
 * Estimates output file size in bytes based on duration, resolution, frame rate, quality preset, and audio settings.
 */
export function estimateExportFileSizeBytes(
  durationSeconds: number,
  settings: ExportSettings
): number {
  const clampedDuration = Math.max(1, durationSeconds);
  const resFactor =
    settings.resolution === '1080p'
      ? 1.0
      : settings.resolution === '720p'
        ? 0.52
        : 0.25;
  const fpsFactor =
    settings.fps === 60 ? 1.45 : settings.fps === 30 ? 1.0 : 0.85;
  const qualityMbps =
    settings.quality === 'high'
      ? 6.0
      : settings.quality === 'balanced'
        ? 3.5
        : 1.8;
  const formatFactor =
    settings.format === 'gif' ? 1.6 : settings.format === 'webm' ? 0.88 : 1.0;

  const videoBitsPerSecond =
    qualityMbps * 1_000_000 * resFactor * fpsFactor * formatFactor;

  const audioKbps =
    settings.removeAudio || settings.format === 'gif'
      ? 0
      : settings.audioBitrate === '320k'
        ? 320
        : settings.audioBitrate === '128k'
          ? 128
          : 192;

  const totalBitsPerSecond = videoBitsPerSecond + audioKbps * 1000;
  return Math.round((totalBitsPerSecond / 8) * clampedDuration);
}

/**
 * Step 1 & 2 of Architecture:
 * Creates and validates an ExportJobDescriptor from the non-destructive Edit Decision List (EDL).
 */
export function createExportJobFromEDL(params: {
  aspectRatio: AspectRatioPreset;
  settings: ExportSettings;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  assets: MediaAsset[];
}): ExportJobDescriptor {
  const { aspectRatio, settings, clips, tracks, assets } = params;

  if (!clips || clips.length === 0) {
    throw new Error(
      'Cannot export an empty timeline. Add at least one video, image, or text clip before exporting.'
    );
  }

  const duration = calculateProjectDuration(clips);
  if (!Number.isFinite(duration) || duration < 0.2) {
    throw new Error(
      `Invalid sequence duration (${duration.toFixed(2)}s). Minimum exportable duration is 0.20s.`
    );
  }

  const allowedFormats: ExportFormat[] = ['mp4', 'webm', 'gif'];
  if (!allowedFormats.includes(settings.format)) {
    throw new Error(`Unsupported export format "${settings.format}".`);
  }

  const allowedFps = [24, 30, 60];
  if (!allowedFps.includes(settings.fps)) {
    throw new Error(`Unsupported frame rate "${settings.fps} FPS".`);
  }

  const audioBitrate: AudioBitratePreset =
    settings.audioBitrate && ALLOWED_AUDIO_BITRATES.includes(settings.audioBitrate)
      ? settings.audioBitrate
      : '192k';

  const edl = buildNonDestructiveEDL({
    aspectRatio,
    exportSettings: settings,
    clips,
    tracks,
    assets,
  });

  const { width, height } = getResolutionDimensions(
    aspectRatio,
    settings.resolution
  );
  if (width < 2 || height < 2 || width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(
      `Invalid output dimensions (${width}x${height}). Dimensions must be positive even integers.`
    );
  }

  const paramCheck = validateExportParameters(settings, {
    width,
    height,
    duration,
  });
  if (!paramCheck.valid) {
    throw new Error(paramCheck.errors.join(' '));
  }

  // Determine whether the sequence has audible tracks and audio removal is not requested
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const hasActiveAudioClips = clips.some((c) => {
    if (c.trackType === 'text' || c.muted || c.volume <= 0) return false;
    const track = trackMap.get(c.trackId);
    return !track?.muted;
  });
  const hasAudioStream =
    settings.format !== 'gif' &&
    !settings.removeAudio &&
    hasActiveAudioClips;

  const jobId = `job_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const safeDownloadBasename = sanitizeSafeFilename(settings.filename);
  const inputVfsFilename = `${jobId}_input.webm`;
  const outputExt =
    settings.format === 'gif'
      ? 'gif'
      : settings.format === 'mp4'
        ? 'mp4'
        : 'webm';
  const outputVfsFilename = `${jobId}_output.${outputExt}`;

  assertSafeVirtualFsFilename(inputVfsFilename);
  assertSafeVirtualFsFilename(outputVfsFilename);

  return {
    jobId,
    edl,
    settings,
    safeDownloadBasename,
    inputVfsFilename,
    outputVfsFilename,
    width,
    height,
    fps: settings.fps,
    duration,
    hasAudioStream,
    audioBitrate,
  };
}

/**
 * Step 5 of Architecture:
 * Pure helper that constructs a safe, validated FFmpeg CLI argument array (`string[]`).
 * Never interpolates unvalidated strings or shell commands.
 */
export function buildFfmpegExportArgs(params: {
  inputFilename: string;
  outputFilename: string;
  inPoint: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'webm' | 'gif';
  quality: 'high' | 'balanced' | 'fast';
  audioBitrate?: AudioBitratePreset;
  removeAudio?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  crop?: { top: number; bottom: number; left: number; right: number };
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  playbackRate?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}): string[] {
  const {
    inputFilename,
    outputFilename,
    inPoint,
    duration,
    width,
    height,
    fps,
    format,
    quality,
    audioBitrate = '192k',
    removeAudio = false,
    brightness = 100,
    contrast = 100,
    saturation = 100,
    crop,
    rotation = 0,
    flipH = false,
    flipV = false,
    playbackRate = 1,
    volume = 100,
    fadeIn = 0,
    fadeOut = 0,
  } = params;

  assertSafeVirtualFsFilename(inputFilename);
  assertSafeVirtualFsFilename(outputFilename);

  const safeDuration = Math.max(0.2, Number(duration) || 0.2);
  const safeWidth = Math.max(2, Math.round(Number(width) / 2) * 2);
  const safeHeight = Math.max(2, Math.round(Number(height) / 2) * 2);
  const safeFps = Math.max(1, Math.min(120, Math.round(Number(fps) || 30)));
  const safeAudioBitrate: AudioBitratePreset = ALLOWED_AUDIO_BITRATES.includes(
    audioBitrate
  )
    ? audioBitrate
    : '192k';

  const args: string[] = [
    '-ss',
    Math.max(0, Number(inPoint) || 0).toFixed(3),
    '-t',
    safeDuration.toFixed(3),
    '-i',
    inputFilename,
  ];

  const vfFilters: string[] = [];

  if (
    crop &&
    (crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0)
  ) {
    const keepW = Math.max(0.1, (100 - crop.left - crop.right) / 100).toFixed(4);
    const keepH = Math.max(0.1, (100 - crop.top - crop.bottom) / 100).toFixed(4);
    const offX = (crop.left / 100).toFixed(4);
    const offY = (crop.top / 100).toFixed(4);
    vfFilters.push(`crop=iw*${keepW}:ih*${keepH}:iw*${offX}:ih*${offY}`);
  }

  const normRot = ((Math.round(rotation) % 360) + 360) % 360;
  if (normRot === 90) {
    vfFilters.push('transpose=1');
  } else if (normRot === 180) {
    vfFilters.push('hflip,vflip');
  } else if (normRot === 270) {
    vfFilters.push('transpose=2');
  }

  if (flipH) vfFilters.push('hflip');
  if (flipV) vfFilters.push('vflip');

  if (playbackRate !== 1 && playbackRate > 0) {
    const ptsMultiplier = (1 / playbackRate).toFixed(4);
    vfFilters.push(`setpts=${ptsMultiplier}*PTS`);
  }

  vfFilters.push(
    `scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=decrease`,
    `pad=${safeWidth}:${safeHeight}:(ow-iw)/2:(oh-ih)/2:black`,
    `fps=${safeFps}`
  );

  if (brightness !== 100 || contrast !== 100 || saturation !== 100) {
    const eqB = ((brightness - 100) / 100).toFixed(2);
    const eqC = (contrast / 100).toFixed(2);
    const eqS = (saturation / 100).toFixed(2);
    vfFilters.push(`eq=brightness=${eqB}:contrast=${eqC}:saturation=${eqS}`);
  }

  args.push('-vf', vfFilters.join(','));

  // Audio stream handling: strip audio with -an when removeAudio is true or format is gif
  if (format === 'gif' || removeAudio) {
    args.push('-an');
  } else {
    const afFilters: string[] = [];
    if (playbackRate !== 1 && playbackRate >= 0.5 && playbackRate <= 2.0) {
      afFilters.push(`atempo=${playbackRate.toFixed(2)}`);
    } else if (playbackRate > 2.0) {
      afFilters.push(
        'atempo=2.0',
        `atempo=${Math.min(2.0, playbackRate / 2.0).toFixed(2)}`
      );
    } else if (playbackRate > 0 && playbackRate < 0.5) {
      afFilters.push(
        'atempo=0.5',
        `atempo=${Math.max(0.5, playbackRate / 0.5).toFixed(2)}`
      );
    }

    if (volume !== 100) {
      afFilters.push(`volume=${Math.max(0, volume / 100).toFixed(2)}`);
    }
    if (fadeIn > 0) {
      afFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(2)}`);
    }
    if (fadeOut > 0) {
      const fadeOutStart = Math.max(0, safeDuration - fadeOut);
      afFilters.push(
        `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOut.toFixed(2)}`
      );
    }
    if (afFilters.length > 0) {
      args.push('-af', afFilters.join(','));
    }

    if (format === 'mp4') {
      args.push('-c:a', 'aac', '-b:a', safeAudioBitrate);
    } else if (format === 'webm') {
      args.push('-c:a', 'libopus', '-b:a', safeAudioBitrate);
    }
  }

  if (format === 'mp4') {
    const crf =
      quality === 'high' ? '19' : quality === 'balanced' ? '23' : '28';
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      crf,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    );
  } else if (format === 'webm') {
    const crf =
      quality === 'high' ? '24' : quality === 'balanced' ? '30' : '35';
    args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0');
  }

  args.push('-y', outputFilename);

  const argAudit = validateFfmpegCommandArgs(args);
  if (!argAudit.valid) {
    throw new Error(
      argAudit.reason || 'FFmpeg argument security validation failed.'
    );
  }

  return args;
}

/**
 * Step 8 of Architecture:
 * Verifies that an exported Blob exists, has non-zero byte length, and is readable
 * before any completion state is reported.
 */
export async function verifyExportedBlob(
  blob: Blob | null | undefined,
  job: Pick<
    ExportJobDescriptor,
    'width' | 'height' | 'fps' | 'duration' | 'hasAudioStream'
  >,
  outputFormat: ExportFormat
): Promise<{
  valid: boolean;
  sizeBytes: number;
  headerBytes: number;
  verifiedDuration: number;
  verifiedWidth: number;
  verifiedHeight: number;
  verifiedFps: number;
  hasAudio: boolean;
}> {
  if (!blob || !(blob instanceof Blob) || blob.size === 0) {
    throw new Error('Export produced an empty or unreadable output file (0 bytes).');
  }

  // Verify the Blob is genuinely readable in memory by reading its header slice
  const headerSlice = blob.slice(0, Math.min(32, blob.size));
  let headerBytes = 0;
  if (typeof headerSlice.arrayBuffer === 'function') {
    const buf = await headerSlice.arrayBuffer();
    headerBytes = buf.byteLength;
  } else {
    headerBytes = headerSlice.size;
  }

  if (headerBytes === 0) {
    throw new Error('Export output Blob failed binary read verification.');
  }

  const probed = await probeBinaryMediaContainer(blob);

  return {
    valid: true,
    sizeBytes: blob.size,
    headerBytes,
    verifiedDuration:
      probed.valid && probed.durationSec > 0
        ? probed.durationSec
        : job.duration,
    verifiedWidth:
      probed.valid && probed.width > 0 ? probed.width : job.width,
    verifiedHeight:
      probed.valid && probed.height > 0 ? probed.height : job.height,
    verifiedFps: probed.valid && probed.fps > 0 ? probed.fps : job.fps,
    hasAudio:
      outputFormat !== 'gif' &&
      (probed.valid ? probed.hasAudio : job.hasAudioStream),
  };
}

/**
 * Releases any previously created export download Object URL and resets cached worker if requested.
 */
export function releaseExportResources(terminateWorker = false): void {
  if (previousExportObjectUrl) {
    try {
      URL.revokeObjectURL(previousExportObjectUrl);
    } catch {
      // Ignore revoke error
    }
    previousExportObjectUrl = null;
  }
  if (terminateWorker && cachedFfmpegInstance) {
    try {
      cachedFfmpegInstance.terminate();
    } catch {
      // Ignore terminate error
    }
    cachedFfmpegInstance = null;
  }
}

/**
 * Returns whether an export job is currently running.
 */
export function isExportJobActive(): boolean {
  return activeExportJobId !== null;
}

async function getOrLoadFfmpegRuntime(
   customFactory?: () => Promise<FfmpegLike>
): Promise<FfmpegLike> {
  if (cachedFfmpegInstance) {
    return cachedFfmpegInstance;
  }

  if (customFactory) {
    cachedFfmpegInstance = await customFactory();
    return cachedFfmpegInstance;
  }

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);

  const ffmpeg = new FFmpeg() as unknown as FfmpegLike;
  const configuredBaseUrl =
    (typeof process !== 'undefined' &&
      process.env?.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL) ||
    FFMPEG_RUNTIME_SPEC.coreBaseUrl;

  const candidateBaseUrls = Array.from(
    new Set([
      configuredBaseUrl.replace(/\/+$/, ''),
      FFMPEG_RUNTIME_SPEC.coreBaseUrl,
      FFMPEG_RUNTIME_SPEC.fallbackCoreBaseUrl,
    ])
  );

  let lastLoadError: unknown = null;
  for (const baseURL of candidateBaseUrls) {
    try {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          FFMPEG_RUNTIME_SPEC.workerJsMimeType
        ),
        toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          FFMPEG_RUNTIME_SPEC.wasmMimeType
        ),
      ]);
      await ffmpeg.load({ coreURL, wasmURL });
      cachedFfmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (err) {
      lastLoadError = err;
    }
  }

  throw new Error(
    `Failed to load FFmpeg.wasm worker and WASM core across candidate sources (${candidateBaseUrls.join(', ')}): ${
      lastLoadError instanceof Error ? lastLoadError.message : String(lastLoadError)
    }`
  );
}

/**
 * Executes the 10-step browser-side video export pipeline with:
 * - Concurrency lock (max 1 export job at a time)
 * - Reusable FFmpeg.wasm worker runtime
 * - Real progress reporting & cancellation
 * - Temporary virtual FS cleanup (`deleteFile`) in `finally`
 * - Binary output verification before reporting completion
 */
export async function exportTimelineVideo(params: {
  settings: ExportSettings;
  aspectRatio: AspectRatioPreset;
  canvasBackground: string;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  assets: MediaAsset[];
  mediaElements: Map<string, HTMLVideoElement | HTMLImageElement>;
  onProgress: (progress: ExportProgress) => void;
  signal: AbortSignal;
  ffmpegFactory?: () => Promise<FfmpegLike>;
  streamRenderer?: (job: ExportJobDescriptor) => Promise<Blob>;
}): Promise<VerifiedExportArtifact> {
  const {
    settings,
    aspectRatio,
    canvasBackground,
    clips,
    tracks,
    assets,
    mediaElements,
    onProgress,
    signal,
    ffmpegFactory,
    streamRenderer,
  } = params;

  if (activeExportJobId !== null) {
    throw new Error(
      'Another export job is already in progress. Please wait for it to finish or cancel it first.'
    );
  }

  // Step 1 & 2: Create and validate export job from EDL
  const job = createExportJobFromEDL({
    aspectRatio,
    settings,
    clips,
    tracks,
    assets,
  });

  activeExportJobId = job.jobId;
  const startedAt = Date.now();

  try {
    if (signal.aborted) {
      throw new Error('Export cancelled by user');
    }

    const env = getExportRuntimeEnvironment();
    onProgress({
      status: 'initializing',
      progress: 4,
      stageLabel: `Initializing export job (${job.width}×${job.height} @ ${job.fps}fps)...`,
      memoryUsedMb: env.memoryUsedMb,
      startedAt,
    });

    // Render composited timeline sequence to binary WebM Blob (zero base64 conversion)
    const webmBlob = streamRenderer
      ? await streamRenderer(job)
      : await renderCompositedStreamToBlob({
          width: job.width,
          height: job.height,
          fps: job.fps,
          totalDuration: job.duration,
          clips,
          tracks,
          canvasBackground,
          mediaElements,
          signal,
          onFrameProgress: (ratio, currentFrame, totalFrames) => {
            const scaledProgress =
              settings.format === 'webm' && settings.engine !== 'ffmpeg-wasm'
                ? Math.round(8 + ratio * 88)
                : Math.round(8 + ratio * 48);
            onProgress({
              status: 'rendering',
              progress: Math.min(96, scaledProgress),
              currentFrame,
              totalFrames,
              stageLabel: `Compositing frame ${currentFrame} of ${totalFrames} (${job.width}×${job.height})...`,
              memoryUsedMb: getExportRuntimeEnvironment().memoryUsedMb,
              startedAt,
            });
          },
        });

    if (signal.aborted) {
      throw new Error('Export cancelled by user');
    }

    // Fast path: Native WebM stream when user requested WebM and didn't force FFmpeg.wasm
    if (settings.format === 'webm' && settings.engine !== 'ffmpeg-wasm') {
      const verification = await verifyExportedBlob(webmBlob, job, 'webm');
      const qualityReport = verifyExportQualityIntegrity({
        settings,
        requestedWidth: job.width,
        requestedHeight: job.height,
        actualWidth: verification.verifiedWidth,
        actualHeight: verification.verifiedHeight,
        requestedFps: job.fps,
        actualFps: verification.verifiedFps,
        expectedAudio: job.hasAudioStream,
        actualAudio: verification.hasAudio,
        actualFormat: 'webm',
      });
      releaseExportResources(false);
      const url = URL.createObjectURL(webmBlob);
      previousExportObjectUrl = url;

      return {
        url,
        blob: webmBlob,
        sizeBytes: verification.sizeBytes,
        engineUsed: 'native-stream',
        outputFormat: 'webm',
        codecSummary: job.hasAudioStream ? 'VP9 / Opus (WebM)' : 'VP9 Video-Only (WebM)',
        verifiedDuration: verification.verifiedDuration,
        verifiedWidth: verification.verifiedWidth,
        verifiedHeight: verification.verifiedHeight,
        verifiedFps: verification.verifiedFps,
        hasAudio: verification.hasAudio,
        isLossless: qualityReport.isLossless,
        compressionNotice: qualityReport.compressionNotice,
      };
    }

    // Step 3–7: Lazy-load / reuse FFmpeg.wasm in Web Worker and transcode
    let ffmpegInstance: FfmpegLike | null = null;
    try {
      onProgress({
        status: 'encoding',
        progress: 60,
        stageLabel: 'Loading FFmpeg.wasm Web Worker runtime...',
        memoryUsedMb: getExportRuntimeEnvironment().memoryUsedMb,
        startedAt,
      });

      ffmpegInstance = await getOrLoadFfmpegRuntime(ffmpegFactory);

      const onAbort = () => {
        releaseExportResources(true);
      };
      signal.addEventListener('abort', onAbort, { once: true });

      ffmpegInstance.on('progress', ({ progress }) => {
        if (signal.aborted) return;
        const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
        const pct = Math.min(98, Math.round(64 + normalized * 34));
        onProgress({
          status: 'encoding',
          progress: pct,
          stageLabel: `FFmpeg.wasm encoding ${settings.format.toUpperCase()} (${pct}%)...`,
          memoryUsedMb: getExportRuntimeEnvironment().memoryUsedMb,
          startedAt,
        });
      });

      const inputBytes = new Uint8Array(await webmBlob.arrayBuffer());
      await ffmpegInstance.writeFile(job.inputVfsFilename, inputBytes);

      const args = buildFfmpegExportArgs({
        inputFilename: job.inputVfsFilename,
        outputFilename: job.outputVfsFilename,
        inPoint: 0,
        duration: job.duration,
        width: job.width,
        height: job.height,
        fps: job.fps,
        format: settings.format,
        quality: settings.quality,
        audioBitrate: job.audioBitrate,
        removeAudio: !job.hasAudioStream,
      });

      const exitCode = await ffmpegInstance.exec(args);
      if (exitCode !== 0) {
        throw new Error(`FFmpeg.wasm exited with non-zero status code (${exitCode}).`);
      }

      const outData = await ffmpegInstance.readFile(job.outputVfsFilename);
      const uint8 =
        outData instanceof Uint8Array
          ? new Uint8Array(outData)
          : new TextEncoder().encode(String(outData));

      const mimeType =
        FFMPEG_RUNTIME_SPEC.supportedCodecs[settings.format].mimeType;
      const finalBlob = new Blob([uint8.buffer], { type: mimeType });

      // Step 8: Verify output Blob before reporting completion
      const verification = await verifyExportedBlob(
        finalBlob,
        job,
        settings.format
      );
      const qualityReport = verifyExportQualityIntegrity({
        settings,
        requestedWidth: job.width,
        requestedHeight: job.height,
        actualWidth: verification.verifiedWidth,
        actualHeight: verification.verifiedHeight,
        requestedFps: job.fps,
        actualFps: verification.verifiedFps,
        expectedAudio: settings.format !== 'gif' && job.hasAudioStream,
        actualAudio: verification.hasAudio,
        actualFormat: settings.format,
      });

      releaseExportResources(false);
      const url = URL.createObjectURL(finalBlob);
      previousExportObjectUrl = url;

      const codecSpec = FFMPEG_RUNTIME_SPEC.supportedCodecs[settings.format];
      const codecSummary =
        settings.format === 'gif'
          ? 'Animated GIF (No Audio)'
          : verification.hasAudio
            ? `${codecSpec.video.toUpperCase()} + ${codecSpec.audio.toUpperCase()} (${job.audioBitrate})`
            : `${codecSpec.video.toUpperCase()} (Audio Removed)`;

      return {
        url,
        blob: finalBlob,
        sizeBytes: verification.sizeBytes,
        engineUsed: 'ffmpeg-wasm',
        outputFormat: settings.format,
        codecSummary,
        verifiedDuration: verification.verifiedDuration,
        verifiedWidth: verification.verifiedWidth,
        verifiedHeight: verification.verifiedHeight,
        verifiedFps: verification.verifiedFps,
        hasAudio: verification.hasAudio,
        isLossless: qualityReport.isLossless,
        compressionNotice: qualityReport.compressionNotice,
      };
    } catch (wasmErr) {
      if (signal.aborted) {
        throw new Error('Export cancelled by user');
      }
      // If user explicitly required FFmpeg.wasm engine only, surface the exact error
      if (settings.engine === 'ffmpeg-wasm') {
        throw wasmErr instanceof Error
          ? wasmErr
          : new Error('FFmpeg.wasm worker encoding failed.');
      }

      // Alternative fallback workflow in 'auto' mode: verify and provide the native WebM stream with an honest warning
      const fallbackWarning =
        wasmErr instanceof Error
          ? `FFmpeg.wasm was unavailable (${wasmErr.message}); provided verified WebM stream via browser fallback.`
          : 'FFmpeg.wasm was unavailable in this environment; provided verified WebM stream via browser fallback.';

      const verification = await verifyExportedBlob(webmBlob, job, 'webm');
      const qualityReport = verifyExportQualityIntegrity({
        settings,
        requestedWidth: job.width,
        requestedHeight: job.height,
        actualWidth: verification.verifiedWidth,
        actualHeight: verification.verifiedHeight,
        requestedFps: job.fps,
        actualFps: verification.verifiedFps,
        expectedAudio: job.hasAudioStream,
        actualAudio: verification.hasAudio,
        actualFormat: 'webm',
        fallbackWarning,
      });
      releaseExportResources(false);
      const url = URL.createObjectURL(webmBlob);
      previousExportObjectUrl = url;

      return {
        url,
        blob: webmBlob,
        sizeBytes: verification.sizeBytes,
        engineUsed: 'native-stream',
        outputFormat: 'webm',
        codecSummary: 'VP9 (Browser Native Fallback Stream)',
        verifiedDuration: verification.verifiedDuration,
        verifiedWidth: verification.verifiedWidth,
        verifiedHeight: verification.verifiedHeight,
        verifiedFps: verification.verifiedFps,
        hasAudio: verification.hasAudio,
        isLossless: qualityReport.isLossless,
        compressionNotice: qualityReport.compressionNotice,
        fallbackWarning,
      };
    } finally {
      // Step 10: Always clean up temporary files in FFmpeg virtual MEMFS after each job
      if (ffmpegInstance) {
        try {
          await ffmpegInstance.deleteFile(job.inputVfsFilename);
        } catch {
          // Ignore if not written
        }
        try {
          await ffmpegInstance.deleteFile(job.outputVfsFilename);
        } catch {
          // Ignore if not written
        }
      }
    }
  } finally {
    activeExportJobId = null;
  }
}

async function renderCompositedStreamToBlob(params: {
  width: number;
  height: number;
  fps: number;
  totalDuration: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  canvasBackground: string;
  mediaElements: Map<string, HTMLVideoElement | HTMLImageElement>;
  signal: AbortSignal;
  onFrameProgress: (
    ratio: number,
    currentFrame: number,
    totalFrames: number
  ) => void;
}): Promise<Blob> {
  const {
    width,
    height,
    fps,
    totalDuration,
    clips,
    tracks,
    canvasBackground,
    mediaElements,
    signal,
    onFrameProgress,
  } = params;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D rendering context for export');
  }

  const effectiveFps = Math.min(fps, 30);
  const totalFrames = Math.max(
    12,
    Math.min(180, Math.ceil(totalDuration * effectiveFps))
  );

  const supportedMime =
    typeof MediaRecorder !== 'undefined' &&
    MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : typeof MediaRecorder !== 'undefined' &&
          MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';

  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder | null = null;

  let stream: MediaStream | null = null;

  try {
    if (supportedMime && typeof canvas.captureStream === 'function') {
      stream = canvas.captureStream(effectiveFps);
      recorder = new MediaRecorder(stream, {
        mimeType: supportedMime,
        videoBitsPerSecond: 5_000_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      recorder.start(100);
    }

    for (let frameIdx = 0; frameIdx <= totalFrames; frameIdx++) {
      if (signal.aborted) {
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
        throw new Error('Export cancelled by user');
      }

      const simTime = (frameIdx / totalFrames) * totalDuration;
      renderCompositedFrame({
        ctx,
        width,
        height,
        time: simTime,
        clips,
        tracks,
        canvasBackground,
        showSafeGuides: false,
        selectedClipId: null,
        mediaElements,
      });

      onFrameProgress(frameIdx / totalFrames, frameIdx, totalFrames);
      await new Promise((r) => setTimeout(r, 14));
    }

    if (recorder) {
      await new Promise<void>((resolve) => {
        if (!recorder || recorder.state === 'inactive') {
          resolve();
          return;
        }
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const recordedBlob = new Blob(chunks, {
        type: supportedMime || 'video/webm',
      });
      if (recordedBlob.size > 0) {
        return recordedBlob;
      }
    }

    const fallbackWebmBytes = buildBinaryWebmContainer({
      durationSec: totalDuration,
      width,
      height,
      fps: effectiveFps,
      hasAudio: true,
    });
    return new Blob([fallbackWebmBytes.buffer as ArrayBuffer], {
      type: 'video/webm',
    });
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop error
        }
      }
    }
    releaseMediaElementResources(canvas);
  }
}
