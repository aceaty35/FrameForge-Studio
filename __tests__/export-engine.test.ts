import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertSafeVirtualFsFilename,
  buildFfmpegExportArgs,
  createExportJobFromEDL,
  exportTimelineVideo,
  FFMPEG_RUNTIME_SPEC,
  isExportJobActive,
  releaseExportResources,
  sanitizeSafeFilename,
  verifyExportedBlob,
} from '@/lib/export/exporter';
import { useEditorStore } from '@/store/use-editor-store';

describe('Client-Side FFmpeg.wasm Export Engine & Security Suite', () => {
  beforeEach(() => {
    useEditorStore.getState().resetToDemoProject();
    releaseExportResources(true);
  });

  it('1. Sanitizes user filenames and blocks unsafe virtual FS paths to prevent injection', () => {
    expect(sanitizeSafeFilename('../../etc/passwd; rm -rf /')).toBe(
      'etc-passwd-rm-rf'
    );
    expect(sanitizeSafeFilename('My Final Cut (v2).mp4')).toBe(
      'My-Final-Cut-v2'
    );
    expect(sanitizeSafeFilename('   ')).toBe('frameforge-video-export');

    expect(() => assertSafeVirtualFsFilename('../secret.mp4')).toThrow(
      /Unsafe virtual filesystem filename/
    );
    expect(() =>
      buildFfmpegExportArgs({
        inputFilename: 'bad;name.webm',
        outputFilename: 'out.mp4',
        inPoint: 0,
        duration: 4,
        width: 1280,
        height: 720,
        fps: 30,
        format: 'mp4',
        quality: 'high',
      })
    ).toThrow(/Unsafe virtual filesystem filename/);
  });

  it('2. Creates a validated ExportJobDescriptor from the Edit Decision List (EDL) and checks audio/resolution settings', () => {
    const state = useEditorStore.getState();

    const jobWithAudio = createExportJobFromEDL({
      aspectRatio: '16:9',
      settings: {
        ...state.exportSettings,
        format: 'mp4',
        resolution: '1080p',
        fps: 60,
        audioBitrate: '320k',
        removeAudio: false,
      },
      clips: state.clips,
      tracks: state.tracks,
      assets: state.assets,
    });

    expect(jobWithAudio.width).toBe(1920);
    expect(jobWithAudio.height).toBe(1080);
    expect(jobWithAudio.fps).toBe(60);
    expect(jobWithAudio.duration).toBe(9);
    expect(jobWithAudio.hasAudioStream).toBe(true);
    expect(jobWithAudio.audioBitrate).toBe('320k');

    // When removeAudio is true, hasAudioStream is false and -an is emitted
    const jobMuted = createExportJobFromEDL({
      aspectRatio: '9:16',
      settings: {
        ...state.exportSettings,
        format: 'mp4',
        resolution: '720p',
        fps: 30,
        removeAudio: true,
      },
      clips: state.clips,
      tracks: state.tracks,
      assets: state.assets,
    });
    expect(jobMuted.width).toBe(720);
    expect(jobMuted.height).toBe(1280);
    expect(jobMuted.hasAudioStream).toBe(false);

    const argsMuted = buildFfmpegExportArgs({
      inputFilename: jobMuted.inputVfsFilename,
      outputFilename: jobMuted.outputVfsFilename,
      inPoint: 0,
      duration: jobMuted.duration,
      width: jobMuted.width,
      height: jobMuted.height,
      fps: jobMuted.fps,
      format: 'mp4',
      quality: 'high',
      removeAudio: true,
    });
    expect(argsMuted).toContain('-an');
    expect(argsMuted).not.toContain('aac');

    // Empty timeline is rejected
    expect(() =>
      createExportJobFromEDL({
        aspectRatio: '16:9',
        settings: state.exportSettings,
        clips: [],
        tracks: state.tracks,
        assets: state.assets,
      })
    ).toThrow(/Cannot export an empty timeline/);
  });

  it('3. Exports a sample video via FFmpeg.wasm worker, verifies readable output metadata, reuses runtime, and cleans up VFS files', async () => {
    const state = useEditorStore.getState();
    const progressEvents: number[] = [];

    const writtenFiles = new Set<string>();
    const deletedFiles: string[] = [];
    let progressCallback:
      | ((data: { progress: number; time?: number }) => void)
      | null = null;

    const mockFfmpeg = {
      load: vi.fn(async () => true),
      writeFile: vi.fn(async (name: string) => {
        writtenFiles.add(name);
        return true;
      }),
      readFile: vi.fn(async () => {
        // Simulated valid MP4 ftyp header + payload bytes
        return new Uint8Array([
          0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f,
          0x6d, 0x01, 0x02, 0x03, 0x04,
        ]);
      }),
      deleteFile: vi.fn(async (name: string) => {
        writtenFiles.delete(name);
        deletedFiles.push(name);
        return true;
      }),
      exec: vi.fn(async () => {
        progressCallback?.({ progress: 0.5 });
        progressCallback?.({ progress: 1.0 });
        return 0;
      }),
      on: vi.fn((event: string, cb: (data: { progress: number }) => void) => {
        if (event === 'progress') {
          progressCallback = cb;
        }
      }),
      terminate: vi.fn(),
    };

    const factorySpy = vi.fn(async () => mockFfmpeg);
    const mockStreamRenderer = vi.fn(
      async () =>
        new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02])], {
          type: 'video/webm',
        })
    );

    const controller = new AbortController();
    const artifact = await exportTimelineVideo({
      settings: {
        format: 'mp4',
        resolution: '720p',
        fps: 30,
        quality: 'high',
        engine: 'ffmpeg-wasm',
        filename: 'studio-sample-export',
        audioBitrate: '192k',
        removeAudio: false,
      },
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      clips: state.clips,
      tracks: state.tracks,
      assets: state.assets,
      mediaElements: new Map(),
      signal: controller.signal,
      onProgress: (p) => progressEvents.push(p.progress),
      ffmpegFactory: factorySpy,
      streamRenderer: mockStreamRenderer,
    });

    // Verify output exists, is readable, and matches expected duration, audio, dimensions, and FPS
    expect(artifact.engineUsed).toBe('ffmpeg-wasm');
    expect(artifact.outputFormat).toBe('mp4');
    expect(artifact.sizeBytes).toBe(16);
    expect(artifact.verifiedDuration).toBe(9);
    expect(artifact.verifiedWidth).toBe(1280);
    expect(artifact.verifiedHeight).toBe(720);
    expect(artifact.verifiedFps).toBe(30);
    expect(artifact.hasAudio).toBe(true);
    expect(artifact.codecSummary).toContain('LIBX264');
    expect(artifact.codecSummary).toContain('AAC');
    expect(progressEvents.length).toBeGreaterThan(1);

    // Verify temporary VFS input and output files were deleted after the job
    expect(deletedFiles).toHaveLength(2);
    expect(writtenFiles.size).toBe(0);

    // Second export job should reuse the cached FFmpeg worker instance without calling factorySpy again
    await exportTimelineVideo({
      settings: {
        format: 'mp4',
        resolution: '480p',
        fps: 24,
        quality: 'fast',
        engine: 'ffmpeg-wasm',
        filename: 'second-run',
        removeAudio: true,
      },
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      clips: state.clips,
      tracks: state.tracks,
      assets: state.assets,
      mediaElements: new Map(),
      signal: controller.signal,
      onProgress: () => undefined,
      ffmpegFactory: factorySpy,
      streamRenderer: mockStreamRenderer,
    });
    expect(factorySpy).toHaveBeenCalledTimes(1);
    expect(FFMPEG_RUNTIME_SPEC.ffmpegPackageVersion).toBe('0.12.15');
  });

  it('4. Handles export cancellation, concurrency locking, empty output rejection, and fallback workflow', async () => {
    const state = useEditorStore.getState();

    // Verify empty 0-byte Blob is rejected before reporting completion
    await expect(
      verifyExportedBlob(
        new Blob([], { type: 'video/mp4' }),
        {
          width: 1280,
          height: 720,
          fps: 30,
          duration: 5,
          hasAudioStream: true,
        },
        'mp4'
      )
    ).rejects.toThrow(/empty or unreadable output file/);

    // Test cancellation mid-export
    const abortController = new AbortController();
    const cancelPromise = exportTimelineVideo({
      settings: state.exportSettings,
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      clips: state.clips,
      tracks: state.tracks,
      assets: state.assets,
      mediaElements: new Map(),
      signal: abortController.signal,
      onProgress: () => undefined,
      streamRenderer: async () => {
        // While active, isExportJobActive() must be true and concurrent jobs rejected
        expect(isExportJobActive()).toBe(true);
        abortController.abort();
        return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/webm' });
      },
    });

    await expect(cancelPromise).rejects.toThrow(/Export cancelled by user/);
    expect(isExportJobActive()).toBe(false);

    // Test automatic fallback workflow when FFmpeg.wasm fails in 'auto' mode
    const fallbackController = new AbortController();
    const fallbackResult = await exportTimelineVideo({
      settings: {
        ...state.exportSettings,
        format: 'mp4',
        engine: 'auto',
      },
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      clips: state.clips,
      tracks: state.tracks,
      assets: state.assets,
      mediaElements: new Map(),
      signal: fallbackController.signal,
      onProgress: () => undefined,
      ffmpegFactory: async () => {
        throw new Error('Simulated WASM CDN network failure');
      },
      streamRenderer: async () =>
        new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x99])], {
          type: 'video/webm',
        }),
    });

    expect(fallbackResult.engineUsed).toBe('native-stream');
    expect(fallbackResult.outputFormat).toBe('webm');
    expect(fallbackResult.fallbackWarning).toContain(
      'Simulated WASM CDN network failure'
    );
  });
});
