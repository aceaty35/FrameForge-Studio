import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyValidatedAspectRatio,
  applyValidatedAudioFade,
  applyValidatedCrop,
  applyValidatedFlip,
  applyValidatedResize,
  applyValidatedRotation,
  applyValidatedSpeed,
  applyValidatedTrim,
  applyValidatedVolume,
  buildNonDestructiveEDL,
  computeCropPixelRect,
  computeResizePlacementBox,
  createValidatedBackgroundAudioClip,
  createValidatedImageOverlayClip,
  createValidatedTextOverlayClip,
  detectOperationCapabilities,
  validateAndResolveOutputResolution,
  applyValidatedSplit,
} from '@/lib/operations/editing-operations';
import { buildFfmpegExportArgs } from '@/lib/export/exporter';
import { useEditorStore } from '@/store/use-editor-store';
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CROP_SETTINGS,
  DEFAULT_VIDEO_FILTERS,
  MediaAsset,
  TimelineClip,
} from '@/types/editor';

function makeTestClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_test_1',
    trackId: 'track_video_1',
    trackType: 'video',
    assetId: 'asset_video_1',
    label: 'Source Clip',
    startTime: 2.0,
    duration: 8.0,
    inPoint: 1.0,
    outPoint: 9.0,
    playbackRate: 1.0,
    volume: 100,
    muted: false,
    fadeIn: 0.5,
    fadeOut: 0.5,
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: {
      ...DEFAULT_CLIP_TRANSFORM,
      crop: { ...DEFAULT_CROP_SETTINGS },
    },
    ...overrides,
  };
}

function makeTestAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset_video_1',
    fingerprint: 'video_1::1000::0',
    name: 'camera_roll.mp4',
    type: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 1024 * 512,
    duration: 12.0,
    width: 1920,
    height: 1080,
    objectUrl: 'blob:test-video',
    waveformPeaks: [0.3, 0.6, 0.8],
    createdAt: 1729230000000,
    ...overrides,
  };
}

describe('Core 14 Video Editing Operations & Validation Suite', () => {
  beforeEach(() => {
    useEditorStore.getState().resetToDemoProject();
  });

  it('1. Trim: validates non-destructive start/end trimming, clamps zero/negative durations, and scales fades', () => {
    const clip = makeTestClip({
      startTime: 2.0,
      duration: 6.0,
      inPoint: 1.0,
      outPoint: 7.0,
      fadeIn: 1.5,
      fadeOut: 1.5,
    });

    // Valid left & right trim
    const trimmed = applyValidatedTrim(clip, {
      newStartTime: 3.0,
      newDuration: 2.0,
      maxSourceDuration: 12.0,
    });
    expect(trimmed.valid).toBe(true);
    expect(trimmed.value.startTime).toBe(3.0);
    expect(trimmed.value.inPoint).toBe(2.0);
    expect(trimmed.value.duration).toBe(2.0);
    expect(trimmed.value.outPoint).toBe(4.0);
    // Original fadeIn (1.5) + fadeOut (1.5) = 3.0s > 2.0s trimmed duration -> scaled to 1.0s each
    expect(trimmed.value.fadeIn).toBe(1.0);
    expect(trimmed.value.fadeOut).toBe(1.0);

    // Zero or negative duration is clamped to MIN_CLIP_DURATION (0.2s)
    const zeroAttempt = applyValidatedTrim(clip, { newDuration: -5.0 });
    expect(zeroAttempt.valid).toBe(true);
    expect(zeroAttempt.value.duration).toBe(0.2);
    expect(zeroAttempt.warnings.length).toBeGreaterThan(0);

    // Non-finite input is rejected
    const nanAttempt = applyValidatedTrim(clip, { newDuration: Number.NaN });
    expect(nanAttempt.valid).toBe(false);
  });

  it('2. Split: splits clip into two contiguous clips preserving source vs. timeline timestamps', () => {
    const clip = makeTestClip({
      startTime: 4.0,
      duration: 6.0,
      inPoint: 2.0,
      outPoint: 8.0,
    });

    const splitRes = applyValidatedSplit(clip, 6.5, () => 'clip_right_half');
    expect(splitRes.valid).toBe(true);
    expect(splitRes.value).not.toBeNull();
    if (!splitRes.value) return;

    const [left, right] = splitRes.value;
    expect(left.startTime).toBe(4.0);
    expect(left.duration).toBe(2.5);
    expect(left.inPoint).toBe(2.0);
    expect(left.outPoint).toBe(4.5);

    expect(right.id).toBe('clip_right_half');
    expect(right.startTime).toBe(6.5);
    expect(right.duration).toBe(3.5);
    expect(right.inPoint).toBe(4.5);
    expect(right.outPoint).toBe(8.0);

    // Out-of-bounds split is rejected with descriptive error
    const invalidSplit = applyValidatedSplit(clip, 3.0);
    expect(invalidSplit.valid).toBe(false);
    expect(invalidSplit.error).toContain('must lie strictly inside clip bounds');
  });

  it('3. Crop: validates inset percentages [0..45%] and computes exact even-numbered pixel coordinates', () => {
    const clip = makeTestClip();
    const res = applyValidatedCrop(clip, {
      top: 10,
      bottom: 10,
      left: -5, // clamped to 0
      right: 80, // clamped to 45
    });
    expect(res.valid).toBe(true);
    expect(res.value.transform.crop).toEqual({
      top: 10,
      bottom: 10,
      left: 0,
      right: 45,
    });
    expect(res.warnings).toHaveLength(2);

    const rect = computeCropPixelRect(1920, 1080, {
      top: 10,
      bottom: 10,
      left: 20,
      right: 20,
    });
    expect(rect).toEqual({
      x: 384,
      y: 108,
      width: 1152,
      height: 864,
    });
  });

  it('4 & 5. Resize & Rotate: preserves aspect ratio in contain/cover modes and handles intrinsic rotationMetadata', () => {
    const clip = makeTestClip();

    // Scale validation
    expect(applyValidatedResize(clip, { scale: 0 }).valid).toBe(false);
    const resized = applyValidatedResize(clip, {
      scale: 1.5,
      x: 0.25,
      y: -0.25,
      fitMode: 'cover',
    });
    expect(resized.value.transform.scale).toBe(1.5);
    expect(resized.value.transform.fitMode).toBe('cover');

    // Rotation with negative angle + intrinsic 90° mobile portrait metadata
    const rotated = applyValidatedRotation(clip, -90, 90);
    expect(rotated.value.transform.rotation).toBe(0);

    const rotated270 = applyValidatedRotation(clip, -90, 0);
    expect(rotated270.value.transform.rotation).toBe(270);

    // Landscape 1920x1080 video with 90° rotationMetadata becomes 1080x1920 portrait:
    // Fitting inside a 1920x1080 canvas in 'contain' mode should pillarbox to width=607.5, height=1080
    const placement = computeResizePlacementBox({
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      fitMode: 'contain',
      rotationMetadata: 90,
    });
    expect(placement.height).toBe(1080);
    expect(placement.width).toBeCloseTo(607.5, 1);
  });

  it('6 & 7. Flip & Aspect Ratio: toggles horizontal/vertical flip and validates aspect ratio presets', () => {
    const clip = makeTestClip();
    const flipped = applyValidatedFlip(clip, { flipH: true, flipV: true });
    expect(flipped.value.transform.flipH).toBe(true);
    expect(flipped.value.transform.flipV).toBe(true);

    const validRatio = applyValidatedAspectRatio('9:16');
    expect(validRatio.valid).toBe(true);
    expect(validRatio.value).toEqual({
      ratio: '9:16',
      width: 1080,
      height: 1920,
    });

    const invalidRatio = applyValidatedAspectRatio('21:9');
    expect(invalidRatio.valid).toBe(false);
  });

  it('8 & 9. Playback Speed & Volume: recalculates timeline duration and clamps volume', () => {
    const clip = makeTestClip({
      inPoint: 2.0,
      outPoint: 10.0, // 8.0s source span
      duration: 8.0,
    });

    const doubleSpeed = applyValidatedSpeed(clip, 2.0);
    expect(doubleSpeed.value.playbackRate).toBe(2.0);
    expect(doubleSpeed.value.duration).toBe(4.0);
    // Source in/out points remain untouched
    expect(doubleSpeed.value.inPoint).toBe(2.0);
    expect(doubleSpeed.value.outPoint).toBe(10.0);

    const volZero = applyValidatedVolume(clip, -20);
    expect(volZero.value.volume).toBe(0);
    expect(volZero.value.muted).toBe(true);
  });

  it('10, 11, 12 & 13. Overlays (Text & Image), Background Audio, and Audio Fades', () => {
    // 10. Text overlay
    const textRes = createValidatedTextOverlayClip({
      trackId: 'track_text_1',
      text: '   ', // empty text defaults cleanly
      startTime: 1.5,
      duration: 3.0,
    });
    expect(textRes.valid).toBe(true);
    expect(textRes.value.textStyle?.text).toBe('TEXT OVERLAY');
    expect(textRes.warnings).toHaveLength(1);

    // 11. Image overlay (with 90° rotationMetadata)
    const imgAsset = makeTestAsset({
      id: 'img_1',
      type: 'image',
      name: 'logo.png',
      rotationMetadata: 90,
    });
    const ovRes = createValidatedImageOverlayClip({
      asset: imgAsset,
      trackId: 'track_overlay_1',
      startTime: 2.0,
      scale: 0.5,
    });
    expect(ovRes.valid).toBe(true);
    expect(ovRes.value.trackType).toBe('overlay');
    expect(ovRes.value.transform.scale).toBe(0.5);
    expect(ovRes.value.transform.rotation).toBe(90);

    // Audio asset rejected as image overlay
    const audioAsset = makeTestAsset({
      id: 'aud_1',
      type: 'audio',
      name: 'music.wav',
    });
    expect(
      createValidatedImageOverlayClip({
        asset: audioAsset,
        trackId: 'track_overlay_1',
        startTime: 0,
      }).valid
    ).toBe(false);

    // 12. Background audio
    const bgAudioRes = createValidatedBackgroundAudioClip({
      asset: audioAsset,
      trackId: 'track_audio_1',
      startTime: 0,
      volume: 75,
      fadeIn: 0.8,
      fadeOut: 1.2,
    });
    expect(bgAudioRes.valid).toBe(true);
    expect(bgAudioRes.value.trackType).toBe('audio');
    expect(bgAudioRes.value.volume).toBe(75);
    expect(bgAudioRes.value.fadeIn).toBe(0.8);
    expect(bgAudioRes.value.fadeOut).toBe(1.2);

    // 13. Audio fade validation when fadeIn + fadeOut > clip.duration
    const shortClip = makeTestClip({ duration: 2.0 });
    const fadeRes = applyValidatedAudioFade(shortClip, {
      fadeIn: 2.0,
      fadeOut: 2.0,
    });
    expect(fadeRes.value.fadeIn).toBe(1.0);
    expect(fadeRes.value.fadeOut).toBe(1.0);
    expect(fadeRes.warnings).toHaveLength(1);
  });

  it('14. Output Resolution, Non-Destructive EDL, FFmpeg Filters & Undo/Redo Integration', () => {
    const res4x5 = validateAndResolveOutputResolution('4:5', '720p');
    expect(res4x5.valid).toBe(true);
    expect(res4x5.value.width % 2).toBe(0);
    expect(res4x5.value.height % 2).toBe(0);

    // Verify FFmpeg CLI filter generation for crop, rotation, flip, speed, volume, and fades
    const ffmpegArgs = buildFfmpegExportArgs({
      inputFilename: 'in.webm',
      outputFilename: 'out.mp4',
      inPoint: 1.0,
      duration: 4.0,
      width: 1280,
      height: 720,
      fps: 30,
      format: 'mp4',
      quality: 'high',
      crop: { top: 10, bottom: 10, left: 5, right: 5 },
      rotation: 90,
      flipH: true,
      playbackRate: 1.5,
      volume: 80,
      fadeIn: 0.5,
      fadeOut: 0.5,
    });
    const vfArg = ffmpegArgs[ffmpegArgs.indexOf('-vf') + 1];
    const afArg = ffmpegArgs[ffmpegArgs.indexOf('-af') + 1];
    expect(vfArg).toContain('crop=');
    expect(vfArg).toContain('transpose=1');
    expect(vfArg).toContain('hflip');
    expect(vfArg).toContain('setpts=');
    expect(afArg).toContain('atempo=1.50');
    expect(afArg).toContain('volume=0.80');
    expect(afArg).toContain('afade=t=in');
    expect(afArg).toContain('afade=t=out');

    // Verify Store Undo/Redo across transform, crop, fade, and overlay operations
    const store = useEditorStore.getState();
    const originalAssetSnapshot = structuredClone(store.assets);

    store.updateClipCrop('clip_demo_v1', { top: 15 });
    store.updateClipTransform('clip_demo_v1', { rotation: 90, flipH: true });
    store.setClipAudioFades('clip_demo_v1', { fadeIn: 0.75, fadeOut: 0.85 });
    store.addImageOverlayClip('demo_asset_scene_2');

    const edl = buildNonDestructiveEDL({
      aspectRatio: useEditorStore.getState().aspectRatio,
      exportSettings: useEditorStore.getState().exportSettings,
      clips: useEditorStore.getState().clips,
      tracks: useEditorStore.getState().tracks,
      assets: useEditorStore.getState().assets,
    });
    expect(edl.decisions.length).toBe(4);
    // Original imported media assets remain 100% unmodified
    expect(useEditorStore.getState().assets).toEqual(originalAssetSnapshot);

    // Capability report detects extreme speed limitations honestly
    store.setClipSpeed('clip_demo_v1', 3.5);
    const capReport = detectOperationCapabilities(
      useEditorStore.getState().clips,
      useEditorStore.getState().exportSettings
    );
    expect(capReport.limitations.length).toBeGreaterThan(0);

    // Undo all 5 operations step by step
    for (let i = 0; i < 5; i++) {
      useEditorStore.getState().undo();
    }
    const restoredClip = useEditorStore
      .getState()
      .clips.find((c) => c.id === 'clip_demo_v1');
    expect(restoredClip?.transform.crop?.top).toBe(0);
    expect(restoredClip?.transform.rotation).toBe(0);
    expect(restoredClip?.playbackRate).toBe(1);
  });
});
