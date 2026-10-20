import {
  ASPECT_RATIO_PRESETS,
  AspectRatioPreset,
  DEFAULT_CROP_SETTINGS,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';
import {
  buildCssFilterString,
  getSourceTimeForClip,
  resolveActiveClipsAtTime,
} from '@/lib/timeline/engine';
import {
  computeTextBoundingBox,
  evaluateTextAnimationAtTime,
} from '@/lib/subtitles/text-and-subtitles';

export interface RenderFrameContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  canvasBackground: string;
  showSafeGuides: boolean;
  selectedClipId: string | null;
  mediaElements: Map<string, HTMLVideoElement | HTMLImageElement>;
}

/**
 * Renders a single composited frame at `time` onto `ctx`.
 * Designed for both 60fps interactive viewport preview and deterministic frame-by-frame export.
 */
export function renderCompositedFrame(params: RenderFrameContext): void {
  const {
    ctx,
    width,
    height,
    time,
    clips,
    tracks,
    canvasBackground,
    showSafeGuides,
    selectedClipId,
    mediaElements,
  } = params;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Fill base canvas background
  ctx.fillStyle = canvasBackground || '#090D16';
  ctx.fillRect(0, 0, width, height);

  // 2. Resolve active clips sorted by track layer priority
  const activeClips = resolveActiveClipsAtTime(clips, tracks, time);

  if (activeClips.length === 0) {
    drawStandbySlate(ctx, width, height, time);
  }

  for (const clip of activeClips) {
    if (clip.trackType === 'audio') continue;

    // Compute fade-in / fade-out opacity multiplier & transition progression
    const elapsedInClip = Math.max(0, time - clip.startTime);
    const remainingInClip = Math.max(0, clip.startTime + clip.duration - time);
    let fadeGain = 1;
    let transitionProgress = 1; // 0 at edge, 1 when fully settled

    if (clip.fadeIn > 0 && elapsedInClip < clip.fadeIn) {
      const ratio = elapsedInClip / clip.fadeIn;
      fadeGain = Math.min(fadeGain, ratio);
      transitionProgress = Math.min(transitionProgress, ratio);
    }
    if (clip.fadeOut > 0 && remainingInClip < clip.fadeOut) {
      const ratio = remainingInClip / clip.fadeOut;
      fadeGain = Math.min(fadeGain, ratio);
      transitionProgress = Math.min(transitionProgress, ratio);
    }

    const baseOpacity = (clip.filters.opacity ?? 100) / 100;
    const transitionType = clip.transitionType || 'crossfade';
    const effectiveAlpha =
      transitionType === 'dip-to-black' || transitionType === 'dip-to-white'
        ? Math.max(0, Math.min(1, baseOpacity))
        : Math.max(0, Math.min(1, baseOpacity * fadeGain));

    if (clip.trackType === 'text' && clip.textStyle) {
      drawTextOverlayClip(
        ctx,
        width,
        height,
        clip,
        time,
        Math.max(0, Math.min(1, baseOpacity * fadeGain)),
        clip.id === selectedClipId
      );
      continue;
    }

    if (clip.assetId) {
      const mediaEl = mediaElements.get(clip.assetId);
      if (mediaEl) {
        drawVisualMediaClip(
          ctx,
          width,
          height,
          clip,
          mediaEl,
          time,
          effectiveAlpha,
          transitionProgress,
          clip.id === selectedClipId
        );
      } else {
        drawProceduralClipFallback(ctx, width, height, clip, time, effectiveAlpha);
      }
    }

    // Apply Dip-to-Black or Dip-to-White overlay during transition window
    if (
      (transitionType === 'dip-to-black' || transitionType === 'dip-to-white') &&
      transitionProgress < 1
    ) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - transitionProgress));
      ctx.fillStyle = transitionType === 'dip-to-white' ? '#FFFFFF' : '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  // 3. Optional broadcast action/title safe area guides (90% action, 80% title)
  if (showSafeGuides) {
    drawBroadcastSafeZones(ctx, width, height);
  }

  ctx.restore();
}

function drawVisualMediaClip(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  clip: TimelineClip,
  mediaEl: HTMLVideoElement | HTMLImageElement,
  timelineTime: number,
  alpha: number,
  transitionProgress: number,
  isSelected: boolean
): void {
  ctx.save();

  ctx.globalAlpha = alpha;
  const cssFilter = buildCssFilterString(clip.filters);
  if (cssFilter !== 'none') {
    ctx.filter = cssFilter;
  }

  const sourceWidth =
    mediaEl instanceof HTMLVideoElement
      ? mediaEl.videoWidth || 1280
      : mediaEl.naturalWidth || 1280;
  const sourceHeight =
    mediaEl instanceof HTMLVideoElement
      ? mediaEl.videoHeight || 720
      : mediaEl.naturalHeight || 720;

  // Compute aspect-fit or aspect-cover box
  let drawW = canvasWidth;
  let drawH = canvasHeight;
  const srcRatio = sourceWidth / Math.max(1, sourceHeight);
  const dstRatio = canvasWidth / Math.max(1, canvasHeight);

  if (clip.transform.fitMode === 'contain') {
    if (srcRatio > dstRatio) {
      drawW = canvasWidth;
      drawH = canvasWidth / srcRatio;
    } else {
      drawH = canvasHeight;
      drawW = canvasHeight * srcRatio;
    }
  } else if (clip.transform.fitMode === 'cover') {
    if (srcRatio > dstRatio) {
      drawH = canvasHeight;
      drawW = canvasHeight * srcRatio;
    } else {
      drawW = canvasWidth;
      drawH = canvasWidth / srcRatio;
    }
  }

  const centerX = canvasWidth * (0.5 + (clip.transform.x || 0) * 0.5);
  const centerY = canvasHeight * (0.5 + (clip.transform.y || 0) * 0.5);

  ctx.translate(centerX, centerY);
  if (clip.transform.rotation) {
    ctx.rotate((clip.transform.rotation * Math.PI) / 180);
  }

  const zoomTransitionBoost =
    clip.transitionType === 'zoom-in' && transitionProgress < 1
      ? 0.85 + 0.15 * transitionProgress
      : 1;

  const baseScale = (clip.transform.scale || 1) * zoomTransitionBoost;
  const scaleX = baseScale * (clip.transform.flipH ? -1 : 1);
  const scaleY = baseScale * (clip.transform.flipV ? -1 : 1);
  ctx.scale(scaleX, scaleY);

  // Apply non-destructive crop clipping region if configured
  const crop = clip.transform.crop ?? DEFAULT_CROP_SETTINGS;
  const hasCrop = crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0;
  const cropX = -drawW / 2 + (drawW * crop.left) / 100;
  const cropY = -drawH / 2 + (drawH * crop.top) / 100;
  const cropW = Math.max(10, drawW * (1 - (crop.left + crop.right) / 100));
  const cropH = Math.max(10, drawH * (1 - (crop.top + crop.bottom) / 100));

  if (hasCrop) {
    ctx.beginPath();
    ctx.rect(cropX, cropY, cropW, cropH);
    ctx.clip();
  }

  try {
    ctx.drawImage(mediaEl, -drawW / 2, -drawH / 2, drawW, drawH);
  } catch {
    // Fallback if video frame is still decoding
  }

  // If this is a synthetic procedural sample image, animate a subtle timecode & progress bar overlay
  if (clip.label.includes('Calibration') || clip.label.includes('Architectural')) {
    const srcTime = getSourceTimeForClip(clip, timelineTime);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(-drawW * 0.22, drawH * 0.24, drawW * 0.44, drawH * 0.11);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-drawW * 0.22, drawH * 0.24, drawW * 0.44, drawH * 0.11);

    ctx.fillStyle = '#38BDF8';
    ctx.font = `600 ${Math.round(drawH * 0.042)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`SRC TC ${srcTime.toFixed(2)}s  |  RATE ${clip.playbackRate}x`, 0, drawH * 0.295);
  }

  if (isSelected) {
    ctx.filter = 'none';
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = Math.max(2, canvasWidth * 0.0025);
    ctx.strokeRect(cropX, cropY, cropW, cropH);
  }

  ctx.restore();
}

function drawProceduralClipFallback(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: TimelineClip,
  time: number,
  alpha: number
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0F172A');
  grad.addColorStop(1, '#1E293B');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(height * 0.045)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(clip.label, width / 2, height * 0.48);

  ctx.fillStyle = '#38BDF8';
  ctx.font = `500 ${Math.round(height * 0.028)}px monospace`;
  ctx.fillText(`PLAYHEAD ${time.toFixed(2)}s`, width / 2, height * 0.55);
  ctx.restore();
}

function drawTextOverlayClip(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  clip: TimelineClip,
  timelineTime: number,
  alpha: number,
  isSelected: boolean
): void {
  const style = clip.textStyle;
  if (!style || !style.text.trim()) return;

  const anim = evaluateTextAnimationAtTime(clip, timelineTime);
  if (!anim.visibleText.trim() || anim.opacityMultiplier <= 0) return;

  const effectiveStyle = {
    ...style,
    y: (style.y ?? 0.84) + anim.offsetYNormalized,
  };

  const metrics = computeTextBoundingBox(
    effectiveStyle,
    canvasWidth,
    canvasHeight,
    (line, _fontSize, fontSpec) => {
      ctx.font = fontSpec;
      return ctx.measureText(line).width;
    },
    anim.visibleText
  );

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * anim.opacityMultiplier));

  const rotationDeg =
    style.rotation !== undefined
      ? style.rotation
      : clip.transform.rotation || 0;

  ctx.translate(metrics.centerX, metrics.centerY);
  if (rotationDeg) {
    ctx.rotate((rotationDeg * Math.PI) / 180);
  }
  if (anim.scaleMultiplier !== 1) {
    ctx.scale(anim.scaleMultiplier, anim.scaleMultiplier);
  }

  const localBoxX = metrics.boxX - metrics.centerX;
  const localBoxY = metrics.boxY - metrics.centerY;
  const localAnchorX = metrics.anchorX - metrics.centerX;
  const localAnchorY = metrics.anchorY - metrics.centerY;

  if (style.backgroundColor && style.backgroundColor !== 'transparent') {
    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(
      localBoxX,
      localBoxY,
      metrics.boxWidth,
      metrics.boxHeight,
      Math.max(6, metrics.scaledFontSize * 0.2)
    );
    ctx.fill();
  }

  ctx.font = `${style.fontWeight || 700} ${metrics.scaledFontSize}px ${style.fontFamily || 'Plus Jakarta Sans, sans-serif'}`;
  ctx.textAlign = style.textAlign || 'center';
  ctx.textBaseline = 'middle';

  const totalHeight = metrics.lines.length * metrics.lineHeight;
  metrics.lines.forEach((line, idx) => {
    const lineY =
      localAnchorY - totalHeight / 2 + metrics.lineHeight * (idx + 0.5);
    if (style.outlineWidth > 0) {
      ctx.strokeStyle = style.outlineColor || '#000000';
      ctx.lineWidth = style.outlineWidth * metrics.scaleFactor;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, localAnchorX, lineY);
    }
    ctx.fillStyle = style.color || '#FFFFFF';
    ctx.fillText(line, localAnchorX, lineY);
  });

  if (isSelected) {
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = Math.max(2, 2 * metrics.scaleFactor);
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      localBoxX - 4,
      localBoxY - 4,
      metrics.boxWidth + 8,
      metrics.boxHeight + 8
    );

    // Draw corner drag handles for direct pointer manipulation
    ctx.setLineDash([]);
    ctx.fillStyle = '#38BDF8';
    const handleSize = Math.max(6, Math.round(8 * metrics.scaleFactor));
    const corners = [
      [localBoxX - 4, localBoxY - 4],
      [localBoxX + metrics.boxWidth + 4, localBoxY - 4],
      [localBoxX - 4, localBoxY + metrics.boxHeight + 4],
      [localBoxX + metrics.boxWidth + 4, localBoxY + metrics.boxHeight + 4],
    ];
    for (const [cx, cy] of corners) {
      ctx.fillRect(
        cx - handleSize / 2,
        cy - handleSize / 2,
        handleSize,
        handleSize
      );
    }
  }

  ctx.restore();
}

function drawStandbySlate(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, height * 0.42);
  ctx.lineTo(width / 2, height * 0.58);
  ctx.moveTo(width * 0.42, height / 2);
  ctx.lineTo(width * 0.58, height / 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.font = `500 ${Math.max(12, Math.round(height * 0.024))}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(`NO ACTIVE CLIP AT ${time.toFixed(2)}s`, width / 2, height * 0.64);
  ctx.restore();
}

function drawBroadcastSafeZones(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);

  // 90% Action Safe
  const actionX = width * 0.05;
  const actionY = height * 0.05;
  ctx.strokeRect(actionX, actionY, width * 0.9, height * 0.9);

  // 80% Title Safe
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.25)';
  const titleX = width * 0.1;
  const titleY = height * 0.1;
  ctx.strokeRect(titleX, titleY, width * 0.8, height * 0.8);

  // Center crosshair
  ctx.beginPath();
  ctx.moveTo(width / 2 - 12, height / 2);
  ctx.lineTo(width / 2 + 12, height / 2);
  ctx.moveTo(width / 2, height / 2 - 12);
  ctx.lineTo(width / 2, height / 2 + 12);
  ctx.stroke();

  ctx.restore();
}

export function getResolutionDimensions(
  aspectRatio: AspectRatioPreset,
  resolution: '1080p' | '720p' | '480p'
): { width: number; height: number } {
  const base = ASPECT_RATIO_PRESETS[aspectRatio];
  const scale = resolution === '1080p' ? 1 : resolution === '720p' ? 2 / 3 : 4 / 9;
  const width = Math.round((base.width * scale) / 2) * 2;
  const height = Math.round((base.height * scale) / 2) * 2;
  return { width, height };
}
