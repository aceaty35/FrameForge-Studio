import { describe, it, expect, vi } from 'vitest';
import {
  computeEffectiveClipAudioVolume,
  describeMediaError,
  TimelinePlaybackScheduler,
} from '@/lib/renderer/playback-scheduler';
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_VIDEO_FILTERS,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_v1',
    trackId: 'track_video_1',
    trackType: 'video',
    assetId: 'asset_v1',
    label: 'Scene 1',
    startTime: 0,
    duration: 4,
    inPoint: 1,
    outPoint: 5,
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
    name: 'Titles',
    type: 'text',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_video_1',
    name: 'Video V1',
    type: 'video',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_audio_1',
    name: 'Audio A1',
    type: 'audio',
    muted: false,
    hidden: false,
    locked: false,
  },
];

function createMockAudioElement() {
  const el = {
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    paused: true,
    play: vi.fn(async () => {
      el.paused = false;
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
  };
  return el as unknown as HTMLAudioElement;
}

describe('TimelinePlaybackScheduler & Multi-Clip Preview Synchronization', () => {
  it('handles play, pause, and prevents starting duplicate rAF playback loops', () => {
    let rafQueueCount = 0;
    const requestFrame = vi.fn(() => {
      rafQueueCount += 1;
      return rafQueueCount;
    });
    const cancelFrame = vi.fn();
    const onPlayStateChange = vi.fn();

    const scheduler = new TimelinePlaybackScheduler(
      { onPlayStateChange },
      { requestFrame, cancelFrame }
    );
    scheduler.setTimelineModel({
      clips: [makeClip({ startTime: 0, duration: 5 })],
      tracks,
      isLooping: false,
    });

    scheduler.play();
    expect(scheduler.getIsPlaying()).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(onPlayStateChange).toHaveBeenCalledWith(true);

    // Calling play() again while already playing must NOT schedule a duplicate loop
    scheduler.play();
    expect(requestFrame).toHaveBeenCalledTimes(1);

    scheduler.pause();
    expect(scheduler.getIsPlaying()).toBe(false);
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(onPlayStateChange).toHaveBeenCalledWith(false);
  });

  it('tracks clip entry/exit boundaries and detects empty timeline gaps', () => {
    const clip1 = makeClip({
      id: 'clip_1',
      startTime: 0,
      duration: 2.0,
      inPoint: 0,
      outPoint: 2.0,
    });
    // Gap between 2.0s and 3.5s
    const clip2 = makeClip({
      id: 'clip_2',
      startTime: 3.5,
      duration: 2.5,
      inPoint: 0,
      outPoint: 2.5,
    });

    const scheduler = new TimelinePlaybackScheduler();
    scheduler.setTimelineModel({
      clips: [clip1, clip2],
      tracks,
      isLooping: false,
    });

    // Seek to 0.5s: inside clip_1
    const stateAt0_5 = scheduler.seek(0.5);
    expect(stateAt0_5.isInGap).toBe(false);
    expect(stateAt0_5.activeClips.map((c) => c.id)).toEqual(['clip_1']);
    expect(stateAt0_5.enteredClipIds).toEqual(['clip_1']);

    // Step forward by 2.0s -> 2.5s (inside the 2.0s..3.5s gap)
    const stateAt2_5 = scheduler.step(2.0);
    expect(stateAt2_5.timelineTime).toBe(2.5);
    expect(stateAt2_5.isInGap).toBe(true);
    expect(stateAt2_5.activeClips).toHaveLength(0);
    expect(stateAt2_5.exitedClipIds).toEqual(['clip_1']);

    // Step forward by 1.5s -> 4.0s (enters clip_2)
    const stateAt4_0 = scheduler.step(1.5);
    expect(stateAt4_0.timelineTime).toBe(4.0);
    expect(stateAt4_0.isInGap).toBe(false);
    expect(stateAt4_0.enteredClipIds).toEqual(['clip_2']);
  });

  it('synchronizes audio elements across clip boundaries and pauses audio in gaps', () => {
    const audioClip = makeClip({
      id: 'audio_c1',
      trackId: 'track_audio_1',
      trackType: 'audio',
      assetId: 'asset_audio_1',
      startTime: 1.0,
      duration: 3.0,
      inPoint: 10.0,
      outPoint: 16.0,
      playbackRate: 2.0,
      volume: 80,
      fadeIn: 1.0,
      fadeOut: 1.0,
    });

    const mockAudio = createMockAudioElement();
    const audioPool = new Map<string, HTMLAudioElement>([
      ['asset_audio_1', mockAudio],
    ]);

    const scheduler = new TimelinePlaybackScheduler(
      {},
      { requestFrame: () => 1, cancelFrame: () => undefined }
    );
    scheduler.setTimelineModel({
      clips: [audioClip],
      tracks,
      isLooping: false,
    });
    scheduler.setMediaPools(new Map(), audioPool);

    // Seek to 1.5s (0.5s into clip with 1.0s fadeIn at 80% volume -> effective volume = 0.4)
    scheduler.seek(1.5);
    scheduler.play();

    // Source time at 1.5s (0.5s elapsed * 2.0x rate + 10.0s inPoint = 11.0s)
    expect(mockAudio.currentTime).toBe(11.0);
    expect(mockAudio.playbackRate).toBe(2.0);
    expect(mockAudio.volume).toBeCloseTo(0.4, 3);
    expect(mockAudio.paused).toBe(false);

    // Seek to 0.2s (before audio clip starts) -> audio element must immediately pause
    scheduler.seek(0.2);
    expect(mockAudio.paused).toBe(true);
  });

  it('supports isolated previewRange playback for a selected clip and stops or loops at clip end', () => {
    const c1 = makeClip({ id: 'c1', startTime: 0, duration: 3 });
    const c2 = makeClip({ id: 'c2', startTime: 3, duration: 4 });

    const scheduler = new TimelinePlaybackScheduler(
      {},
      { requestFrame: () => 1, cancelFrame: () => undefined }
    );
    scheduler.setTimelineModel({
      clips: [c1, c2],
      tracks,
      isLooping: true,
      previewRange: { startTime: 3, endTime: 7 },
    });

    scheduler.seek(6.5);
    scheduler.play();

    // Stepping 0.8s crosses 7.0s endTime of selected clip -> wraps back to 3.0s startTime
    const loopedState = scheduler.step(0.8);
    expect(loopedState.timelineTime).toBe(3.0);

    // With looping disabled, stepping past endTime stops at 7.0s and pauses
    scheduler.setTimelineModel({
      clips: [c1, c2],
      tracks,
      isLooping: false,
      previewRange: { startTime: 3, endTime: 7 },
    });
    scheduler.seek(6.5);
    const stoppedState = scheduler.step(0.8);
    expect(stoppedState.timelineTime).toBe(7.0);
    expect(scheduler.getIsPlaying()).toBe(false);
  });

  it('computes audio fade envelopes and mute states accurately', () => {
    const clip = makeClip({
      startTime: 2,
      duration: 6,
      volume: 100,
      fadeIn: 2,
      fadeOut: 2,
    });
    const activeTrack = tracks[1];

    // At 3.0s (1.0s into 2.0s fadeIn) -> 50% volume
    expect(
      computeEffectiveClipAudioVolume(clip, activeTrack, 3.0, false)
    ).toEqual({
      volume: 0.5,
      muted: false,
    });

    // At 5.0s (middle of clip) -> 100% volume
    expect(
      computeEffectiveClipAudioVolume(clip, activeTrack, 5.0, false)
    ).toEqual({
      volume: 1,
      muted: false,
    });

    // Master mute overrides volume to 0
    expect(
      computeEffectiveClipAudioVolume(clip, activeTrack, 5.0, true)
    ).toEqual({
      volume: 0,
      muted: true,
    });
  });

  it('reports actionable unsupported format errors and cleans up all resources on dispose()', () => {
    const onMediaError = vi.fn();
    const cancelFrame = vi.fn();
    const mockAudio = createMockAudioElement();

    const scheduler = new TimelinePlaybackScheduler(
      { onMediaError },
      { requestFrame: () => 42, cancelFrame }
    );
    scheduler.setTimelineModel({
      clips: [
        makeClip({
          id: 'a1',
          trackId: 'track_audio_1',
          trackType: 'audio',
          assetId: 'bad_asset',
        }),
      ],
      tracks,
    });
    scheduler.setMediaPools(
      new Map(),
      new Map([['bad_asset', mockAudio]])
    );

    const msg = scheduler.reportAssetError('bad_asset', 'corrupt_hevc.mkv', 4);
    expect(msg).toContain('Unsupported media format or codec');
    expect(onMediaError).toHaveBeenCalledWith(
      'bad_asset',
      'corrupt_hevc.mkv',
      msg
    );
    expect(describeMediaError('clip.mov', 3)).toContain('hardware decoder');

    scheduler.play();
    scheduler.dispose();
    expect(scheduler.getIsPlaying()).toBe(false);
    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(mockAudio.pause).toHaveBeenCalled();
  });
});
