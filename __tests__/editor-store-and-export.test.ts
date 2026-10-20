import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store/use-editor-store';
import {
  buildFfmpegExportArgs,
  estimateExportFileSizeBytes,
} from '@/lib/export/exporter';
import { getResolutionDimensions } from '@/lib/renderer/canvas-compositor';

describe('Zustand Editor Store & Export Command Builder', () => {
  beforeEach(() => {
    useEditorStore.getState().resetToDemoProject();
  });

  it('initializes with starter tracks, clips, and supports deterministic undo/redo history', () => {
    const initial = useEditorStore.getState();
    expect(initial.tracks.length).toBe(4);
    expect(initial.clips.length).toBe(3);

    // Add a text overlay clip
    initial.addTextOverlayClip('UNIT TEST CAPTION', false);
    expect(useEditorStore.getState().clips.length).toBe(4);
    expect(useEditorStore.getState().undoStack.length).toBe(1);

    // Undo restores clip count to 3
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().clips.length).toBe(3);

    // Redo re-applies the 4th clip
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().clips.length).toBe(4);
  });

  it('batches pointer drag gestures into a single deterministic undo entry via beginClipGesture and commitClipGesture', () => {
    const store = useEditorStore.getState();
    expect(store.undoStack.length).toBe(0);

    // Simulate pointer down + 5 pointermove updates + pointer up
    store.beginClipGesture();
    store.moveClip('clip_demo_v2', 5.0);
    store.moveClip('clip_demo_v2', 5.5);
    store.moveClip('clip_demo_v2', 6.2);
    store.commitClipGesture();

    // Only 1 undo snapshot should have been recorded for the entire drag gesture
    expect(useEditorStore.getState().undoStack.length).toBe(1);
    expect(
      useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v2')
        ?.startTime
    ).toBe(6.2);

    // Single undo restores the clip to its exact pre-drag startTime (4.5s)
    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v2')
        ?.startTime
    ).toBe(4.5);
  });

  it('supports closing track gaps, resolving overlaps, and adding new tracks', () => {
    const store = useEditorStore.getState();
    // Move second video clip to create a gap on track_video_1
    store.moveClip('clip_demo_v2', 8.0);
    expect(
      useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v2')
        ?.startTime
    ).toBe(8.0);

    // Close gaps packs clip_demo_v2 back to 4.5s
    useEditorStore.getState().closeGapsOnTrack('track_video_1');
    expect(
      useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v2')
        ?.startTime
    ).toBe(4.5);

    // Create an overlap on track_video_1 by disabling snap and moving clip_demo_v2 to 2.0s
    useEditorStore.getState().toggleSnap(); // snap = false
    useEditorStore.getState().moveClip('clip_demo_v2', 2.0);
    expect(
      useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v2')
        ?.startTime
    ).toBe(2.0);

    // Resolve overlaps pushes clip_demo_v2 back to 4.5s
    useEditorStore.getState().resolveOverlapsOnTrack('track_video_1');
    expect(
      useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v2')
        ?.startTime
    ).toBe(4.5);

    // Add a new audio track
    useEditorStore.getState().addTrack('audio');
    expect(useEditorStore.getState().tracks.length).toBe(5);
  });

  it('splits the selected clip at the current playhead and updates selection', () => {
    const store = useEditorStore.getState();
    store.selectClip('clip_demo_v1');
    store.setPlayheadTime(2.0);

    const splitSuccess = useEditorStore.getState().splitSelectedClipAtPlayhead();
    expect(splitSuccess).toBe(true);
    expect(useEditorStore.getState().clips.length).toBe(4);
  });

  it('recalculates clip timeline duration when playback speed is changed via setClipSpeed', () => {
    const store = useEditorStore.getState();
    // clip_demo_v1 has inPoint=0, outPoint=4.5, duration=4.5 at 1x
    store.setClipSpeed('clip_demo_v1', 2.0);
    const updated = useEditorStore
      .getState()
      .clips.find((c) => c.id === 'clip_demo_v1');
    expect(updated?.playbackRate).toBe(2.0);
    expect(updated?.duration).toBe(2.25);
  });

  it('updates and resets non-destructive crop settings and transitions on clips', () => {
    const store = useEditorStore.getState();
    store.updateClipCrop('clip_demo_v1', { top: 12, left: 8 });
    let clip = useEditorStore
      .getState()
      .clips.find((c) => c.id === 'clip_demo_v1');
    expect(clip?.transform.crop).toEqual({
      top: 12,
      bottom: 0,
      left: 8,
      right: 0,
    });

    store.resetClipCrop('clip_demo_v1');
    clip = useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v1');
    expect(clip?.transform.crop).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });

    store.applyClipTransition('clip_demo_v1', 'dip-to-black', 0.6);
    clip = useEditorStore.getState().clips.find((c) => c.id === 'clip_demo_v1');
    expect(clip?.transitionType).toBe('dip-to-black');
    expect(clip?.fadeIn).toBe(0.6);
    expect(clip?.fadeOut).toBe(0.6);
  });

  it('imports timed subtitle batches onto the Titles & Subtitles track', () => {
    const store = useEditorStore.getState();
    store.importSubtitlesBatch([
      { startTime: 1.0, duration: 2.0, text: 'Subtitle Cue 1' },
      { startTime: 3.5, duration: 2.5, text: 'Subtitle Cue 2' },
    ]);
    expect(useEditorStore.getState().clips.length).toBe(5);
  });

  it('builds deterministic FFmpeg CLI arguments and estimates export file sizes', () => {
    const args = buildFfmpegExportArgs({
      inputFilename: 'composited.webm',
      outputFilename: 'output.mp4',
      inPoint: 0,
      duration: 5.5,
      width: 1280,
      height: 720,
      fps: 30,
      format: 'mp4',
      quality: 'high',
      brightness: 110,
      contrast: 120,
      saturation: 100,
    });

    expect(args).toContain('-i');
    expect(args).toContain('composited.webm');
    expect(args).toContain('libx264');
    expect(args).toContain('output.mp4');

    const sizeHigh1080 = estimateExportFileSizeBytes(10, {
      format: 'mp4',
      resolution: '1080p',
      fps: 30,
      quality: 'high',
      engine: 'auto',
      filename: 'test',
    });
    const sizeFast480 = estimateExportFileSizeBytes(10, {
      format: 'mp4',
      resolution: '480p',
      fps: 24,
      quality: 'fast',
      engine: 'auto',
      filename: 'test',
    });
    expect(sizeHigh1080).toBeGreaterThan(sizeFast480);
  });

  it('computes even-numbered resolution dimensions for all aspect ratios', () => {
    const dims16x9 = getResolutionDimensions('16:9', '720p');
    expect(dims16x9).toEqual({ width: 1280, height: 720 });

    const dims9x16 = getResolutionDimensions('9:16', '1080p');
    expect(dims9x16).toEqual({ width: 1080, height: 1920 });

    const dims1x1 = getResolutionDimensions('1:1', '720p');
    expect(dims1x1.width % 2).toBe(0);
    expect(dims1x1.height % 2).toBe(0);
  });
});
