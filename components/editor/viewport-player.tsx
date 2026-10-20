'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Grid,
  ZoomIn,
  ZoomOut,
  Focus,
  AlertTriangle,
  X,
} from 'lucide-react';
import { CanvasZoomPreset, useEditorStore } from '@/store/use-editor-store';
import { ASPECT_RATIO_PRESETS, AspectRatioPreset } from '@/types/editor';
import {
  calculateProjectDuration,
  formatTimecode,
  resolveActiveClipsAtTime,
  secondsToFrames,
} from '@/lib/timeline/engine';
import { renderCompositedFrame } from '@/lib/renderer/canvas-compositor';
import { TimelinePlaybackScheduler } from '@/lib/renderer/playback-scheduler';
import {
  hitTestTextClipAtPoint,
  mapClientPointToNormalizedCanvas,
} from '@/lib/subtitles/text-and-subtitles';
import {
  detectDeviceAndMemoryProfile,
  releaseMediaElementResources,
} from '@/lib/performance/optimizer';
import { Button } from '@/components/ui/button';

export function ViewportPlayer({
  mediaElementsRef,
}: {
  mediaElementsRef: React.MutableRefObject<
    Map<string, HTMLVideoElement | HTMLImageElement>
  >;
}) {
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const setAspectRatio = useEditorStore((s) => s.setAspectRatio);
  const canvasBackground = useEditorStore((s) => s.canvasBackground);
  const canvasZoom = useEditorStore((s) => s.canvasZoom);
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const assets = useEditorStore((s) => s.assets);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClipTransform = useEditorStore((s) => s.updateClipTransform);
  const updateClipTextStyle = useEditorStore((s) => s.updateClipTextStyle);
  const beginClipGesture = useEditorStore((s) => s.beginClipGesture);
  const commitClipGesture = useEditorStore((s) => s.commitClipGesture);
  const playheadTime = useEditorStore((s) => s.playheadTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const isLooping = useEditorStore((s) => s.isLooping);
  const masterMuted = useEditorStore((s) => s.masterMuted);
  const showSafeGuides = useEditorStore((s) => s.showSafeGuides);

  const setPlayheadTime = useEditorStore((s) => s.setPlayheadTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const togglePlayPause = useEditorStore((s) => s.togglePlayPause);
  const setIsLooping = useEditorStore((s) => s.setIsLooping);
  const setMasterMuted = useEditorStore((s) => s.setMasterMuted);
  const toggleSafeGuides = useEditorStore((s) => s.toggleSafeGuides);

  const [previewSelectedOnly, setPreviewSelectedOnly] = useState(false);
  const [mediaFormatError, setMediaFormatError] = useState<string | null>(null);
  const [isDraggingText, setIsDraggingText] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentTimeSpanRef = useRef<HTMLSpanElement | null>(null);
  const seekSliderRef = useRef<HTMLInputElement | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const schedulerRef = useRef<TimelinePlaybackScheduler | null>(null);
  const textDragRef = useRef<{
    clipId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const totalDuration = Math.max(1, calculateProjectDuration(clips));
  const preset = ASPECT_RATIO_PRESETS[aspectRatio];
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const activeFitMode = selectedClip?.transform.fitMode ?? 'contain';

  // Initialize the multi-track TimelinePlaybackScheduler once
  useEffect(() => {
    const scheduler = new TimelinePlaybackScheduler({
      onFrame: (frameState) => {
        const currentStore = useEditorStore.getState();

        // 1. Render 60fps composited frame directly onto Canvas without React re-render
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            renderCompositedFrame({
              ctx,
              width: canvas.width,
              height: canvas.height,
              time: frameState.timelineTime,
              clips: currentStore.clips,
              tracks: currentStore.tracks,
              canvasBackground: currentStore.canvasBackground,
              showSafeGuides: currentStore.showSafeGuides,
              selectedClipId: currentStore.selectedClipId,
              mediaElements: mediaElementsRef.current,
            });
          }
        }

        // 2. Imperatively update DOM timecode, seek slider, and timeline playhead at 60fps
        const formattedTime = formatTimecode(frameState.timelineTime);
        if (currentTimeSpanRef.current) {
          currentTimeSpanRef.current.textContent = formattedTime;
        }
        if (seekSliderRef.current) {
          seekSliderRef.current.value = String(
            Math.min(frameState.sequenceDuration, frameState.timelineTime)
          );
        }
        const playheadEl = document.querySelector(
          '[data-testid="timeline-playhead-indicator"]'
        ) as HTMLElement | null;
        if (playheadEl) {
          playheadEl.style.left = `${
            frameState.timelineTime * currentStore.timelineZoom
          }px`;
        }
        const timelineReadoutEl = document.querySelector(
          '[data-testid="timeline-frame-readout"]'
        ) as HTMLElement | null;
        if (timelineReadoutEl) {
          timelineReadoutEl.textContent = `${formattedTime} · F${secondsToFrames(
            frameState.timelineTime,
            currentStore.exportSettings.fps
          )}`;
        }
      },
      onTimeCommit: (committedTime) => {
        useEditorStore.getState().setPlayheadTime(committedTime);
      },
      onPlayStateChange: (playing) => {
        if (useEditorStore.getState().isPlaying !== playing) {
          useEditorStore.getState().setIsPlaying(playing);
        }
      },
      onMediaError: (_assetId, _assetName, message) => {
        setMediaFormatError(message);
      },
    });

    scheduler.setMediaPools(mediaElementsRef.current, audioElementsRef.current);
    schedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [mediaElementsRef]);

  // Synchronize offscreen HTMLVideoElement / HTMLImageElement / HTMLAudioElement pool with assets
  // and clean up removed assets to prevent memory or decoder leaks
  useEffect(() => {
    const mediaMap = mediaElementsRef.current;
    const audioMap = audioElementsRef.current;
    const scheduler = schedulerRef.current;
    const currentAssetIds = new Set(assets.map((a) => a.id));

    const profile = detectDeviceAndMemoryProfile();
    const preloadMode = profile.isLowMemoryDevice ? 'metadata' : 'auto';

    // Remove and release media elements for deleted assets
    mediaMap.forEach((el, id) => {
      if (!currentAssetIds.has(id)) {
        releaseMediaElementResources(el);
        mediaMap.delete(id);
      }
    });

    audioMap.forEach((el, id) => {
      if (!currentAssetIds.has(id)) {
        releaseMediaElementResources(el);
        audioMap.delete(id);
      }
    });

    // Create and attach error listeners for active assets
    for (const asset of assets) {
      if (!asset.objectUrl) continue;

      if (asset.type === 'video' && !mediaMap.has(asset.id)) {
        const video = document.createElement('video');
        video.src = asset.objectUrl;
        video.playsInline = true;
        video.preload = preloadMode;
        video.crossOrigin = 'anonymous';
        video.onerror = () => {
          scheduler?.reportAssetError(
            asset.id,
            asset.name,
            video.error?.code ?? 4
          );
        };
        mediaMap.set(asset.id, video);
      } else if (asset.type === 'image' && !mediaMap.has(asset.id)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onerror = () => {
          scheduler?.reportAssetError(asset.id, asset.name, 4);
        };
        img.src = asset.objectUrl;
        mediaMap.set(asset.id, img);
      } else if (asset.type === 'audio' && !audioMap.has(asset.id)) {
        const audio = document.createElement('audio');
        audio.src = asset.objectUrl;
        audio.preload = preloadMode;
        audio.onerror = () => {
          scheduler?.reportAssetError(
            asset.id,
            asset.name,
            audio.error?.code ?? 4
          );
        };
        audioMap.set(asset.id, audio);
      }
    }

    scheduler?.setMediaPools(mediaMap, audioMap);
  }, [assets, mediaElementsRef]);

  // Sync timeline model & preview range with scheduler and re-render current frame on edits
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;

    const previewRange =
      previewSelectedOnly && selectedClip
        ? {
            startTime: selectedClip.startTime,
            endTime: selectedClip.startTime + selectedClip.duration,
          }
        : null;

    scheduler.setTimelineModel({
      clips,
      tracks,
      assets,
      isLooping,
      masterMuted,
      previewRange,
    });

    // If not actively playing, evaluate and render the exact frame at playheadTime
    if (!isPlaying) {
      const frameState = scheduler.evaluateAndSyncAtTime(
        playheadTime,
        false,
        true
      );
      if (currentTimeSpanRef.current) {
        currentTimeSpanRef.current.textContent = formatTimecode(
          frameState.timelineTime
        );
      }
      if (seekSliderRef.current) {
        seekSliderRef.current.value = String(
          Math.min(frameState.sequenceDuration, frameState.timelineTime)
        );
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderCompositedFrame({
            ctx,
            width: canvas.width,
            height: canvas.height,
            time: frameState.timelineTime,
            clips,
            tracks,
            canvasBackground,
            showSafeGuides,
            selectedClipId,
            mediaElements: mediaElementsRef.current,
          });
        }
      }
    }
  }, [
    clips,
    tracks,
    assets,
    isLooping,
    masterMuted,
    previewSelectedOnly,
    selectedClip,
    playheadTime,
    isPlaying,
    canvasBackground,
    showSafeGuides,
    selectedClipId,
    aspectRatio,
    mediaElementsRef,
  ]);

  // Sync play/pause state transitions with the scheduler
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;

    if (isPlaying) {
      // Ensure scheduler starts from current store playheadTime (or selected clip start if previewSelectedOnly)
      const startFrom =
        previewSelectedOnly &&
        selectedClip &&
        (playheadTime < selectedClip.startTime ||
          playheadTime >= selectedClip.startTime + selectedClip.duration)
          ? selectedClip.startTime
          : playheadTime;
      scheduler.seek(startFrom);
      scheduler.play();
    } else {
      scheduler.pause();
    }
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle explicit user seeks when paused or scrubbing
  const handleUserSeek = (targetTime: number) => {
    const scheduler = schedulerRef.current;
    if (scheduler) {
      scheduler.seek(targetTime);
    } else {
      setPlayheadTime(targetTime);
    }
  };

  // Preview Selected Clip action: seeks playhead to selected clip's start and toggles clip-range preview
  const handlePreviewSelectedClip = () => {
    if (!selectedClip) return;
    const nextMode = !previewSelectedOnly;
    setPreviewSelectedOnly(nextMode);
    handleUserSeek(selectedClip.startTime);
  };

  // Calculate base preview dimensions and apply user's Canvas Zoom preset
  const baseWidth =
    aspectRatio === '16:9'
      ? 580
      : aspectRatio === '9:16'
        ? 235
        : aspectRatio === '1:1'
          ? 340
          : 290;
  const zoomMultiplier = canvasZoom === 'fit' ? 1 : canvasZoom / 100;
  const previewScaleWidth = Math.round(baseWidth * zoomMultiplier);
  const previewScaleHeight = Math.round(
    (previewScaleWidth * preset.height) / preset.width
  );

  const zoomOptions: CanvasZoomPreset[] = ['fit', 50, 75, 100, 125, 150];

  const stepCanvasZoom = (dir: -1 | 1) => {
    const currentIndex = zoomOptions.indexOf(canvasZoom);
    const baseIndex = currentIndex === -1 ? 3 : currentIndex;
    const nextIndex = Math.max(
      0,
      Math.min(zoomOptions.length - 1, baseIndex + dir)
    );
    setCanvasZoom(zoomOptions[nextIndex]);
  };

  return (
    <section
      aria-label="Video preview monitor"
      className="flex-1 flex flex-col bg-[#090D16] min-w-0 overflow-hidden"
    >
      {/* Unsupported Format / Codec Decode Error Banner */}
      {mediaFormatError && (
        <div
          role="alert"
          data-testid="preview-format-error-banner"
          className="flex items-center justify-between gap-2 px-3.5 py-2 bg-rose-500/15 border-b border-rose-500/30 text-rose-200 text-xs shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="truncate">{mediaFormatError}</span>
          </div>
          <button
            type="button"
            onClick={() => setMediaFormatError(null)}
            aria-label="Dismiss media format error"
            className="p-1 rounded hover:bg-rose-500/20 text-rose-200 cursor-pointer shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top Monitor Toolbar: Aspect-Ratio Selector, Fit/Fill Options, Preview Selected Clip, Zoom & Safe Zones */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-b border-slate-800/80 bg-[#0F172A]/60 text-xs text-slate-400 shrink-0">
        {/* Left: Aspect-Ratio Selector & Fit/Fill */}
        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-800"
            role="group"
            aria-label="Aspect ratio selector"
          >
            {(['16:9', '9:16', '1:1', '4:5'] as AspectRatioPreset[]).map(
              (ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  data-testid={`viewport-aspect-${ratio}`}
                  className={`px-2 py-1 rounded text-[11px] font-mono tabular-nums transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    aspectRatio === ratio
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {ratio}
                </button>
              )
            )}
          </div>

          {/* Fit and Fill Options */}
          {selectedClip &&
            (selectedClip.trackType === 'video' ||
              selectedClip.trackType === 'overlay') && (
              <div
                className="hidden sm:inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-800"
                role="group"
                aria-label="Fit and fill options"
              >
                {(
                  [
                    { id: 'contain', label: 'Fit' },
                    { id: 'cover', label: 'Fill' },
                    { id: 'fill', label: 'Stretch' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      updateClipTransform(selectedClip.id, { fitMode: m.id })
                    }
                    data-testid={`viewport-fit-${m.id}`}
                    className={`px-2 py-1 rounded text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      activeFitMode === m.id
                        ? 'bg-slate-800 text-sky-400 font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

          {/* Focus / Preview Selected Clip Toggle */}
          {selectedClip && (
            <button
              type="button"
              onClick={handlePreviewSelectedClip}
              title="Seek to selected clip and isolate playback to its bounds"
              data-testid="preview-selected-clip-btn"
              className={`hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                previewSelectedOnly
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-medium'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Focus className="h-3.5 w-3.5" />
              <span>Preview Clip</span>
            </button>
          )}
        </div>

        {/* Right: Canvas Zoom Controls & Safe Zones */}
        <div className="flex items-center gap-1.5">
          <div className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => stepCanvasZoom(-1)}
              title="Zoom Out Preview"
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <select
              aria-label="Preview zoom level"
              value={String(canvasZoom)}
              onChange={(e) => {
                const val = e.target.value;
                setCanvasZoom(
                  val === 'fit' ? 'fit' : (Number(val) as CanvasZoomPreset)
                );
              }}
              data-testid="viewport-zoom-select"
              className="bg-transparent text-[11px] font-mono tabular-nums text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="fit" className="bg-slate-900">
                Fit
              </option>
              <option value="50" className="bg-slate-900">
                50%
              </option>
              <option value="75" className="bg-slate-900">
                75%
              </option>
              <option value="100" className="bg-slate-900">
                100%
              </option>
              <option value="125" className="bg-slate-900">
                125%
              </option>
              <option value="150" className="bg-slate-900">
                150%
              </option>
            </select>
            <button
              type="button"
              onClick={() => stepCanvasZoom(1)}
              title="Zoom In Preview"
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleSafeGuides}
            title="Toggle Action & Title Safe Guides"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showSafeGuides
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Safe Zones</span>
          </button>
        </div>
      </div>

      {/* Canvas Stage */}
      <div className="flex-1 flex items-center justify-center p-3 sm:p-5 overflow-auto">
        <div
          className="relative rounded-lg overflow-hidden border border-slate-800 shadow-2xl bg-black flex items-center justify-center transition-all duration-150"
          style={{
            width: `${previewScaleWidth}px`,
            height: `${previewScaleHeight}px`,
            maxWidth: canvasZoom === 'fit' ? '100%' : 'none',
            maxHeight: canvasZoom === 'fit' ? '100%' : 'none',
          }}
        >
          <canvas
            ref={canvasRef}
            width={Math.round(preset.width / 2)}
            height={Math.round(preset.height / 2)}
            data-testid="editor-preview-canvas"
            onPointerDown={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const norm = mapClientPointToNormalizedCanvas(
                e.clientX,
                e.clientY,
                rect
              );
              const activeTextClips = resolveActiveClipsAtTime(
                clips,
                tracks,
                playheadTime
              )
                .filter((c) => c.trackType === 'text' && c.textStyle)
                .reverse();

              const hitClip =
                activeTextClips.find((c) =>
                  hitTestTextClipAtPoint(
                    norm.x,
                    norm.y,
                    c,
                    canvas.width,
                    canvas.height
                  )
                ) ||
                (selectedClip?.trackType === 'text' &&
                activeTextClips.some((c) => c.id === selectedClip.id)
                  ? selectedClip
                  : null);

              if (!hitClip || !hitClip.textStyle) return;

              const track = tracks.find((t) => t.id === hitClip.trackId);
              if (track?.locked) return;

              selectClip(hitClip.id);
              beginClipGesture();
              setIsDraggingText(true);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Ignore in synthetic test environments
              }

              textDragRef.current = {
                clipId: hitClip.id,
                pointerId: e.pointerId,
                offsetX: (hitClip.textStyle.x ?? 0.5) - norm.x,
                offsetY: (hitClip.textStyle.y ?? 0.84) - norm.y,
              };
            }}
            onPointerMove={(e) => {
              const drag = textDragRef.current;
              const canvas = canvasRef.current;
              if (!drag || !canvas) return;

              const rect = canvas.getBoundingClientRect();
              const norm = mapClientPointToNormalizedCanvas(
                e.clientX,
                e.clientY,
                rect
              );
              updateClipTextStyle(drag.clipId, {
                x: norm.x + drag.offsetX,
                y: norm.y + drag.offsetY,
              });
            }}
            onPointerUp={(e) => {
              if (!textDragRef.current) return;
              try {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              } catch {
                // Ignore in synthetic test environments
              }
              textDragRef.current = null;
              setIsDraggingText(false);
              commitClipGesture();
            }}
            onPointerCancel={() => {
              if (!textDragRef.current) return;
              textDragRef.current = null;
              setIsDraggingText(false);
              commitClipGesture();
            }}
            className={`w-full h-full object-contain block touch-none ${
              isDraggingText
                ? 'cursor-grabbing'
                : selectedClip?.trackType === 'text'
                  ? 'cursor-grab'
                  : 'cursor-default'
            }`}
          />
        </div>
      </div>

      {/* Seek Scrubber Bar */}
      <div className="px-4 pt-2 pb-1 bg-[#0F172A] border-t border-slate-800/80 flex items-center gap-3">
        <input
          ref={seekSliderRef}
          type="range"
          min={0}
          max={totalDuration}
          step={0.02}
          defaultValue={Math.min(totalDuration, playheadTime)}
          onChange={(e) => {
            setIsPlaying(false);
            handleUserSeek(Number(e.target.value));
          }}
          aria-label="Seek timeline playhead"
          data-testid="viewport-seek-slider"
          className="w-full h-1.5 accent-sky-400 bg-slate-800 rounded-lg cursor-pointer"
        />
      </div>

      {/* Transport Deck & SMPTE Timecode Bar */}
      <div className="flex items-center justify-between gap-3 px-4 h-11 bg-[#0F172A] shrink-0">
        {/* Left: Current Timecode / Total Duration */}
        <div
          className="flex items-center gap-1.5 font-mono text-xs tabular-nums"
          data-testid="timecode-display"
        >
          <span
            ref={currentTimeSpanRef}
            className="text-sky-400 font-semibold"
          >
            {formatTimecode(playheadTime)}
          </span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{formatTimecode(totalDuration)}</span>
        </div>

        {/* Center: Transport Controls */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Jump to Start (00:00.00)"
            onClick={() => {
              setIsPlaying(false);
              handleUserSeek(0);
            }}
            data-testid="transport-start-btn"
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="default"
            size="icon"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            onClick={togglePlayPause}
            data-testid="transport-play-pause-btn"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Step Forward 0.5s"
            onClick={() => {
              setIsPlaying(false);
              handleUserSeek(Math.min(totalDuration, playheadTime + 0.5));
            }}
            data-testid="transport-step-forward-btn"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Loop & Master Audio Mute */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant={isLooping ? 'secondary' : 'ghost'}
            size="icon"
            title="Toggle Loop Playback"
            onClick={() => setIsLooping(!isLooping)}
          >
            <Repeat
              className={`h-3.5 w-3.5 ${
                isLooping ? 'text-sky-400' : 'text-slate-400'
              }`}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={masterMuted ? 'Unmute Master Output' : 'Mute Master Output'}
            onClick={() => setMasterMuted(!masterMuted)}
          >
            {masterMuted ? (
              <VolumeX className="h-4 w-4 text-rose-400" />
            ) : (
              <Volume2 className="h-4 w-4 text-slate-300" />
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
