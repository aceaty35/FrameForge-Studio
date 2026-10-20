import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeFileFingerprint,
  ConcurrencyLimiter,
  MediaManager,
  validateMediaFile,
} from '@/lib/media/manager';
import {
  isQuotaExceededError,
  MAX_IDB_BLOB_SIZE_BYTES,
  saveMediaBlobToDb,
} from '@/lib/persistence/db';

function createMockFile(
  name: string,
  sizeBytes: number,
  mimeType: string,
  lastModified = 1729230000000
): File {
  const blob = new Blob([new Uint8Array(Math.min(sizeBytes, 64))], {
    type: mimeType,
  });
  Object.defineProperty(blob, 'size', { value: sizeBytes });
  Object.defineProperty(blob, 'name', { value: name });
  Object.defineProperty(blob, 'lastModified', { value: lastModified });
  return blob as unknown as File;
}

describe('MediaManager — Validation, Metadata Errors, Cleanup, Duplicates & Storage Quota', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates supported video, audio, and image formats and rejects unsupported or empty files', () => {
    const validMp4 = createMockFile('intro.mp4', 1024 * 500, 'video/mp4');
    expect(validateMediaFile(validMp4)).toEqual({
      valid: true,
      mediaType: 'video',
    });

    const validWav = createMockFile('voiceover.wav', 1024 * 120, 'audio/wav');
    expect(validateMediaFile(validWav)).toEqual({
      valid: true,
      mediaType: 'audio',
    });

    const validPng = createMockFile('slide.png', 1024 * 80, 'image/png');
    expect(validateMediaFile(validPng)).toEqual({
      valid: true,
      mediaType: 'image',
    });

    const emptyFile = createMockFile('empty.mp4', 0, 'video/mp4');
    const emptyRes = validateMediaFile(emptyFile);
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.error?.code).toBe('EMPTY_FILE');

    const unsupportedFile = createMockFile(
      'archive.zip',
      2048,
      'application/zip'
    );
    const unsupportedRes = validateMediaFile(unsupportedFile);
    expect(unsupportedRes.valid).toBe(false);
    expect(unsupportedRes.error?.code).toBe('UNSUPPORTED_TYPE');
    expect(unsupportedRes.error?.message).toContain('Unsupported format');
  });

  it('rejects files that exceed the configured maximum file size limit', () => {
    const maxLimit = 50 * 1024 * 1024; // 50 MB limit
    const hugeVideo = createMockFile('raw-4k.mp4', 75 * 1024 * 1024, 'video/mp4');
    const res = validateMediaFile(hugeVideo, maxLimit);
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe('FILE_TOO_LARGE');
    expect(res.error?.message).toContain('exceeds the 50 MB');
  });

  it('detects and skips duplicate imports both against existing assets and within the same batch', async () => {
    const manager = new MediaManager(2, {
      probeMetadata: async () => ({
        duration: 8.5,
        width: 1920,
        height: 1080,
        thumbnailUrl: 'blob:mock-thumb-1',
      }),
      extractWaveform: async () => [0.2, 0.6, 0.8],
      persistBlob: async () => ({ persisted: true }),
      deleteBlob: async () => undefined,
    });

    const fileA1 = createMockFile('clip-a.mp4', 4096, 'video/mp4', 1000);
    const fileA2Duplicate = createMockFile('clip-a.mp4', 4096, 'video/mp4', 1000);
    const fileB = createMockFile('clip-b.webm', 8192, 'video/webm', 2000);

    const batch = await manager.importFiles([fileA1, fileA2Duplicate, fileB], {
      duplicatePolicy: 'skip',
    });

    expect(batch.imported).toHaveLength(2);
    expect(batch.duplicatesSkipped).toEqual(['clip-a.mp4']);
    expect(batch.errors).toHaveLength(0);

    // Importing fileA1 again when passing batch.imported as existingAssets should also skip
    const secondBatch = await manager.importFiles([fileA1], {
      existingAssets: batch.imported,
      duplicatePolicy: 'skip',
    });
    expect(secondBatch.imported).toHaveLength(0);
    expect(secondBatch.duplicatesSkipped).toEqual(['clip-a.mp4']);
  });

  it('handles metadata extraction errors cleanly and revokes temporary Object URLs on failure', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const manager = new MediaManager(2, {
      probeMetadata: async () => {
        throw new Error('Corrupted MP4 moov atom');
      },
      extractWaveform: async () => [],
      persistBlob: async () => ({ persisted: true }),
      deleteBlob: async () => undefined,
    });

    const corruptedFile = createMockFile('broken.mp4', 12000, 'video/mp4');
    const result = await manager.importFiles([corruptedFile]);

    expect(result.imported).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('METADATA_FAILED');
    expect(result.errors[0].message).toContain('Corrupted MP4 moov atom');
    // Verify temporary Object URL was immediately revoked on failure
    expect(revokeSpy).toHaveBeenCalled();
    expect(manager.getTrackedUrlCount()).toBe(0);
  });

  it('revokes both media Object URLs and thumbnail Blob URLs and deletes IndexedDB blobs on cleanup', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const deletedIds: string[] = [];

    const manager = new MediaManager(2, {
      probeMetadata: async () => ({
        duration: 4.0,
        width: 1280,
        height: 720,
        thumbnailUrl: 'blob:http://localhost/thumb-123',
      }),
      extractWaveform: async () => [0.5, 0.5],
      persistBlob: async () => ({ persisted: true }),
      deleteBlob: async (id) => {
        deletedIds.push(id);
      },
    });

    const file = createMockFile('scene.mp4', 2048, 'video/mp4');
    const batch = await manager.importFiles([file]);
    expect(batch.imported).toHaveLength(1);
    expect(manager.getTrackedUrlCount()).toBe(2); // media ObjectURL + thumbnail Blob URL

    await manager.releaseAssetResources(batch.imported[0]);
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(deletedIds).toEqual([batch.imported[0].id]);
    expect(manager.getTrackedUrlCount()).toBe(0);
  });

  it('supports import cancellation via AbortController and limits concurrent operations', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let currentActive = 0;
    let maxObservedActive = 0;

    await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        limiter.run(async () => {
          currentActive++;
          maxObservedActive = Math.max(maxObservedActive, currentActive);
          await new Promise((r) => setTimeout(r, 15));
          currentActive--;
        })
      )
    );
    expect(maxObservedActive).toBeLessThanOrEqual(2);

    // Verify AbortController cancellation during import
    const controller = new AbortController();
    const manager = new MediaManager(1, {
      probeMetadata: async () => {
        controller.abort();
        return { duration: 3 };
      },
      extractWaveform: async () => [0.4],
      persistBlob: async () => ({ persisted: true }),
      deleteBlob: async () => undefined,
    });

    const f1 = createMockFile('one.mp4', 1024, 'video/mp4', 1);
    const f2 = createMockFile('two.mp4', 1024, 'video/mp4', 2);
    const batch = await manager.importFiles([f1, f2], {
      signal: controller.signal,
    });

    expect(batch.cancelled).toBe(true);
    expect(batch.imported).toHaveLength(0);
  });

  it('detects IndexedDB QuotaExceededError and keeps media usable in memory with a clear storage warning', async () => {
    const quotaError = Object.assign(new Error('Storage full'), {
      name: 'QuotaExceededError',
    });
    expect(isQuotaExceededError(quotaError)).toBe(true);

    // 1. Test saveMediaBlobToDb when IndexedDB throws QuotaExceededError
    const smallBlob = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
    const quotaSaveRes = await saveMediaBlobToDb(
      'asset_quota_test',
      smallBlob,
      async () => {
        throw quotaError;
      }
    );
    expect(quotaSaveRes.persisted).toBe(false);
    expect(quotaSaveRes.quotaExceeded).toBe(true);
    expect(quotaSaveRes.warning).toContain('quota was exceeded');

    // 2. Test saveMediaBlobToDb when file exceeds MAX_IDB_BLOB_SIZE_BYTES (120 MB)
    const oversizedBlob = new Blob(['x']);
    Object.defineProperty(oversizedBlob, 'size', {
      value: MAX_IDB_BLOB_SIZE_BYTES + 10 * 1024 * 1024,
    });
    const largeSaveRes = await saveMediaBlobToDb('asset_large_test', oversizedBlob);
    expect(largeSaveRes.persisted).toBe(false);
    expect(largeSaveRes.warning).toContain('exceeds the 120 MB local IndexedDB cache threshold');

    // 3. Verify MediaManager still completes the import in memory when IndexedDB quota fails
    const manager = new MediaManager(2, {
      probeMetadata: async () => ({ duration: 6, width: 1920, height: 1080 }),
      extractWaveform: async () => [0.3, 0.7],
      persistBlob: async (id, blob) =>
        saveMediaBlobToDb(id, blob, async () => {
          throw quotaError;
        }),
      deleteBlob: async () => undefined,
    });

    const validFile = createMockFile('interview.mp4', 2048, 'video/mp4');
    const batch = await manager.importFiles([validFile]);
    expect(batch.imported).toHaveLength(1);
    expect(batch.imported[0].persistedInIdb).toBe(false);
    expect(batch.storageWarnings).toHaveLength(1);
    expect(batch.storageWarnings[0]).toContain('quota was exceeded');
    expect(computeFileFingerprint(validFile)).toBe(batch.imported[0].fingerprint);
  });
});
