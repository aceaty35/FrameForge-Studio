import { TimelineClip, TimelineTrack, TrackType } from '@/types/editor';

/**
 * Rational integer timebase: 60,000 ticks per second.
 * Divides evenly into 24, 25, 30, 48, 50, 60, 100, and 1000 FPS with zero floating-point drift.
 */
export const TICKS_PER_SECOND = 60_000;
export const MIN_CLIP_DURATION_TICKS = 12_000; // 0.200 seconds (200ms)
export const MIN_CLIP_DURATION = MIN_CLIP_DURATION_TICKS / TICKS_PER_SECOND;
export const DEFAULT_SNAP_THRESHOLD = 0.15; // 150ms snap threshold

export interface TimelineGap {
  trackId: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface TimelineOverlap {
  trackId: string;
  clipAId: string;
  clipBId: string;
  overlapStart: number;
  overlapEnd: number;
  overlapDuration: number;
}

/**
 * Converts seconds to exact integer ticks in the 60,000 Hz rational timebase.
 */
export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * TICKS_PER_SECOND);
}

/**
 * Converts integer ticks back to seconds without floating-point accumulation drift.
 */
export function ticksToSeconds(ticks: number): number {
  if (!Number.isFinite(ticks)) return 0;
  const roundedTicks = Math.round(ticks);
  // 6 decimal places is exact for 1/60000s while eliminating IEEE-754 tail noise like 0.30000000000000004
  return Number((roundedTicks / TICKS_PER_SECOND).toFixed(6));
}

/**
 * Converts seconds to an integer frame index at the given frame rate (default 30 fps).
 */
export function secondsToFrames(seconds: number, fps = 30): number {
  const safeFps = Math.max(1, fps);
  const ticks = secondsToTicks(Math.max(0, seconds));
  const ticksPerFrame = Math.round(TICKS_PER_SECOND / safeFps);
  return Math.round(ticks / ticksPerFrame);
}

/**
 * Converts an integer frame index to exact rational seconds at the given frame rate.
 */
export function framesToSeconds(frames: number, fps = 30): number {
  const safeFps = Math.max(1, fps);
  const ticksPerFrame = Math.round(TICKS_PER_SECOND / safeFps);
  return ticksToSeconds(Math.round(frames) * ticksPerFrame);
}

/**
 * Quantizes any timestamp in seconds to the nearest exact frame boundary.
 */
export function quantizeToFrame(seconds: number, fps = 30): number {
  return framesToSeconds(secondsToFrames(seconds, fps), fps);
}

/**
 * Formats seconds into SMPTE-style tabular timecode: MM:SS.FF (hundredths) or HH:MM:SS.FF
 */
export function formatTimecode(seconds: number, includeHours = false): string {
  const clampedTicks = Math.max(0, secondsToTicks(seconds));
  const totalCentiseconds = Math.round((clampedTicks * 100) / TICKS_PER_SECOND);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (includeHours || h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
  }
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * Parses a timecode string (MM:SS.CC or HH:MM:SS.CC or SS.CC) into exact rational seconds.
 */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length === 1) {
    const val = Number(parts[0]);
    return Number.isFinite(val) && val >= 0 ? ticksToSeconds(secondsToTicks(val)) : null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0) return null;
    return ticksToSeconds(secondsToTicks(m * 60 + s));
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
    if (h < 0 || m < 0 || s < 0) return null;
    return ticksToSeconds(secondsToTicks(h * 3600 + m * 60 + s));
  }
  return null;
}

/**
 * Computes total duration of the timeline across all clips using integer ticks.
 */
export function calculateProjectDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 0;
  let maxEndTicks = 0;
  for (const clip of clips) {
    const endTicks = secondsToTicks(clip.startTime) + secondsToTicks(clip.duration);
    if (endTicks > maxEndTicks) {
      maxEndTicks = endTicks;
    }
  }
  return ticksToSeconds(maxEndTicks);
}

/**
 * Resolves all active clips at playhead timestamp `time`, ordered from bottom layer to top layer
 * according to explicit compositing rules:
 * 1. Track type layer order: video (bottom) -> overlay -> text -> audio
 * 2. Track list order (bottom-most track in same type renders underneath higher track)
 * 3. Within the same track: clip with later startTime (or later insertion index) renders on top.
 */
export function resolveActiveClipsAtTime(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  time: number
): TimelineClip[] {
  const trackMap = new Map<string, TimelineTrack>();
  const trackOrderMap = new Map<string, number>();
  tracks.forEach((t, idx) => {
    trackMap.set(t.id, t);
    trackOrderMap.set(t.id, idx);
  });

  const layerPriority: Record<TrackType, number> = {
    video: 1,
    overlay: 2,
    text: 3,
    audio: 4,
  };

  const targetTicks = secondsToTicks(time);
  const clipIndexMap = new Map<string, number>();
  clips.forEach((c, idx) => clipIndexMap.set(c.id, idx));

  return clips
    .filter((clip) => {
      const track = trackMap.get(clip.trackId);
      if (track?.hidden && clip.trackType !== 'audio') return false;
      const startTicks = secondsToTicks(clip.startTime);
      const endTicks = startTicks + secondsToTicks(clip.duration);
      return targetTicks >= startTicks && targetTicks < endTicks;
    })
    .sort((a, b) => {
      const pA = layerPriority[a.trackType] ?? 99;
      const pB = layerPriority[b.trackType] ?? 99;
      if (pA !== pB) return pA - pB;

      const tIdxA = trackOrderMap.get(a.trackId) ?? 0;
      const tIdxB = trackOrderMap.get(b.trackId) ?? 0;
      if (tIdxA !== tIdxB) return tIdxB - tIdxA;

      const startDiff = secondsToTicks(a.startTime) - secondsToTicks(b.startTime);
      if (startDiff !== 0) return startDiff;

      return (clipIndexMap.get(a.id) ?? 0) - (clipIndexMap.get(b.id) ?? 0);
    });
}

/**
 * Computes the corresponding source media timestamp for a clip at timeline playhead `timelineTime`.
 * Distinguishes timeline time from source media in/out bounds and playbackRate.
 */
export function getSourceTimeForClip(clip: TimelineClip, timelineTime: number): number {
  const offsetTicks = Math.max(
    0,
    secondsToTicks(timelineTime) - secondsToTicks(clip.startTime)
  );
  const rate = clip.playbackRate > 0 ? clip.playbackRate : 1;
  const scaledOffsetTicks = Math.round(offsetTicks * rate);
  const inTicks = secondsToTicks(clip.inPoint);
  const outTicks = secondsToTicks(clip.outPoint);
  const rawSourceTicks = inTicks + scaledOffsetTicks;
  const clampedTicks = Math.min(outTicks, Math.max(inTicks, rawSourceTicks));
  return ticksToSeconds(clampedTicks);
}

/**
 * Trims the left (start/inPoint) edge of a clip non-destructively using integer ticks.
 */
export function trimClipStart(
  clip: TimelineClip,
  newStartTime: number,
  maxAssetDuration?: number
): TimelineClip {
  const rate = clip.playbackRate > 0 ? clip.playbackRate : 1;
  const oldStartTicks = secondsToTicks(clip.startTime);
  const oldDurationTicks = secondsToTicks(clip.duration);
  const clipEndTicks = oldStartTicks + oldDurationTicks;
  const oldInTicks = secondsToTicks(clip.inPoint);

  const maxAllowedStartTicks = clipEndTicks - MIN_CLIP_DURATION_TICKS;
  const minAllowedStartTicks = oldStartTicks - Math.round(oldInTicks / rate);

  const proposedStartTicks = secondsToTicks(newStartTime);
  const clampedStartTicks = Math.max(
    0,
    minAllowedStartTicks,
    Math.min(maxAllowedStartTicks, proposedStartTicks)
  );

  const deltaTimelineTicks = clampedStartTicks - oldStartTicks;
  const deltaSourceTicks = Math.round(deltaTimelineTicks * rate);
  const newInTicks = Math.max(0, oldInTicks + deltaSourceTicks);
  const newDurationTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    clipEndTicks - clampedStartTicks
  );

  const oldOutTicks = secondsToTicks(clip.outPoint);
  const boundedOutTicks =
    maxAssetDuration !== undefined
      ? Math.min(secondsToTicks(maxAssetDuration), oldOutTicks)
      : oldOutTicks;

  return {
    ...clip,
    startTime: ticksToSeconds(clampedStartTicks),
    duration: ticksToSeconds(newDurationTicks),
    inPoint: ticksToSeconds(newInTicks),
    outPoint: ticksToSeconds(boundedOutTicks),
  };
}

/**
 * Trims the right (end/outPoint) edge of a clip non-destructively using integer ticks.
 */
export function trimClipEnd(
  clip: TimelineClip,
  newDuration: number,
  maxAssetDuration?: number
): TimelineClip {
  const rate = clip.playbackRate > 0 ? clip.playbackRate : 1;
  const inTicks = secondsToTicks(clip.inPoint);
  const maxDurationTicksFromSource =
    maxAssetDuration !== undefined && clip.assetId !== null
      ? Math.round(Math.max(MIN_CLIP_DURATION_TICKS, secondsToTicks(maxAssetDuration) - inTicks) / rate)
      : 3600 * TICKS_PER_SECOND;

  const proposedDurationTicks = secondsToTicks(newDuration);
  const clampedDurationTicks = Math.max(
    MIN_CLIP_DURATION_TICKS,
    Math.min(maxDurationTicksFromSource, proposedDurationTicks)
  );
  const newOutTicks = inTicks + Math.round(clampedDurationTicks * rate);

  return {
    ...clip,
    duration: ticksToSeconds(clampedDurationTicks),
    outPoint: ticksToSeconds(newOutTicks),
  };
}

/**
 * Splits a clip into two contiguous clips at `splitTime` (in timeline seconds) using exact ticks.
 * Returns `null` if `splitTime` is not strictly inside the clip with at least `MIN_CLIP_DURATION` on both sides.
 */
export function splitClipAtTime(
  clip: TimelineClip,
  splitTime: number,
  generateId: () => string = () => `clip_${Math.random().toString(36).slice(2, 10)}`
): [TimelineClip, TimelineClip] | null {
  const startTicks = secondsToTicks(clip.startTime);
  const durationTicks = secondsToTicks(clip.duration);
  const clipEndTicks = startTicks + durationTicks;
  const splitTicks = secondsToTicks(splitTime);

  if (
    splitTicks < startTicks + MIN_CLIP_DURATION_TICKS ||
    splitTicks > clipEndTicks - MIN_CLIP_DURATION_TICKS
  ) {
    return null;
  }

  const leftDurationTicks = splitTicks - startTicks;
  const rightDurationTicks = clipEndTicks - splitTicks;
  const rate = clip.playbackRate > 0 ? clip.playbackRate : 1;
  const inTicks = secondsToTicks(clip.inPoint);
  const splitSourceTicks = inTicks + Math.round(leftDurationTicks * rate);

  const leftClip: TimelineClip = {
    ...clip,
    duration: ticksToSeconds(leftDurationTicks),
    outPoint: ticksToSeconds(splitSourceTicks),
    fadeOut: 0,
  };

  const rightClip: TimelineClip = {
    ...clip,
    id: generateId(),
    label: `${clip.label} (Part 2)`,
    startTime: ticksToSeconds(splitTicks),
    duration: ticksToSeconds(rightDurationTicks),
    inPoint: ticksToSeconds(splitSourceTicks),
    fadeIn: 0,
  };

  return [leftClip, rightClip];
}

/**
 * Moves a clip along its track with optional magnetic snapping to other clip boundaries and playhead.
 */
export function moveClipWithSnap(
  clip: TimelineClip,
  proposedStartTime: number,
  allClips: TimelineClip[],
  playheadTime: number,
  snapEnabled = true,
  snapThreshold = DEFAULT_SNAP_THRESHOLD
): number {
  const targetStartTicks = Math.max(0, secondsToTicks(proposedStartTime));
  if (!snapEnabled) {
    return ticksToSeconds(targetStartTicks);
  }

  const clipDurationTicks = secondsToTicks(clip.duration);
  const thresholdTicks = secondsToTicks(snapThreshold);

  const candidateTicks: number[] = [0, secondsToTicks(playheadTime)];
  for (const other of allClips) {
    if (other.id === clip.id) continue;
    const oStart = secondsToTicks(other.startTime);
    const oEnd = oStart + secondsToTicks(other.duration);
    candidateTicks.push(oStart, oEnd);
  }

  let bestStartTicks = targetStartTicks;
  let minDistanceTicks = thresholdTicks;

  for (const ptTicks of candidateTicks) {
    const distStart = Math.abs(targetStartTicks - ptTicks);
    if (distStart < minDistanceTicks) {
      minDistanceTicks = distStart;
      bestStartTicks = ptTicks;
    }

    const targetEndTicks = targetStartTicks + clipDurationTicks;
    const distEnd = Math.abs(targetEndTicks - ptTicks);
    if (distEnd < minDistanceTicks) {
      minDistanceTicks = distEnd;
      bestStartTicks = Math.max(0, ptTicks - clipDurationTicks);
    }
  }

  return ticksToSeconds(bestStartTicks);
}

/**
 * Detects empty timeline gaps between clips on a given track (including leading gap from 0.0s).
 */
export function detectTrackGaps(
  clips: TimelineClip[],
  trackId: string
): TimelineGap[] {
  const trackClips = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => secondsToTicks(a.startTime) - secondsToTicks(b.startTime));

  if (trackClips.length === 0) return [];

  const gaps: TimelineGap[] = [];
  let cursorTicks = 0;

  for (const clip of trackClips) {
    const startTicks = secondsToTicks(clip.startTime);
    const endTicks = startTicks + secondsToTicks(clip.duration);
    if (startTicks > cursorTicks) {
      gaps.push({
        trackId,
        startTime: ticksToSeconds(cursorTicks),
        endTime: ticksToSeconds(startTicks),
        duration: ticksToSeconds(startTicks - cursorTicks),
      });
    }
    if (endTicks > cursorTicks) {
      cursorTicks = endTicks;
    }
  }

  return gaps;
}

/**
 * Closes all empty gaps between clips on the specified track by rippling clips left to pack contiguously from 0.0s.
 */
export function closeTrackGaps(
  clips: TimelineClip[],
  trackId: string
): TimelineClip[] {
  const trackClips = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => secondsToTicks(a.startTime) - secondsToTicks(b.startTime));

  if (trackClips.length === 0) return clips;

  let cursorTicks = 0;
  const packedMap = new Map<string, number>();

  for (const clip of trackClips) {
    packedMap.set(clip.id, ticksToSeconds(cursorTicks));
    cursorTicks += secondsToTicks(clip.duration);
  }

  return clips.map((c) => {
    const packedStart = packedMap.get(c.id);
    return packedStart !== undefined ? { ...c, startTime: packedStart } : c;
  });
}

/**
 * Detects overlapping clip intervals on the same track.
 */
export function detectTrackOverlaps(
  clips: TimelineClip[],
  trackId: string
): TimelineOverlap[] {
  const trackClips = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => secondsToTicks(a.startTime) - secondsToTicks(b.startTime));

  const overlaps: TimelineOverlap[] = [];
  for (let i = 0; i < trackClips.length; i++) {
    const a = trackClips[i];
    const aStart = secondsToTicks(a.startTime);
    const aEnd = aStart + secondsToTicks(a.duration);

    for (let j = i + 1; j < trackClips.length; j++) {
      const b = trackClips[j];
      const bStart = secondsToTicks(b.startTime);
      const bEnd = bStart + secondsToTicks(b.duration);

      if (bStart < aEnd) {
        const overStart = Math.max(aStart, bStart);
        const overEnd = Math.min(aEnd, bEnd);
        if (overEnd > overStart) {
          overlaps.push({
            trackId,
            clipAId: a.id,
            clipBId: b.id,
            overlapStart: ticksToSeconds(overStart),
            overlapEnd: ticksToSeconds(overEnd),
            overlapDuration: ticksToSeconds(overEnd - overStart),
          });
        }
      }
    }
  }
  return overlaps;
}

/**
 * Resolves overlapping clips on a track by pushing subsequent overlapping clips forward
 * so no two clips collide on the same track.
 */
export function resolveTrackOverlaps(
  clips: TimelineClip[],
  trackId: string
): TimelineClip[] {
  const trackClips = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => secondsToTicks(a.startTime) - secondsToTicks(b.startTime));

  if (trackClips.length <= 1) return clips;

  let minNextStartTicks = 0;
  const resolvedStartMap = new Map<string, number>();

  for (const clip of trackClips) {
    const currentStartTicks = secondsToTicks(clip.startTime);
    const effectiveStartTicks = Math.max(currentStartTicks, minNextStartTicks);
    resolvedStartMap.set(clip.id, ticksToSeconds(effectiveStartTicks));
    minNextStartTicks = effectiveStartTicks + secondsToTicks(clip.duration);
  }

  return clips.map((c) => {
    const resolvedStart = resolvedStartMap.get(c.id);
    return resolvedStart !== undefined ? { ...c, startTime: resolvedStart } : c;
  });
}

/**
 * Deletes a clip and optionally ripples subsequent clips on the same track backward to close the gap.
 */
export function deleteClipAndRipple(
  clips: TimelineClip[],
  clipIdToDelete: string,
  ripple = false
): TimelineClip[] {
  const target = clips.find((c) => c.id === clipIdToDelete);
  if (!target) return clips;

  const remaining = clips.filter((c) => c.id !== clipIdToDelete);
  if (!ripple) return remaining;

  const targetStartTicks = secondsToTicks(target.startTime);
  const targetDurationTicks = secondsToTicks(target.duration);
  const targetEndTicks = targetStartTicks + targetDurationTicks;

  return remaining.map((c) => {
    const cStartTicks = secondsToTicks(c.startTime);
    if (c.trackId === target.trackId && cStartTicks >= targetEndTicks) {
      return {
        ...c,
        startTime: ticksToSeconds(Math.max(0, cStartTicks - targetDurationTicks)),
      };
    }
    return c;
  });
}

/**
 * Filters clips to only those intersecting the visible horizontal timeline viewport window `[start, end]`.
 * Used for timeline virtualization when sequences contain many clips.
 */
export function filterVisibleClips(
  clips: TimelineClip[],
  visibleStartTime: number,
  visibleEndTime: number,
  overscanSeconds = 2.0
): TimelineClip[] {
  const minTicks = Math.max(0, secondsToTicks(visibleStartTime - overscanSeconds));
  const maxTicks = secondsToTicks(visibleEndTime + overscanSeconds);

  return clips.filter((clip) => {
    const startTicks = secondsToTicks(clip.startTime);
    const endTicks = startTicks + secondsToTicks(clip.duration);
    return endTicks >= minTicks && startTicks <= maxTicks;
  });
}

/**
 * Builds a CSS filter string from a clip's VideoFilterState.
 */
export function buildCssFilterString(filters: TimelineClip['filters']): string {
  const parts: string[] = [];
  if (filters.brightness !== 100) parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast}%)`);
  if (filters.saturation !== 100) parts.push(`saturate(${filters.saturation}%)`);
  if (filters.hueRotate !== 0) parts.push(`hue-rotate(${filters.hueRotate}deg)`);
  if (filters.sepia !== 0) parts.push(`sepia(${filters.sepia}%)`);
  if (filters.blur > 0) parts.push(`blur(${filters.blur}px)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}
