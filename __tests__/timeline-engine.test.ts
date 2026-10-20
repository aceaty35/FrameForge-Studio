import { describe, it, expect } from 'vitest';
import {
  buildCssFilterString,
  calculateProjectDuration,
  closeTrackGaps,
  deleteClipAndRipple,
  detectTrackGaps,
  detectTrackOverlaps,
  filterVisibleClips,
  formatTimecode,
  framesToSeconds,
  getSourceTimeForClip,
  MIN_CLIP_DURATION,
  moveClipWithSnap,
  parseTimecode,
  quantizeToFrame,
  resolveActiveClipsAtTime,
  resolveTrackOverlaps,
  secondsToFrames,
  secondsToTicks,
  splitClipAtTime,
  ticksToSeconds,
  trimClipEnd,
  trimClipStart,
} from '@/lib/timeline/engine';
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_VIDEO_FILTERS,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_1',
    trackId: 'track_video_1',
    trackType: 'video',
    assetId: 'asset_1',
    label: 'Test Clip',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    playbackRate: 1,
    volume: 100,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    ...overrides,
  };
}

const tracks: TimelineTrack[] = [
  {
    id: 'track_text_1',
    name: 'Text',
    type: 'text',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_overlay_1',
    name: 'Overlay',
    type: 'overlay',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_video_1',
    name: 'Video 1',
    type: 'video',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_video_2',
    name: 'Video 2',
    type: 'video',
    muted: false,
    hidden: false,
    locked: false,
  },
];

describe('Timeline Engine Pure Functions & Rational Timebase', () => {
  it('converts between rational ticks, frames, and seconds without floating-point accumulation errors', () => {
    // Classic IEEE-754 drift check: 0.1 + 0.2 in JS is 0.30000000000000004
    const sumTicks = secondsToTicks(0.1) + secondsToTicks(0.2);
    expect(ticksToSeconds(sumTicks)).toBe(0.3);

    // Repeated frame stepping over 300 frames at 30fps must equal exactly 10.0s
    let accTicks = 0;
    const oneFrameTicks = secondsToTicks(framesToSeconds(1, 30));
    for (let i = 0; i < 300; i++) {
      accTicks += oneFrameTicks;
    }
    expect(ticksToSeconds(accTicks)).toBe(10);

    expect(secondsToFrames(1.5, 30)).toBe(45);
    expect(framesToSeconds(45, 30)).toBe(1.5);
    expect(quantizeToFrame(1.016, 30)).toBeCloseTo(1.0, 2);
  });

  it('formats and parses SMPTE-style tabular timecodes accurately', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(65.42)).toBe('01:05.42');
    expect(formatTimecode(3661.5, true)).toBe('01:01:01.50');

    expect(parseTimecode('01:05.50')).toBe(65.5);
    expect(parseTimecode('01:00:02.25')).toBe(3602.25);
    expect(parseTimecode('12.25')).toBe(12.25);
    expect(parseTimecode('invalid')).toBeNull();
  });

  it('calculates total project duration across multiple clips using integer ticks', () => {
    const clips = [
      makeClip({ id: 'c1', startTime: 0, duration: 4.1 }),
      makeClip({ id: 'c2', startTime: 4.1, duration: 6.2 }),
      makeClip({ id: 'c3', startTime: 2.0, duration: 3.0 }),
    ];
    expect(calculateProjectDuration(clips)).toBe(10.3);
    expect(calculateProjectDuration([])).toBe(0);
  });

  it('resolves active clips at a given playhead timestamp following explicit compositing rules', () => {
    const videoBottom = makeClip({
      id: 'v_bottom',
      trackId: 'track_video_2',
      trackType: 'video',
      startTime: 0,
      duration: 5,
    });
    const videoTop = makeClip({
      id: 'v_top',
      trackId: 'track_video_1',
      trackType: 'video',
      startTime: 0,
      duration: 5,
    });
    const overlayClip = makeClip({
      id: 'ov_1',
      trackId: 'track_overlay_1',
      trackType: 'overlay',
      startTime: 1,
      duration: 4,
    });
    const textClip = makeClip({
      id: 't1',
      trackId: 'track_text_1',
      trackType: 'text',
      startTime: 1,
      duration: 3,
    });

    const activeAt2s = resolveActiveClipsAtTime(
      [textClip, videoTop, overlayClip, videoBottom],
      tracks,
      2.0
    );
    // Compositing order from bottom to top: video_2 -> video_1 -> overlay_1 -> text_1
    expect(activeAt2s.map((c) => c.id)).toEqual([
      'v_bottom',
      'v_top',
      'ov_1',
      't1',
    ]);
  });

  it('trims clip start (inPoint) and end (outPoint) non-destructively while preventing invalid durations', () => {
    const clip = makeClip({
      startTime: 2,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
    });
    const trimmedLeft = trimClipStart(clip, 3.5, 10);
    expect(trimmedLeft.startTime).toBe(3.5);
    expect(trimmedLeft.duration).toBe(6.5);
    expect(trimmedLeft.inPoint).toBe(1.5);

    // Attempting to trim start past the clip's end clamps to MIN_CLIP_DURATION (0.2s)
    const overTrimmedLeft = trimClipStart(clip, 25.0, 10);
    expect(overTrimmedLeft.duration).toBe(MIN_CLIP_DURATION);
    expect(overTrimmedLeft.startTime).toBe(10 - MIN_CLIP_DURATION);

    const trimmedRight = trimClipEnd(trimmedLeft, 4.0, 10);
    expect(trimmedRight.duration).toBe(4.0);
    expect(trimmedRight.outPoint).toBe(5.5);

    // Attempting to trim duration to 0 or negative clamps to MIN_CLIP_DURATION
    const overTrimmedRight = trimClipEnd(trimmedLeft, -3.0, 10);
    expect(overTrimmedRight.duration).toBe(MIN_CLIP_DURATION);
  });

  it('splits a clip at playhead into two contiguous clips with accurate source in/out points', () => {
    const clip = makeClip({
      startTime: 2,
      duration: 6,
      inPoint: 1,
      outPoint: 7,
    });
    const result = splitClipAtTime(clip, 4.5, () => 'clip_part_2');
    expect(result).not.toBeNull();
    if (!result) return;
    const [left, right] = result;
    expect(left.startTime).toBe(2);
    expect(left.duration).toBe(2.5);
    expect(left.inPoint).toBe(1);
    expect(left.outPoint).toBe(3.5);

    expect(right.id).toBe('clip_part_2');
    expect(right.startTime).toBe(4.5);
    expect(right.duration).toBe(3.5);
    expect(right.inPoint).toBe(3.5);
    expect(right.outPoint).toBe(7);
  });

  it('rejects splitting when playhead is outside clip or closer than MIN_CLIP_DURATION', () => {
    const clip = makeClip({ startTime: 2, duration: 6 });
    expect(splitClipAtTime(clip, 1.5)).toBeNull();
    expect(splitClipAtTime(clip, 2.05)).toBeNull();
    expect(splitClipAtTime(clip, 7.95)).toBeNull();
  });

  it('snaps clip movement to adjacent clip edges or playhead within threshold', () => {
    const c1 = makeClip({ id: 'c1', startTime: 0, duration: 5 });
    const c2 = makeClip({ id: 'c2', startTime: 6, duration: 4 });
    // Moving c2 start to 5.08s should snap to c1 end at 5.00s
    const snappedToEnd = moveClipWithSnap(c2, 5.08, [c1, c2], 2.0, true, 0.15);
    expect(snappedToEnd).toBe(5);

    // Moving c2 so its tail (start + 4s) is near playhead at 12.0s (e.g. proposed start 7.92s -> tail 11.92s)
    const snappedTailToPlayhead = moveClipWithSnap(
      c2,
      7.92,
      [c1, c2],
      12.0,
      true,
      0.15
    );
    expect(snappedTailToPlayhead).toBe(8);
  });

  it('detects and closes gaps between clips on a track', () => {
    const c1 = makeClip({
      id: 'c1',
      trackId: 'track_video_1',
      startTime: 1.0,
      duration: 3.0,
    });
    const c2 = makeClip({
      id: 'c2',
      trackId: 'track_video_1',
      startTime: 6.5,
      duration: 2.5,
    });

    const gaps = detectTrackGaps([c1, c2], 'track_video_1');
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({
      trackId: 'track_video_1',
      startTime: 0,
      endTime: 1.0,
      duration: 1.0,
    });
    expect(gaps[1]).toEqual({
      trackId: 'track_video_1',
      startTime: 4.0,
      endTime: 6.5,
      duration: 2.5,
    });

    const packed = closeTrackGaps([c1, c2], 'track_video_1');
    expect(packed.find((c) => c.id === 'c1')?.startTime).toBe(0);
    expect(packed.find((c) => c.id === 'c2')?.startTime).toBe(3.0);
    expect(detectTrackGaps(packed, 'track_video_1')).toHaveLength(0);
  });

  it('detects and resolves overlapping clips on the same track', () => {
    const c1 = makeClip({
      id: 'c1',
      trackId: 'track_video_1',
      startTime: 0,
      duration: 5.0,
    });
    const c2 = makeClip({
      id: 'c2',
      trackId: 'track_video_1',
      startTime: 3.5,
      duration: 4.0,
    });

    const overlaps = detectTrackOverlaps([c1, c2], 'track_video_1');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].overlapDuration).toBe(1.5);

    const resolved = resolveTrackOverlaps([c1, c2], 'track_video_1');
    expect(resolved.find((c) => c.id === 'c1')?.startTime).toBe(0);
    expect(resolved.find((c) => c.id === 'c2')?.startTime).toBe(5.0);
    expect(detectTrackOverlaps(resolved, 'track_video_1')).toHaveLength(0);
  });

  it('deletes a clip and ripples subsequent clips on the same track when ripple is enabled', () => {
    const c1 = makeClip({
      id: 'c1',
      trackId: 'track_video_1',
      startTime: 0,
      duration: 4,
    });
    const c2 = makeClip({
      id: 'c2',
      trackId: 'track_video_1',
      startTime: 4,
      duration: 3,
    });
    const c3 = makeClip({
      id: 'c3',
      trackId: 'track_video_1',
      startTime: 7,
      duration: 2,
    });

    const afterRipple = deleteClipAndRipple([c1, c2, c3], 'c2', true);
    expect(afterRipple).toHaveLength(2);
    expect(afterRipple.find((c) => c.id === 'c3')?.startTime).toBe(4);
  });

  it('virtualizes visible clips within a horizontal viewport window', () => {
    const manyClips = Array.from({ length: 50 }, (_, i) =>
      makeClip({
        id: `clip_${i}`,
        startTime: i * 5,
        duration: 4,
      })
    );
    // Viewport from 20s to 40s with 2s overscan should only include clips intersecting [18s, 42s]
    const visible = filterVisibleClips(manyClips, 20, 40, 2);
    expect(visible.length).toBeLessThan(10);
    expect(visible.some((c) => c.id === 'clip_0')).toBe(false);
    expect(visible.some((c) => c.id === 'clip_5')).toBe(true); // 25s..29s
  });

  it('computes source time with playbackRate and builds CSS filter strings', () => {
    const fastClip = makeClip({
      startTime: 2,
      duration: 4,
      inPoint: 1,
      outPoint: 9,
      playbackRate: 2,
    });
    expect(getSourceTimeForClip(fastClip, 3.5)).toBe(4);

    const filterStr = buildCssFilterString({
      ...DEFAULT_VIDEO_FILTERS,
      brightness: 120,
      contrast: 110,
    });
    expect(filterStr).toBe('brightness(120%) contrast(110%)');
  });
});
