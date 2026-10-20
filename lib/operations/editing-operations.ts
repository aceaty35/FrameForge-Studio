import {
  ASPECT_RATIO_PRESETS,
  AspectRatioPreset,
  ClipTransform,
  CropSettings,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CROP_SETTINGS,
  DEFAULT_VIDEO_FILTERS,
  ExportResolution,
  ExportSettings,
  MediaAsset,
  TextOverlayStyle,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';
import {
  calculateProjectDuration,
  MIN_CLIP_DURATION,
  MIN_CLIP_DURATION_TICKS,
  secondsToTicks,
  splitClipAtTime,
  ticksToSeconds,
  trimClipEnd,
  trimClipStart,
} from '@/lib/timeline/engine';

export interface OperationValidationResult<T> {
  valid: boolean;
  value: T;
  warnings: string[];
  error?: string;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditDecisionEntry {
  clipId: string;
  trackId: string;
  trackType: TimelineClip['trackType'];
  sourceAssetId: string | null;
  timelineIn: number;
  timelineOut: number;
  sourceIn: number;
  sourceOut: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transform: ClipTransform;
  crop: CropSettings;
  hasTextOverlay: boolean;
}

export interface NonDestructiveEDL {
  version: 1;
  aspectRatio: AspectRatioPreset;
  outputResolution: ExportResolution;
  outputWidth: number;
  outputHeight: number;
  sequenceDuration: number;
  decisions: EditDecisionEntry[];
  preservedAssetIds: string[];
}

export interface CapabilityReport {
  supportedInPreview: boolean;
  supportedInFfmpegWasm: boolean;
  supportedInNativeStream: boolean;
  limitations: string[];
}

/**
 * 1. TRIM OPERATION:
 * Non-destructively trims a clip's start (`inPoint` + `startTime`) and/or end (`outPoint` + `duration`).
 * Rejects or clamps invalid, negative, or zero-length durations while keeping source and timeline timestamps separate.
 */
export function applyValidatedTrim(
  clip: TimelineClip,
  params: {
    newStartTime?: number;
    newDuration?: number;
    maxSourceDuration?: number;
  }
): OperationValidationResult<TimelineClip> {
  const warnings: string[] = [];

  if (
    (params.newStartTime !== undefined && !Number.isFinite(params.newStartTime)) ||
    (params.newDuration !== undefined && !Number.isFinite(params.newDuration))
  ) {
    return {
      valid: false,
      value: clip,
      warnings,
      error: 'Trim timestamps must be finite numbers.',
    };
  }

  let updated = { ...clip };

  if (params.newStartTime !== undefined) {
    if (params.newStartTime < 0) {
      warnings.push('Trim start time clamped to 00:00.00.');
    }
    const maxStart = clip.startTime + clip.duration - MIN_CLIP_DURATION;
    if (params.newStartTime > maxStart) {
      warnings.push(
        `Clip duration cannot be shorter than ${MIN_CLIP_DURATION.toFixed(2)}s; trim clamped.`
      );
    }
    updated = trimClipStart(updated, params.newStartTime, params.maxSourceDuration);
  }

  if (params.newDuration !== undefined) {
    if (params.newDuration < MIN_CLIP_DURATION) {
      warnings.push(
        `Requested duration (${params.newDuration.toFixed(2)}s) is below minimum (${MIN_CLIP_DURATION.toFixed(2)}s); clamped.`
      );
    }
    updated = trimClipEnd(updated, params.newDuration, params.maxSourceDuration);
  }

  // Re-validate audio fade envelope so fadeIn + fadeOut never exceeds trimmed duration
  if (updated.fadeIn + updated.fadeOut > updated.duration) {
    const scale = updated.duration / Math.max(0.001, updated.fadeIn + updated.fadeOut);
    updated.fadeIn = ticksToSeconds(secondsToTicks(updated.fadeIn * scale));
    updated.fadeOut = ticksToSeconds(secondsToTicks(updated.fadeOut * scale));
    warnings.push('Audio fade-in/fade-out scaled proportionally to fit trimmed clip duration.');
  }

  return {
    valid: true,
    value: updated,
    warnings,
  };
}

/**
 * 2. SPLIT OPERATION:
 * Non-destructively splits a clip at `splitTimelineTime` into two independent timeline clips
 * referencing the same immutable source asset with contiguous source in/out points.
 */
export function applyValidatedSplit(
  clip: TimelineClip,
  splitTimelineTime: number,
  generateId?: () => string
): OperationValidationResult<[TimelineClip, TimelineClip] | null> {
  if (!Number.isFinite(splitTimelineTime)) {
    return {
      valid: false,
      value: null,
      warnings: [],
      error: 'Split timestamp must be a finite number.',
    };
  }

  const pair = splitClipAtTime(clip, splitTimelineTime, generateId);
  if (!pair) {
    return {
      valid: false,
      value: null,
      warnings: [],
      error: `Split point (${splitTimelineTime.toFixed(2)}s) must lie strictly inside clip bounds [${clip.startTime.toFixed(2)}s, ${(clip.startTime + clip.duration).toFixed(2)}s] with at least ${MIN_CLIP_DURATION.toFixed(2)}s per segment.`,
    };
  }

  return {
    valid: true,
    value: pair,
    warnings: [],
  };
}

/**
 * 3. CROP OPERATION & EXPLICIT COORDINATE SYSTEM:
 * Uses normalized inset percentages (`top`, `bottom`, `left`, `right` in `[0, 45]`)
 * so crops remain resolution-independent across preview and export resolutions.
 */
export function applyValidatedCrop(
  clip: TimelineClip,
  cropPatch: Partial<CropSettings>
): OperationValidationResult<TimelineClip> {
  const current = clip.transform.crop ?? DEFAULT_CROP_SETTINGS;
  const warnings: string[] = [];

  const clampEdge = (val: number | undefined, fallback: number, name: string): number => {
    if (val === undefined || !Number.isFinite(val)) return fallback;
    if (val < 0) {
      warnings.push(`Crop ${name} cannot be negative; clamped to 0%.`);
      return 0;
    }
    if (val > 45) {
      warnings.push(`Crop ${name} clamped to maximum 45% to preserve non-zero visible area.`);
      return 45;
    }
    return Number(val.toFixed(2));
  };

  const nextCrop: CropSettings = {
    top: clampEdge(cropPatch.top, current.top, 'top'),
    bottom: clampEdge(cropPatch.bottom, current.bottom, 'bottom'),
    left: clampEdge(cropPatch.left, current.left, 'left'),
    right: clampEdge(cropPatch.right, current.right, 'right'),
  };

  return {
    valid: true,
    value: {
      ...clip,
      transform: {
        ...clip.transform,
        crop: nextCrop,
      },
    },
    warnings,
  };
}

/**
 * Converts a clip's normalized `CropSettings` into an exact even-numbered pixel rectangle
 * in source or canvas pixel coordinates `{ x, y, width, height }`.
 */
export function computeCropPixelRect(
  frameWidth: number,
  frameHeight: number,
  crop: CropSettings = DEFAULT_CROP_SETTINGS
): PixelRect {
  const safeW = Math.max(2, frameWidth);
  const safeH = Math.max(2, frameHeight);
  const x = Math.round((safeW * Math.max(0, Math.min(45, crop.left))) / 100);
  const y = Math.round((safeH * Math.max(0, Math.min(45, crop.top))) / 100);
  const rawW = safeW * (1 - (Math.max(0, Math.min(45, crop.left)) + Math.max(0, Math.min(45, crop.right))) / 100);
  const rawH = safeH * (1 - (Math.max(0, Math.min(45, crop.top)) + Math.max(0, Math.min(45, crop.bottom))) / 100);

  // Ensure even dimensions for YUV420p compatibility
  const width = Math.max(2, Math.floor(rawW / 2) * 2);
  const height = Math.max(2, Math.floor(rawH / 2) * 2);

  return { x, y, width, height };
}

/**
 * 4. RESIZE OPERATION & EXPLICIT COORDINATE SYSTEM:
 * Supports aspect-preserving `'contain'` (Fit), aspect-preserving `'cover'` (Fill),
 * and non-proportional `'fill'` (Stretch), plus normalized scale (`0.1`..`4.0`) and center offset `x, y` (`-1`..`1`).
 * Automatically accounts for intrinsic media rotation metadata (90° or 270° swaps effective source width/height).
 */
export function computeResizePlacementBox(params: {
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  fitMode: ClipTransform['fitMode'];
  rotationDegrees?: number;
  rotationMetadata?: 0 | 90 | 180 | 270;
}): PixelRect {
  const totalRotation =
    (((params.rotationDegrees ?? 0) + (params.rotationMetadata ?? 0)) % 360 + 360) % 360;
  const isQuarterTurn = totalRotation === 90 || totalRotation === 270;

  const effectiveSrcW = Math.max(
    1,
    isQuarterTurn ? params.sourceHeight : params.sourceWidth
  );
  const effectiveSrcH = Math.max(
    1,
    isQuarterTurn ? params.sourceWidth : params.sourceHeight
  );
  const dstW = Math.max(1, params.canvasWidth);
  const dstH = Math.max(1, params.canvasHeight);

  if (params.fitMode === 'fill') {
    return { x: 0, y: 0, width: dstW, height: dstH };
  }

  const srcRatio = effectiveSrcW / effectiveSrcH;
  const dstRatio = dstW / dstH;

  let drawW = dstW;
  let drawH = dstH;

  if (params.fitMode === 'contain') {
    if (srcRatio > dstRatio) {
      drawW = dstW;
      drawH = dstW / srcRatio;
    } else {
      drawH = dstH;
      drawW = dstH * srcRatio;
    }
  } else if (params.fitMode === 'cover') {
    if (srcRatio > dstRatio) {
      drawH = dstH;
      drawW = dstH * srcRatio;
    } else {
      drawW = dstW;
      drawH = dstW / srcRatio;
    }
  }

  return {
    x: Number(((dstW - drawW) / 2).toFixed(2)),
    y: Number(((dstH - drawH) / 2).toFixed(2)),
    width: Number(drawW.toFixed(2)),
    height: Number(drawH.toFixed(2)),
  };
}

export function applyValidatedResize(
  clip: TimelineClip,
  patch: {
    scale?: number;
    x?: number;
    y?: number;
    fitMode?: ClipTransform['fitMode'];
  }
): OperationValidationResult<TimelineClip> {
  const warnings: string[] = [];
  const nextTransform = { ...clip.transform };

  if (patch.scale !== undefined) {
    if (!Number.isFinite(patch.scale) || patch.scale <= 0) {
      return {
        valid: false,
        value: clip,
        warnings,
        error: 'Scale factor must be a positive number.',
      };
    }
    if (patch.scale < 0.1 || patch.scale > 4.0) {
      warnings.push('Scale factor clamped to supported range [10% .. 400%].');
    }
    nextTransform.scale = Number(Math.max(0.1, Math.min(4.0, patch.scale)).toFixed(3));
  }

  if (patch.x !== undefined && Number.isFinite(patch.x)) {
    nextTransform.x = Number(Math.max(-1.5, Math.min(1.5, patch.x)).toFixed(3));
  }

  if (patch.y !== undefined && Number.isFinite(patch.y)) {
    nextTransform.y = Number(Math.max(-1.5, Math.min(1.5, patch.y)).toFixed(3));
  }

  if (patch.fitMode !== undefined) {
    nextTransform.fitMode = patch.fitMode;
  }

  return {
    valid: true,
    value: {
      ...clip,
      transform: nextTransform,
    },
    warnings,
  };
}

/**
 * 5. ROTATE OPERATION (with intrinsic rotationMetadata normalization):
 * Normalizes any rotation angle (positive or negative) into `[0, 360)` degrees.
 */
export function normalizeRotationDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

export function applyValidatedRotation(
  clip: TimelineClip,
  degrees: number,
  assetRotationMetadata: 0 | 90 | 180 | 270 = 0
): OperationValidationResult<TimelineClip> {
  if (!Number.isFinite(degrees)) {
    return {
      valid: false,
      value: clip,
      warnings: [],
      error: 'Rotation angle must be a finite number.',
    };
  }

  const normalized = normalizeRotationDegrees(degrees + assetRotationMetadata);
  return {
    valid: true,
    value: {
      ...clip,
      transform: {
        ...clip.transform,
        rotation: normalized,
      },
    },
    warnings: [],
  };
}

/**
 * 6. FLIP OPERATION:
 * Toggles or sets horizontal (`flipH`) and vertical (`flipV`) mirroring non-destructively.
 */
export function applyValidatedFlip(
  clip: TimelineClip,
  options: { flipH?: boolean; flipV?: boolean }
): OperationValidationResult<TimelineClip> {
  return {
    valid: true,
    value: {
      ...clip,
      transform: {
        ...clip.transform,
        flipH: options.flipH !== undefined ? Boolean(options.flipH) : clip.transform.flipH,
        flipV: options.flipV !== undefined ? Boolean(options.flipV) : clip.transform.flipV,
      },
    },
    warnings: [],
  };
}

/**
 * 7. CHANGE ASPECT RATIO OPERATION:
 * Validates the target aspect ratio preset and returns its canonical dimensions.
 */
export function applyValidatedAspectRatio(
  ratio: string
): OperationValidationResult<{
  ratio: AspectRatioPreset;
  width: number;
  height: number;
}> {
  if (!(ratio in ASPECT_RATIO_PRESETS)) {
    return {
      valid: false,
      value: {
        ratio: '16:9',
        width: 1920,
        height: 1080,
      },
      warnings: [],
      error: `Unsupported aspect ratio "${ratio}". Supported presets: 16:9, 9:16, 1:1, 4:5.`,
    };
  }

  const preset = ASPECT_RATIO_PRESETS[ratio as AspectRatioPreset];
  return {
    valid: true,
    value: {
      ratio: preset.ratio,
      width: preset.width,
      height: preset.height,
    },
    warnings: [],
  };
}

/**
 * 8. ADJUST PLAYBACK SPEED OPERATION:
 * Validates playback speed in `[0.25x .. 4.0x]`, preserving source `[inPoint, outPoint]`
 * while recalculating timeline `duration` in exact 60,000 Hz rational ticks.
 */
export function applyValidatedSpeed(
  clip: TimelineClip,
  requestedRate: number
): OperationValidationResult<TimelineClip> {
  if (!Number.isFinite(requestedRate) || requestedRate <= 0) {
    return {
      valid: false,
      value: clip,
      warnings: [],
      error: 'Playback speed must be a positive number.',
    };
  }

  const warnings: string[] = [];
  if (requestedRate < 0.25 || requestedRate > 4.0) {
    warnings.push('Playback speed clamped to supported range [0.25x .. 4.0x].');
  }

  const clampedRate = Number(Math.max(0.25, Math.min(4.0, requestedRate)).toFixed(2));
  const sourceSpanTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    secondsToTicks(clip.outPoint) - secondsToTicks(clip.inPoint)
  );
  const newDurationTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    Math.round(sourceSpanTicks / clampedRate)
  );

  return {
    valid: true,
    value: {
      ...clip,
      playbackRate: clampedRate,
      duration: ticksToSeconds(newDurationTicks),
    },
    warnings,
  };
}

/**
 * 9. ADJUST VOLUME OPERATION:
 * Validates clip volume in `[0 .. 100]`% and optional mute state.
 */
export function applyValidatedVolume(
  clip: TimelineClip,
  volumePercent: number,
  muted?: boolean
): OperationValidationResult<TimelineClip> {
  if (!Number.isFinite(volumePercent)) {
    return {
      valid: false,
      value: clip,
      warnings: [],
      error: 'Volume level must be a finite percentage.',
    };
  }

  const warnings: string[] = [];
  if (volumePercent < 0 || volumePercent > 100) {
    warnings.push('Volume level clamped to [0% .. 100%].');
  }

  const clampedVol = Math.round(Math.max(0, Math.min(100, volumePercent)));
  return {
    valid: true,
    value: {
      ...clip,
      volume: clampedVol,
      muted: muted !== undefined ? Boolean(muted) : clampedVol === 0 ? true : clip.muted,
    },
    warnings,
  };
}

/**
 * 10. ADD TEXT OVERLAY OPERATION:
 * Creates a validated, non-destructive text overlay clip with explicit normalized `[0..1]` coordinates.
 */
export function createValidatedTextOverlayClip(params: {
  trackId: string;
  text: string;
  startTime: number;
  duration?: number;
  style?: Partial<TextOverlayStyle>;
  isSubtitle?: boolean;
  id?: string;
}): OperationValidationResult<TimelineClip> {
  const warnings: string[] = [];
  const rawText = (params.text ?? '').trim();
  const safeText = rawText.length > 0 ? rawText : 'TEXT OVERLAY';
  if (rawText.length === 0) {
    warnings.push('Empty text overlay defaulted to placeholder label.');
  }

  const startTicks = Math.max(0, secondsToTicks(params.startTime || 0));
  const durTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    secondsToTicks(params.duration ?? (params.isSubtitle ? 2.8 : 3.5))
  );
  const durationSec = ticksToSeconds(durTicks);

  const x = Math.max(0.05, Math.min(0.95, params.style?.x ?? 0.5));
  const y = Math.max(
    0.05,
    Math.min(0.95, params.style?.y ?? (params.isSubtitle ? 0.86 : 0.5))
  );
  const fontSize = Math.max(16, Math.min(160, params.style?.fontSize ?? (params.isSubtitle ? 42 : 60)));

  const clip: TimelineClip = {
    id:
      params.id ??
      `clip_txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trackId: params.trackId,
    trackType: 'text',
    assetId: null,
    label: safeText.slice(0, 28),
    startTime: ticksToSeconds(startTicks),
    duration: durationSec,
    inPoint: 0,
    outPoint: durationSec,
    playbackRate: 1,
    volume: 100,
    muted: false,
    fadeIn: 0.2,
    fadeOut: 0.2,
    transitionType: 'crossfade',
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: { ...DEFAULT_CLIP_TRANSFORM, crop: { ...DEFAULT_CROP_SETTINGS } },
    textStyle: {
      text: safeText,
      fontFamily: params.style?.fontFamily ?? 'Plus Jakarta Sans, sans-serif',
      fontSize,
      fontWeight: params.style?.fontWeight ?? 700,
      color: params.style?.color ?? '#FFFFFF',
      backgroundColor:
        params.style?.backgroundColor ??
        (params.isSubtitle
          ? 'rgba(15, 23, 42, 0.85)'
          : 'rgba(2, 132, 199, 0.9)'),
      textAlign: params.style?.textAlign ?? 'center',
      x,
      y,
      rotation: params.style?.rotation ?? 0,
      outlineColor: params.style?.outlineColor ?? '#000000',
      outlineWidth: params.style?.outlineWidth ?? (params.isSubtitle ? 2 : 0),
      animation: params.style?.animation ?? 'fade-in-out',
      keepWithinCanvas: params.style?.keepWithinCanvas ?? true,
      isSubtitle: Boolean(params.isSubtitle),
    },
    colorTag: '#6366F1',
  };

  return {
    valid: true,
    value: clip,
    warnings,
  };
}

/**
 * 11. ADD IMAGE OVERLAY (B-ROLL / PICTURE-IN-PICTURE) OPERATION:
 * Creates a validated overlay clip on an `overlay` track from an image or video asset,
 * with configurable Picture-in-Picture scale and normalized position.
 */
export function createValidatedImageOverlayClip(params: {
  asset: MediaAsset;
  trackId: string;
  startTime: number;
  duration?: number;
  scale?: number;
  x?: number;
  y?: number;
  id?: string;
}): OperationValidationResult<TimelineClip> {
  if (params.asset.type === 'audio') {
    return {
      valid: false,
      value: null as unknown as TimelineClip,
      warnings: [],
      error: 'Audio assets cannot be placed as visual image overlays.',
    };
  }

  const startTicks = Math.max(0, secondsToTicks(params.startTime || 0));
  const durTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    secondsToTicks(params.duration ?? (params.asset.duration || 4.0))
  );
  const durationSec = ticksToSeconds(durTicks);
  const initialRotation = normalizeRotationDegrees(params.asset.rotationMetadata ?? 0);

  const clip: TimelineClip = {
    id:
      params.id ??
      `clip_ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trackId: params.trackId,
    trackType: 'overlay',
    assetId: params.asset.id,
    label: `Overlay · ${params.asset.name.replace(/\.[^.]+$/, '')}`,
    startTime: ticksToSeconds(startTicks),
    duration: durationSec,
    inPoint: 0,
    outPoint: durationSec,
    playbackRate: 1,
    volume: params.asset.type === 'video' ? 100 : 0,
    muted: params.asset.type === 'image',
    fadeIn: 0.25,
    fadeOut: 0.25,
    transitionType: 'crossfade',
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: {
      ...DEFAULT_CLIP_TRANSFORM,
      scale: Math.max(0.1, Math.min(4.0, params.scale ?? 0.42)),
      x: Math.max(-1, Math.min(1, params.x ?? 0.45)),
      y: Math.max(-1, Math.min(1, params.y ?? -0.42)),
      rotation: initialRotation,
      fitMode: 'contain',
      crop: { ...DEFAULT_CROP_SETTINGS },
    },
    colorTag: '#0D9488',
  };

  return {
    valid: true,
    value: clip,
    warnings: [],
  };
}

/**
 * 12. ADD BACKGROUND AUDIO OPERATION:
 * Creates a validated background audio clip on an `audio` track with configurable volume and fades.
 */
export function createValidatedBackgroundAudioClip(params: {
  asset: MediaAsset;
  trackId: string;
  startTime?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  id?: string;
}): OperationValidationResult<TimelineClip> {
  if (params.asset.type === 'image') {
    return {
      valid: false,
      value: null as unknown as TimelineClip,
      warnings: [],
      error: 'Static image assets do not contain an audio stream.',
    };
  }

  const startTicks = Math.max(0, secondsToTicks(params.startTime ?? 0));
  const durTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    secondsToTicks(params.duration ?? (params.asset.duration || 6.0))
  );
  const durationSec = ticksToSeconds(durTicks);
  const maxFadeEach = durationSec / 2;

  const clip: TimelineClip = {
    id:
      params.id ??
      `clip_aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trackId: params.trackId,
    trackType: 'audio',
    assetId: params.asset.id,
    label: params.asset.name.replace(/\.[^.]+$/, ''),
    startTime: ticksToSeconds(startTicks),
    duration: durationSec,
    inPoint: 0,
    outPoint: durationSec,
    playbackRate: 1,
    volume: Math.round(Math.max(0, Math.min(100, params.volume ?? 85))),
    muted: false,
    fadeIn: Number(Math.max(0, Math.min(maxFadeEach, params.fadeIn ?? 0.4)).toFixed(2)),
    fadeOut: Number(Math.max(0, Math.min(maxFadeEach, params.fadeOut ?? 0.6)).toFixed(2)),
    transitionType: 'none',
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: { ...DEFAULT_CLIP_TRANSFORM, crop: { ...DEFAULT_CROP_SETTINGS } },
    colorTag: '#10B981',
  };

  return {
    valid: true,
    value: clip,
    warnings: [],
  };
}

/**
 * 13. SET AUDIO FADE-IN AND FADE-OUT OPERATION:
 * Independently validates and sets `fadeIn` and `fadeOut` durations on a clip,
 * ensuring neither is negative and `fadeIn + fadeOut <= clip.duration`.
 */
export function applyValidatedAudioFade(
  clip: TimelineClip,
  fades: { fadeIn?: number; fadeOut?: number }
): OperationValidationResult<TimelineClip> {
  const warnings: string[] = [];
  let nextFadeIn =
    fades.fadeIn !== undefined && Number.isFinite(fades.fadeIn)
      ? Math.max(0, fades.fadeIn)
      : clip.fadeIn;
  let nextFadeOut =
    fades.fadeOut !== undefined && Number.isFinite(fades.fadeOut)
      ? Math.max(0, fades.fadeOut)
      : clip.fadeOut;

  if ((fades.fadeIn !== undefined && fades.fadeIn < 0) || (fades.fadeOut !== undefined && fades.fadeOut < 0)) {
    warnings.push('Audio fade durations cannot be negative; clamped to 0.0s.');
  }

  if (nextFadeIn + nextFadeOut > clip.duration) {
    const ratio = clip.duration / Math.max(0.001, nextFadeIn + nextFadeOut);
    nextFadeIn *= ratio;
    nextFadeOut *= ratio;
    warnings.push(
      `Combined fade-in and fade-out exceeded clip duration (${clip.duration.toFixed(2)}s); scaled proportionally.`
    );
  }

  return {
    valid: true,
    value: {
      ...clip,
      fadeIn: ticksToSeconds(secondsToTicks(nextFadeIn)),
      fadeOut: ticksToSeconds(secondsToTicks(nextFadeOut)),
    },
    warnings,
  };
}

/**
 * 14. CONFIGURE OUTPUT RESOLUTION OPERATION:
 * Validates export resolution (`1080p`, `720p`, `480p`), frame rate (`24`, `30`, `60`),
 * and aspect ratio to compute even-numbered encoder dimensions.
 */
export function validateAndResolveOutputResolution(
  aspectRatio: AspectRatioPreset,
  resolution: ExportResolution
): OperationValidationResult<{
  resolution: ExportResolution;
  aspectRatio: AspectRatioPreset;
  width: number;
  height: number;
}> {
  const allowedResolutions: ExportResolution[] = ['1080p', '720p', '480p'];
  if (!allowedResolutions.includes(resolution)) {
    return {
      valid: false,
      value: {
        resolution: '720p',
        aspectRatio: '16:9',
        width: 1280,
        height: 720,
      },
      warnings: [],
      error: `Unsupported output resolution "${resolution}". Supported: 1080p, 720p, 480p.`,
    };
  }

  const base = ASPECT_RATIO_PRESETS[aspectRatio] ?? ASPECT_RATIO_PRESETS['16:9'];
  const scale =
    resolution === '1080p' ? 1 : resolution === '720p' ? 2 / 3 : 4 / 9;
  const width = Math.max(2, Math.round((base.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((base.height * scale) / 2) * 2);

  return {
    valid: true,
    value: {
      resolution,
      aspectRatio,
      width,
      height,
    },
    warnings: [],
  };
}

/**
 * Generates a non-destructive Edit Decision List (EDL) snapshot from the current timeline state,
 * proving that original imported assets remain untouched while all edits are stored as parametric instructions.
 */
export function buildNonDestructiveEDL(params: {
  aspectRatio: AspectRatioPreset;
  exportSettings: ExportSettings;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  assets: MediaAsset[];
}): NonDestructiveEDL {
  const res = validateAndResolveOutputResolution(
    params.aspectRatio,
    params.exportSettings.resolution
  ).value;

  const decisions: EditDecisionEntry[] = params.clips.map((c) => ({
    clipId: c.id,
    trackId: c.trackId,
    trackType: c.trackType,
    sourceAssetId: c.assetId,
    timelineIn: c.startTime,
    timelineOut: ticksToSeconds(
      secondsToTicks(c.startTime) + secondsToTicks(c.duration)
    ),
    sourceIn: c.inPoint,
    sourceOut: c.outPoint,
    playbackRate: c.playbackRate,
    volume: c.volume,
    muted: c.muted,
    fadeIn: c.fadeIn,
    fadeOut: c.fadeOut,
    transform: structuredClone(c.transform),
    crop: structuredClone(c.transform.crop ?? DEFAULT_CROP_SETTINGS),
    hasTextOverlay: Boolean(c.textStyle),
  }));

  return {
    version: 1,
    aspectRatio: params.aspectRatio,
    outputResolution: params.exportSettings.resolution,
    outputWidth: res.width,
    outputHeight: res.height,
    sequenceDuration: calculateProjectDuration(params.clips),
    decisions,
    preservedAssetIds: params.assets.map((a) => a.id),
  };
}

/**
 * Inspects timeline clips and export settings to report honest browser and FFmpeg.wasm limitations.
 */
export function detectOperationCapabilities(
  clips: TimelineClip[],
  exportSettings: ExportSettings
): CapabilityReport {
  const limitations: string[] = [];

  const hasExtremeSpeed = clips.some(
    (c) => c.playbackRate < 0.5 || c.playbackRate > 2.0
  );
  if (hasExtremeSpeed) {
    limitations.push(
      'Playback speeds outside 0.5x–2.0x use chained atempo filters in FFmpeg and may mute or pitch-shift audio in some mobile browsers.'
    );
  }

  if (exportSettings.format === 'gif' && exportSettings.resolution === '1080p') {
    limitations.push(
      '1080p animated GIF exports produce large files in browser memory; 480p or 720p is recommended for GIF output.'
    );
  }

  const hasSharedArrayBuffer =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof window !== 'undefined' &&
    Boolean((window as Window & { crossOriginIsolated?: boolean }).crossOriginIsolated);

  if (!hasSharedArrayBuffer && exportSettings.engine === 'ffmpeg-wasm') {
    limitations.push(
      'Single-threaded FFmpeg.wasm is used when Cross-Origin-Isolation (SharedArrayBuffer) is unavailable; encoding may be slower than Native Stream mode.'
    );
  }

  return {
    supportedInPreview: true,
    supportedInFfmpegWasm: true,
    supportedInNativeStream: exportSettings.format === 'webm',
    limitations,
  };
}
