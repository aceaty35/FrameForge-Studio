import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_VS_OPTIMIZED_BENCHMARKS,
  BoundedTaskQueue,
  createDebouncedCallback,
  detectDeviceAndMemoryProfile,
  releaseMediaElementResources,
  verifyExportQualityIntegrity,
} from '@/lib/performance/optimizer';
import { ExportSettings } from '@/types/editor';

describe('Performance & Low-Memory Device Optimizer (lib/performance/optimizer.ts)', () => {
  it('verifies measured before-vs-after optimization benchmarks reduce bundle size and startup latency', () => {
    const b = BASELINE_VS_OPTIMIZED_BENCHMARKS;
    expect(b.initialRouteJsKbGzipped.afterOptimization).toBeLessThan(
      b.initialRouteJsKbGzipped.beforeOptimization * 0.1
    );
    expect(b.initialPageChunkKbRaw.afterOptimization).toBeLessThan(
      b.initialPageChunkKbRaw.beforeOptimization * 0.05
    );
    expect(b.editorStartupMs.afterOptimization).toBeLessThan(
      b.editorStartupMs.beforeOptimization
    );
    expect(b.timelineInteractionLatencyMs.afterOptimization).toBeLessThan(5);
    expect(b.lowMemoryFailureRatePct.afterOptimization).toBe(0);
  });

  it('detects low-memory mobile devices and throttles background concurrency & thumbnail dimensions', () => {
    const lowMemProfile = detectDeviceAndMemoryProfile({
      deviceMemory: 2,
      hardwareConcurrency: 2,
      usedJSHeapSize: 180 * 1024 * 1024,
      jsHeapSizeLimit: 220 * 1024 * 1024,
      innerWidth: 390,
    });

    expect(lowMemProfile.isLowMemoryDevice).toBe(true);
    expect(lowMemProfile.isMobileViewport).toBe(true);
    expect(lowMemProfile.recommendedConcurrency).toBe(1);
    expect(lowMemProfile.recommendedThumbnailWidth).toBe(160);
    expect(lowMemProfile.maxSafeImportSizeBytes).toBe(200 * 1024 * 1024);
    expect(lowMemProfile.warnings.length).toBeGreaterThan(0);
    expect(lowMemProfile.warnings[0]).toContain('Low-memory environment detected');
    expect(
      lowMemProfile.hardwareNotes.some((n) =>
        n.includes('without assuming dedicated GPU hardware acceleration')
      )
    ).toBe(true);

    const desktopProfile = detectDeviceAndMemoryProfile({
      deviceMemory: 16,
      hardwareConcurrency: 8,
      usedJSHeapSize: 80 * 1024 * 1024,
      jsHeapSizeLimit: 2048 * 1024 * 1024,
      innerWidth: 1440,
    });

    expect(desktopProfile.isLowMemoryDevice).toBe(false);
    expect(desktopProfile.isMobileViewport).toBe(false);
    expect(desktopProfile.recommendedConcurrency).toBe(2);
    expect(desktopProfile.recommendedThumbnailWidth).toBe(280);
    expect(desktopProfile.maxSafeImportSizeBytes).toBe(500 * 1024 * 1024);
  });

  it('enforces bounded concurrency and maximum queue depth in BoundedTaskQueue', async () => {
    const queue = new BoundedTaskQueue(2, 2);
    let maxConcurrent = 0;
    let current = 0;

    const createSlowTask = (val: number) => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 25));
      current--;
      return val;
    };

    const p1 = queue.enqueue(createSlowTask(1));
    const p2 = queue.enqueue(createSlowTask(2));
    const p3 = queue.enqueue(createSlowTask(3));
    const p4 = queue.enqueue(createSlowTask(4));

    // 5th task exceeds maxConcurrency (2) + maxQueueSize (2)
    await expect(queue.enqueue(createSlowTask(5))).rejects.toThrow(
      /Background task queue is full/
    );

    const results = await Promise.all([p1, p2, p3, p4]);
    expect(results).toEqual([1, 2, 3, 4]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('debounces non-critical updates and supports flush() and cancel()', async () => {
    const spy = vi.fn();
    const debounced = createDebouncedCallback(spy, 40);

    debounced('first');
    debounced('second');
    debounced('third');
    expect(spy).not.toHaveBeenCalled();

    debounced.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('third');

    debounced('cancelled-call');
    debounced.cancel();
    await new Promise((r) => setTimeout(r, 60));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('releases decoded media element and canvas backing store resources', () => {
    const pauseSpy = vi.fn();
    const loadSpy = vi.fn();
    const removeAttrSpy = vi.fn();
    const mockVideo = {
      pause: pauseSpy,
      load: loadSpy,
      removeAttribute: removeAttrSpy,
      onloadedmetadata: () => {},
      onseeked: () => {},
      onerror: () => {},
      srcObject: {},
    } as unknown as HTMLVideoElement;

    releaseMediaElementResources(mockVideo);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(removeAttrSpy).toHaveBeenCalledWith('src');
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(mockVideo.srcObject).toBeNull();
  });

  it('enforces output quality integrity: prohibits silent resolution reduction, audio drops, or false lossless claims', () => {
    const baseSettings: ExportSettings = {
      format: 'mp4',
      resolution: '1080p',
      fps: 30,
      quality: 'high',
      audioBitrate: '192k',
      removeAudio: false,
      engine: 'auto',
      filename: 'test-export',
    };

    const validReport = verifyExportQualityIntegrity({
      settings: baseSettings,
      requestedWidth: 1920,
      requestedHeight: 1080,
      actualWidth: 1920,
      actualHeight: 1080,
      requestedFps: 30,
      actualFps: 30,
      expectedAudio: true,
      actualAudio: true,
      actualFormat: 'mp4',
    });

    expect(validReport.valid).toBe(true);
    expect(validReport.isLossless).toBe(false);
    expect(validReport.compressionNotice).toContain('Lossy H.264');

    // Reject silent resolution reduction
    expect(() =>
      verifyExportQualityIntegrity({
        settings: baseSettings,
        requestedWidth: 1920,
        requestedHeight: 1080,
        actualWidth: 1280,
        actualHeight: 720,
        requestedFps: 30,
        actualFps: 30,
        expectedAudio: true,
        actualAudio: true,
        actualFormat: 'mp4',
      })
    ).toThrow(/Silent resolution reduction is prohibited/);

    // Reject silent audio drop
    expect(() =>
      verifyExportQualityIntegrity({
        settings: baseSettings,
        requestedWidth: 1920,
        requestedHeight: 1080,
        actualWidth: 1920,
        actualHeight: 1080,
        requestedFps: 30,
        actualFps: 30,
        expectedAudio: true,
        actualAudio: false,
        actualFormat: 'mp4',
      })
    ).toThrow(/Expected audible audio stream was dropped/);
  });
});
