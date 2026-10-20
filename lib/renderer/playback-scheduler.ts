import {
  MediaAsset,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';
import {
  calculateProjectDuration,
  getSourceTimeForClip,
  resolveActiveClipsAtTime,
  secondsToTicks,
  ticksToSeconds,
} from '@/lib/timeline/engine';

export interface PlaybackRange {
  startTime: number;
  endTime: number;
}

export interface ClipAudioSyncState {
  clipId: string;
  assetId: string;
  targetSourceTime: number;
  effectiveVolume: number;
  muted: boolean;
  playbackRate: number;
}

export interface SchedulerFrameState {
  timelineTime: number;
  sequenceDuration: number;
  isPlaying: boolean;
  isInGap: boolean;
  activeClips: TimelineClip[];
  activeVisualClips: TimelineClip[];
  activeAudioStates: ClipAudioSyncState[];
  enteredClipIds: string[];
  exitedClipIds: string[];
}

export interface PlaybackSchedulerCallbacks {
  onFrame?: (state: SchedulerFrameState) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onTimeCommit?: (timelineTime: number) => void;
  onMediaError?: (assetId: string, assetName: string, message: string) => void;
}

/**
 * Computes the effective audio volume [0..1] for a clip at `timelineTime`,
 * accounting for clip volume, fade-in/fade-out envelopes, clip mute, track mute, and master mute.
 */
export function computeEffectiveClipAudioVolume(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  timelineTime: number,
  masterMuted: boolean
): { volume: number; muted: boolean } {
  if (masterMuted || clip.muted || track?.muted || clip.volume <= 0) {
    return { volume: 0, muted: true };
  }

  const elapsed = Math.max(0, timelineTime - clip.startTime);
  const remaining = Math.max(0, clip.startTime + clip.duration - timelineTime);

  let fadeMultiplier = 1;
  if (clip.fadeIn > 0 && elapsed < clip.fadeIn) {
    fadeMultiplier = Math.min(fadeMultiplier, elapsed / clip.fadeIn);
  }
  if (clip.fadeOut > 0 && remaining < clip.fadeOut) {
    fadeMultiplier = Math.min(fadeMultiplier, remaining / clip.fadeOut);
  }

  const rawVolume = (clip.volume / 100) * fadeMultiplier;
  const clampedVolume = Math.max(0, Math.min(1, Number(rawVolume.toFixed(4))));
  return {
    volume: clampedVolume,
    muted: clampedVolume === 0,
  };
}

/**
 * Translates an HTMLMediaElement MediaError code into a clear, actionable user-facing message.
 */
export function describeMediaError(
  assetName: string,
  code?: number | null
): string {
  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      return `Playback of "${assetName}" was aborted by the browser.`;
    case 2: // MEDIA_ERR_NETWORK
      return `A local blob read error occurred while decoding "${assetName}".`;
    case 3: // MEDIA_ERR_DECODE
      return `Browser hardware decoder failed on "${assetName}". The file may use an unsupported codec profile (e.g. 10-bit HEVC) or have corrupted frames.`;
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return `Unsupported media format or codec in "${assetName}". Please use MP4 (H.264/AAC), WebM (VP8/VP9), WAV, MP3, PNG, JPEG, or WebP.`;
    default:
      return `Unable to decode "${assetName}" in this browser. Try transcoding to standard MP4 (H.264) or WebM.`;
  }
}

/**
 * Multi-track TimelinePlaybackScheduler:
 * - Coordinates timeline time advancement via a single guarded requestAnimationFrame loop.
 * - Resolves active clips, clip boundary transitions (enter/exit), and empty timeline gaps.
 * - Synchronizes native HTMLVideoElement and HTMLAudioElement instances with source in/out offsets,
 *   playbackRate, and fade volume envelopes without assuming a single video element can play the timeline.
 * - Avoids triggering 60fps React re-renders by invoking lightweight frame callbacks and throttling store commits.
 */
export class TimelinePlaybackScheduler {
  private currentTime = 0;
  private isPlaying = false;
  private isLooping = true;
  private masterMuted = false;
  private clips: TimelineClip[] = [];
  private tracks: TimelineTrack[] = [];
  private assets: MediaAsset[] = [];
  private previewRange: PlaybackRange | null = null;

  private videoElements = new Map<string, HTMLVideoElement | HTMLImageElement>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private unsupportedAssets = new Map<string, string>();
  private previousActiveClipIds = new Set<string>();

  private rafId: number | null = null;
  private lastRafTimestamp: number | null = null;
  private lastStoreCommitTimestamp = 0;
  private storeCommitIntervalMs = 80; // ~12.5 Hz store sync during playback to prevent 60fps React tree renders

  private callbacks: PlaybackSchedulerCallbacks;
  private requestFrameFn: (cb: FrameRequestCallback) => number;
  private cancelFrameFn: (id: number) => void;

  constructor(
    callbacks: PlaybackSchedulerCallbacks = {},
    options?: {
      requestFrame?: (cb: FrameRequestCallback) => number;
      cancelFrame?: (id: number) => void;
    }
  ) {
    this.callbacks = callbacks;
    this.requestFrameFn =
      options?.requestFrame ??
      (typeof window !== 'undefined' && window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : (cb) => setTimeout(() => cb( Date.now() ), 16) as unknown as number);
    this.cancelFrameFn =
      options?.cancelFrame ??
      (typeof window !== 'undefined' && window.cancelAnimationFrame
        ? window.cancelAnimationFrame.bind(window)
        : (id) => clearTimeout(id));
  }

  /**
   * Updates timeline model data without interrupting an active playback loop.
   */
  public setTimelineModel(params: {
    clips: TimelineClip[];
    tracks: TimelineTrack[];
    assets?: MediaAsset[];
    isLooping?: boolean;
    masterMuted?: boolean;
    previewRange?: PlaybackRange | null;
  }): void {
    this.clips = params.clips;
    this.tracks = params.tracks;
    if (params.assets !== undefined) this.assets = params.assets;
    if (params.isLooping !== undefined) this.isLooping = params.isLooping;
    if (params.masterMuted !== undefined) this.masterMuted = params.masterMuted;
    if (params.previewRange !== undefined) this.previewRange = params.previewRange;
  }

  /**
   * Binds the pool of HTMLVideoElement / HTMLImageElement and HTMLAudioElement instances.
   */
  public setMediaPools(
    visualMap: Map<string, HTMLVideoElement | HTMLImageElement>,
    audioMap: Map<string, HTMLAudioElement>
  ): void {
    this.videoElements = visualMap;
    this.audioElements = audioMap;
  }

  /**
   * Registers an unsupported or failed asset decode error and pauses affected element.
   */
  public reportAssetError(
    assetId: string,
    assetName: string,
    errorCode?: number | null
  ): string {
    const message = describeMediaError(assetName, errorCode);
    this.unsupportedAssets.set(assetId, message);
    const vidEl = this.videoElements.get(assetId);
    if (vidEl && 'pause' in vidEl && typeof vidEl.pause === 'function') {
      vidEl.pause();
    }
    const audEl = this.audioElements.get(assetId);
    if (audEl && typeof audEl.pause === 'function') {
      audEl.pause();
    }
    this.callbacks.onMediaError?.(assetId, assetName, message);
    return message;
  }

  public getAssetError(assetId: string): string | undefined {
    return this.unsupportedAssets.get(assetId);
  }

  public clearAssetErrors(): void {
    this.unsupportedAssets.clear();
  }

  public getCurrentTime(): number {
    return this.currentTime;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getSequenceDuration(): number {
    return Math.max(1, calculateProjectDuration(this.clips));
  }

  /**
   * Starts the playback loop. Guarded against starting duplicate rAF loops.
   */
  public play(): void {
    if (this.isPlaying) {
      // Guard: never spawn duplicate playback loops
      return;
    }

    const bounds = this.getEffectiveBounds();
    if (this.currentTime >= bounds.endTime) {
      this.currentTime = bounds.startTime;
    }

    this.isPlaying = true;
    this.lastRafTimestamp = null;
    this.callbacks.onPlayStateChange?.(true);

    const frameState = this.evaluateAndSyncAtTime(this.currentTime, true);
    this.callbacks.onFrame?.(frameState);

    this.scheduleNextTick();
  }

  /**
   * Pauses playback, cancels the active rAF loop, and pauses all native media elements.
   */
  public pause(): void {
    if (!this.isPlaying && this.rafId === null) {
      this.pauseAllMediaElements();
      return;
    }

    this.isPlaying = false;
    this.lastRafTimestamp = null;
    if (this.rafId !== null) {
      this.cancelFrameFn(this.rafId);
      this.rafId = null;
    }

    this.pauseAllMediaElements();
    this.callbacks.onPlayStateChange?.(false);
    this.callbacks.onTimeCommit?.(this.currentTime);

    const frameState = this.evaluateAndSyncAtTime(this.currentTime, false);
    this.callbacks.onFrame?.(frameState);
  }

  /**
   * Seeks immediately to a timeline position (in seconds), handling playback interruptions cleanly.
   */
  public seek(targetTime: number): SchedulerFrameState {
    const seqDuration = this.getSequenceDuration();
    const clampedTicks = Math.max(
      0,
      Math.min(secondsToTicks(seqDuration + 2), secondsToTicks(targetTime))
    );
    this.currentTime = ticksToSeconds(clampedTicks);

    // Reset rAF delta reference so an in-flight playback loop doesn't add stale elapsed time
    this.lastRafTimestamp = null;

    const frameState = this.evaluateAndSyncAtTime(this.currentTime, this.isPlaying, true);
    this.callbacks.onFrame?.(frameState);
    this.callbacks.onTimeCommit?.(this.currentTime);
    return frameState;
  }

  /**
   * Advances playback deterministically by `deltaSeconds`.
   * Used both by the internal rAF loop and by deterministic unit tests.
   */
  public step(deltaSeconds: number): SchedulerFrameState {
    const safeDelta = Math.max(0, deltaSeconds);
    const bounds = this.getEffectiveBounds();
    let nextTime = ticksToSeconds(
      secondsToTicks(this.currentTime) + secondsToTicks(safeDelta)
    );

    if (nextTime >= bounds.endTime) {
      if (this.isLooping) {
        nextTime = bounds.startTime;
        this.previousActiveClipIds.clear();
      } else {
        this.currentTime = bounds.endTime;
        this.isPlaying = false;
        if (this.rafId !== null) {
          this.cancelFrameFn(this.rafId);
          this.rafId = null;
        }
        this.pauseAllMediaElements();
        const finalState = this.evaluateAndSyncAtTime(this.currentTime, false, true);
        this.callbacks.onFrame?.(finalState);
        this.callbacks.onTimeCommit?.(this.currentTime);
        this.callbacks.onPlayStateChange?.(false);
        return finalState;
      }
    }

    this.currentTime = nextTime;
    const frameState = this.evaluateAndSyncAtTime(this.currentTime, this.isPlaying, false);
    this.callbacks.onFrame?.(frameState);
    return frameState;
  }

  /**
   *Evaluates active clips, boundary transitions, gaps, and synchronizes `<video>` & `<audio>` elements.
   */
  public evaluateAndSyncAtTime(
    timelineTime: number,
    playing: boolean,
    forceExactSeek = false
  ): SchedulerFrameState {
    const sequenceDuration = this.getSequenceDuration();
    const activeClips = resolveActiveClipsAtTime(
      this.clips,
      this.tracks,
      timelineTime
    );

    const currentActiveIds = new Set(activeClips.map((c) => c.id));
    const enteredClipIds: string[] = [];
    const exitedClipIds: string[] = [];

    for (const id of currentActiveIds) {
      if (!this.previousActiveClipIds.has(id)) {
        enteredClipIds.push(id);
      }
    }
    for (const prevId of this.previousActiveClipIds) {
      if (!currentActiveIds.has(prevId)) {
        exitedClipIds.push(prevId);
      }
    }
    this.previousActiveClipIds = currentActiveIds;

    const activeVisualClips = activeClips.filter(
      (c) => c.trackType !== 'audio'
    );
    const isInGap = activeClips.length === 0;

    const trackMap = new Map<string, TimelineTrack>();
    for (const t of this.tracks) {
      trackMap.set(t.id, t);
    }

    // Build audio sync states for all active clips that carry audio (audio tracks + video/overlay clips with video assets)
    const activeAudioStates: ClipAudioSyncState[] = [];
    const activeVideoAssetClipMap = new Map<string, TimelineClip>();
    const activeAudioAssetClipMap = new Map<string, TimelineClip>();

    for (const clip of activeClips) {
      if (!clip.assetId) continue;
      if (this.unsupportedAssets.has(clip.assetId)) continue;

      const targetSourceTime = getSourceTimeForClip(clip, timelineTime);
      const track = trackMap.get(clip.trackId);
      const { volume, muted } = computeEffectiveClipAudioVolume(
        clip,
        track,
        timelineTime,
        this.masterMuted
      );

      if (clip.trackType === 'audio') {
        activeAudioAssetClipMap.set(clip.assetId, clip);
        activeAudioStates.push({
          clipId: clip.id,
          assetId: clip.assetId,
          targetSourceTime,
          effectiveVolume: volume,
          muted,
          playbackRate: clip.playbackRate || 1,
        });
      } else if (clip.trackType === 'video' || clip.trackType === 'overlay') {
        // Top-most active clip for a given video asset drives its element during playback
        activeVideoAssetClipMap.set(clip.assetId, clip);
        activeAudioStates.push({
          clipId: clip.id,
          assetId: clip.assetId,
          targetSourceTime,
          effectiveVolume: volume,
          muted,
          playbackRate: clip.playbackRate || 1,
        });
      }
    }

    // Synchronize HTMLVideoElement instances
    this.videoElements.forEach((el, assetId) => {
      if (typeof HTMLVideoElement === 'undefined' || !(el instanceof HTMLVideoElement)) {
        return;
      }
      const clip = activeVideoAssetClipMap.get(assetId);
      if (!clip || this.unsupportedAssets.has(assetId)) {
        if (!el.paused) {
          el.pause();
        }
        return;
      }

      const track = trackMap.get(clip.trackId);
      const targetSourceTime = getSourceTimeForClip(clip, timelineTime);
      const { volume, muted } = computeEffectiveClipAudioVolume(
        clip,
        track,
        timelineTime,
        this.masterMuted
      );

      const desiredRate = clip.playbackRate > 0 ? clip.playbackRate : 1;
      if (Math.abs(el.playbackRate - desiredRate) > 0.01) {
        el.playbackRate = desiredRate;
      }
      el.volume = volume;
      el.muted = muted;

      const driftThreshold = forceExactSeek || !playing ? 0.015 : 0.14;
      if (Math.abs(el.currentTime - targetSourceTime) > driftThreshold) {
        try {
          el.currentTime = targetSourceTime;
        } catch {
          // Ignore DOMException if media metadata hasn't finished loading yet
        }
      }

      if (playing) {
        if (el.paused) {
          void el.play().catch(() => {
            // If unmuted autoplay is blocked by browser policy, fallback to muted video playback so visuals never stall
            el.muted = true;
            void el.play().catch(() => undefined);
          });
        }
      } else if (!el.paused) {
        el.pause();
      }
    });

    // Synchronize standalone HTMLAudioElement instances
    this.audioElements.forEach((audioEl, assetId) => {
      const clip = activeAudioAssetClipMap.get(assetId);
      if (!clip || this.unsupportedAssets.has(assetId)) {
        if (!audioEl.paused) {
          audioEl.pause();
        }
        return;
      }

      const track = trackMap.get(clip.trackId);
      const targetSourceTime = getSourceTimeForClip(clip, timelineTime);
      const { volume, muted } = computeEffectiveClipAudioVolume(
        clip,
        track,
        timelineTime,
        this.masterMuted
      );

      const desiredRate = clip.playbackRate > 0 ? clip.playbackRate : 1;
      if (Math.abs(audioEl.playbackRate - desiredRate) > 0.01) {
        audioEl.playbackRate = desiredRate;
      }
      audioEl.volume = volume;
      audioEl.muted = muted;

      const driftThreshold = forceExactSeek || !playing ? 0.02 : 0.18;
      if (Math.abs(audioEl.currentTime - targetSourceTime) > driftThreshold) {
        try {
          audioEl.currentTime = targetSourceTime;
        } catch {
          // Ignore seek before readyState
        }
      }

      if (playing && !muted) {
        if (audioEl.paused) {
          void audioEl.play().catch(() => undefined);
        }
      } else if (!audioEl.paused) {
        audioEl.pause();
      }
    });

    return {
      timelineTime,
      sequenceDuration,
      isPlaying: playing,
      isInGap,
      activeClips,
      activeVisualClips,
      activeAudioStates,
      enteredClipIds,
      exitedClipIds,
    };
  }

  /**
   * Stops playback, cancels rAF, and releases all references.
   */
  public dispose(): void {
    if (this.rafId !== null) {
      this.cancelFrameFn(this.rafId);
      this.rafId = null;
    }
    this.isPlaying = false;
    this.lastRafTimestamp = null;
    this.pauseAllMediaElements();
    this.previousActiveClipIds.clear();
  }

  private getEffectiveBounds(): PlaybackRange {
    const seqDuration = this.getSequenceDuration();
    if (
      this.previewRange &&
      this.previewRange.endTime > this.previewRange.startTime
    ) {
      return {
        startTime: Math.max(0, this.previewRange.startTime),
        endTime: Math.min(seqDuration, this.previewRange.endTime),
      };
    }
    return {
      startTime: 0,
      endTime: seqDuration,
    };
  }

  private scheduleNextTick(): void {
    if (!this.isPlaying || this.rafId !== null) return;

    this.rafId = this.requestFrameFn((now: number) => {
      this.rafId = null;
      if (!this.isPlaying) return;

      if (this.lastRafTimestamp === null) {
        this.lastRafTimestamp = now;
      }
      const rawDelta = Math.max(0, (now - this.lastRafTimestamp) / 1000);
      // Cap single frame delta to 100ms so background tab throttling doesn't jump wildly
      const deltaSeconds = Math.min(0.1, rawDelta);
      this.lastRafTimestamp = now;

      this.step(deltaSeconds);

      if (
        this.isPlaying &&
        now - this.lastStoreCommitTimestamp >= this.storeCommitIntervalMs
      ) {
        this.lastStoreCommitTimestamp = now;
        this.callbacks.onTimeCommit?.(this.currentTime);
      }

      if (this.isPlaying) {
        this.scheduleNextTick();
      }
    });
  }

  private pauseAllMediaElements(): void {
    this.videoElements.forEach((el) => {
      if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) {
        if (!el.paused) el.pause();
      }
    });
    this.audioElements.forEach((el) => {
      if (!el.paused) el.pause();
    });
  }
}
