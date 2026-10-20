'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Scissors,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Magnet,
  ZoomIn,
  ZoomOut,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ArrowLeftToLine,
  Plus,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import { useEditorStore } from '@/store/use-editor-store';
import {
  calculateProjectDuration,
  detectTrackGaps,
  detectTrackOverlaps,
  filterVisibleClips,
  formatTimecode,
  secondsToFrames,
} from '@/lib/timeline/engine';
import { TrackType } from '@/types/editor';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export function TimelinePanel() {
  const tracks = useEditorStore((s) => s.tracks);
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const playheadTime = useEditorStore((s) => s.playheadTime);
  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const rippleDeleteEnabled = useEditorStore((s) => s.rippleDeleteEnabled);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const errorBanner = useEditorStore((s) => s.errorBanner);
  const fps = useEditorStore((s) => s.exportSettings.fps);

  const selectClip = useEditorStore((s) => s.selectClip);
  const appendAssetToTimeline = useEditorStore((s) => s.appendAssetToTimeline);
  const setPlayheadTime = useEditorStore((s) => s.setPlayheadTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const toggleRippleDelete = useEditorStore((s) => s.toggleRippleDelete);
  const splitSelectedClipAtPlayhead = useEditorStore(
    (s) => s.splitSelectedClipAtPlayhead
  );
  const deleteSelectedClip = useEditorStore((s) => s.deleteSelectedClip);
  const duplicateSelectedClip = useEditorStore((s) => s.duplicateSelectedClip);
  const beginClipGesture = useEditorStore((s) => s.beginClipGesture);
  const commitClipGesture = useEditorStore((s) => s.commitClipGesture);
  const trimClipLeft = useEditorStore((s) => s.trimClipLeft);
  const trimClipRight = useEditorStore((s) => s.trimClipRight);
  const moveClip = useEditorStore((s) => s.moveClip);
  const closeGapsOnTrack = useEditorStore((s) => s.closeGapsOnTrack);
  const resolveOverlapsOnTrack = useEditorStore((s) => s.resolveOverlapsOnTrack);
  const addTrack = useEditorStore((s) => s.addTrack);
  const toggleTrackMute = useEditorStore((s) => s.toggleTrackMute);
  const toggleTrackHidden = useEditorStore((s) => s.toggleTrackHidden);
  const toggleTrackLock = useEditorStore((s) => s.toggleTrackLock);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setErrorBanner = useEditorStore((s) => s.setErrorBanner);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [viewportRange, setViewportRange] = useState<{
    start: number;
    end: number;
  }>({ start: 0, end: 40 });

  const [dragMode, setDragMode] = useState<{
    type: 'move' | 'trim-left' | 'trim-right' | 'scrub';
    clipId?: string;
    initialMouseX: number;
    initialStartTime: number;
    initialDuration: number;
    targetTrackId?: string;
  } | null>(null);

  const projectDuration = Math.max(12, calculateProjectDuration(clips) + 4);
  const timelineWidthPx = Math.max(
    800,
    Math.ceil(projectDuration * timelineZoom)
  );

  // Sync horizontal viewport window for virtualization when scrolling or zooming
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateWindow = () => {
      const start = Math.max(0, el.scrollLeft / timelineZoom);
      const widthSec = Math.max(15, (el.clientWidth || 1000) / timelineZoom);
      setViewportRange({ start, end: start + widthSec });
    };
    updateWindow();
    el.addEventListener('scroll', updateWindow, { passive: true });
    window.addEventListener('resize', updateWindow);
    return () => {
      el.removeEventListener('scroll', updateWindow);
      window.removeEventListener('resize', updateWindow);
    };
  }, [timelineZoom]);

  // Cleanup any pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const clientXToTime = (clientX: number): number => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const offsetX = clientX - rect.left + container.scrollLeft;
    return Math.max(0, offsetX / timelineZoom);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    const clientX = e.clientX;
    const targetElement = document.elementFromPoint(
      e.clientX,
      e.clientY
    ) as HTMLElement | null;
    const trackLaneEl = targetElement?.closest('[data-track-id]') as
      | HTMLElement
      | null;
    const hoveredTrackId = trackLaneEl?.dataset.trackId;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const deltaX = clientX - dragMode.initialMouseX;
      const deltaTime = deltaX / timelineZoom;

      if (dragMode.type === 'scrub') {
        setPlayheadTime(clientXToTime(clientX));
        return;
      }

      if (!dragMode.clipId) return;

      if (dragMode.type === 'move') {
        moveClip(
          dragMode.clipId,
          dragMode.initialStartTime + deltaTime,
          hoveredTrackId || dragMode.targetTrackId
        );
      } else if (dragMode.type === 'trim-left') {
        trimClipLeft(dragMode.clipId, dragMode.initialStartTime + deltaTime);
      } else if (dragMode.type === 'trim-right') {
        trimClipRight(dragMode.clipId, dragMode.initialDuration + deltaTime);
      }
    });
  };

  const handlePointerUp = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (dragMode) {
      if (dragMode.type !== 'scrub') {
        commitClipGesture();
      }
      setDragMode(null);
    }
  };

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  const tickMarks: number[] = [];
  for (let s = 0; s <= Math.ceil(projectDuration); s++) {
    tickMarks.push(s);
  }

  return (
    <section
      aria-label="Multi-track non-linear timeline"
      className="h-60 sm:h-68 shrink-0 border-t border-slate-800/90 bg-[#0B0F17] flex flex-col select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Recoverable Error Toast Banner */}
      {errorBanner && (
        <div
          role="alert"
          className="flex items-center justify-between px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-xs"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Timeline Action Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 h-10 border-b border-slate-800/80 bg-[#0F172A] shrink-0 overflow-x-auto">
        {/* Left: History, Split, Duplicate, Delete, Track Gap/Overlap Tools */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={undoStack.length === 0}
            onClick={undo}
            title="Undo (Ctrl+Z)"
            data-testid="timeline-undo-btn"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={redoStack.length === 0}
            onClick={redo}
            title="Redo (Ctrl+Y)"
            data-testid="timeline-redo-btn"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => splitSelectedClipAtPlayhead()}
            title="Split Selected Clip at Playhead (S)"
            data-testid="timeline-split-btn"
          >
            <Scissors className="h-3.5 w-3.5 text-sky-400" />
            <span>Split</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!selectedClipId}
            onClick={duplicateSelectedClip}
            title="Duplicate Selected Clip (Ctrl+D)"
            data-testid="timeline-duplicate-btn"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Duplicate</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!selectedClipId}
            onClick={deleteSelectedClip}
            title="Delete Selected Clip (Delete)"
            data-testid="timeline-delete-btn"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            <span className="hidden sm:inline">Delete</span>
          </Button>

          {selectedClip && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => closeGapsOnTrack(selectedClip.trackId)}
              title="Pack clips & close gaps on current track"
              data-testid="timeline-close-gaps-btn"
            >
              <ArrowLeftToLine className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden md:inline">Close Gaps</span>
            </Button>
          )}
        </div>

        {/* Center: Add New Track Controls */}
        <div className="hidden xl:flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Add Track:
          </span>
          {(['video', 'overlay', 'text', 'audio'] as TrackType[]).map((tType) => (
            <button
              key={tType}
              type="button"
              onClick={() => addTrack(tType)}
              data-testid={`add-track-${tType}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer capitalize"
            >
              <Plus className="h-3 w-3 text-sky-400" />
              <span>{tType}</span>
            </button>
          ))}
        </div>

        {/* Right: Frame Timecode Readout, Snap, Ripple & Zoom Scale */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            data-testid="timeline-frame-readout"
            className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono tabular-nums text-slate-300"
            title="Playhead rational timecode and integer frame index"
          >
            {formatTimecode(playheadTime)} · F{secondsToFrames(playheadTime, fps)}
          </span>

          <Button
            type="button"
            variant={snapEnabled ? 'secondary' : 'ghost'}
            size="sm"
            onClick={toggleSnap}
            title="Toggle Magnetic Snapping (N)"
            data-testid="timeline-snap-toggle"
          >
            <Magnet
              className={`h-3.5 w-3.5 ${
                snapEnabled ? 'text-sky-400' : 'text-slate-400'
              }`}
            />
            <span className="hidden sm:inline">Snap</span>
          </Button>

          <Button
            type="button"
            variant={rippleDeleteEnabled ? 'secondary' : 'ghost'}
            size="sm"
            onClick={toggleRippleDelete}
            title="Toggle Ripple Delete"
            data-testid="timeline-ripple-toggle"
          >
            <Layers
              className={`h-3.5 w-3.5 ${
                rippleDeleteEnabled ? 'text-sky-400' : 'text-slate-400'
              }`}
            />
            <span className="hidden sm:inline">Ripple</span>
          </Button>

          <div className="flex items-center gap-1.5 w-28 sm:w-36">
            <button
              type="button"
              onClick={() => setTimelineZoom(timelineZoom - 12)}
              title="Zoom Out Timeline"
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <Slider
              min={28}
              max={180}
              step={4}
              value={[timelineZoom]}
              onValueChange={([val]) => setTimelineZoom(val)}
              aria-label="Timeline zoom"
            />
            <button
              type="button"
              onClick={() => setTimelineZoom(timelineZoom + 12)}
              title="Zoom In Timeline"
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Track Matrix */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Track Headers Column */}
        <div className="w-40 sm:w-52 shrink-0 border-r border-slate-800/90 bg-[#0F172A]/90 flex flex-col overflow-y-auto">
          {/* Ruler Header Corner */}
          <div className="h-7 border-b border-slate-800/80 px-2.5 sm:px-3 flex items-center justify-between text-[10px] sm:text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
            <span>TRACKS ({tracks.length})</span>
            <span>{clips.length} CLIPS</span>
          </div>

          {/* Track Header Rows */}
          <div className="flex-1 flex flex-col divide-y divide-slate-800/80">
            {tracks.map((track) => {
              const overlaps = detectTrackOverlaps(clips, track.id);
              const gaps = detectTrackGaps(clips, track.id);
              return (
                <div
                  key={track.id}
                  className="flex-1 flex items-center justify-between px-2.5 sm:px-3 min-h-[36px] gap-1"
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        track.type === 'video'
                          ? 'bg-sky-400'
                          : track.type === 'overlay'
                            ? 'bg-teal-400'
                            : track.type === 'text'
                              ? 'bg-indigo-400'
                              : 'bg-emerald-400'
                      }`}
                    />
                    <span className="text-[11px] sm:text-xs font-medium text-slate-200 truncate">
                      {track.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {overlaps.length > 0 && (
                      <button
                        type="button"
                        onClick={() => resolveOverlapsOnTrack(track.id)}
                        title={`${overlaps.length} clip overlap(s) — click to resolve`}
                        className="p-1 rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                      >
                        <AlertTriangle className="h-3 w-3" />
                      </button>
                    )}
                    {gaps.length > 0 && !track.locked && (
                      <button
                        type="button"
                        onClick={() => closeGapsOnTrack(track.id)}
                        title={`Close ${gaps.length} gap(s) on ${track.name}`}
                        className="p-1 rounded hover:bg-slate-800 text-emerald-400 cursor-pointer"
                      >
                        <ArrowLeftToLine className="h-3 w-3" />
                      </button>
                    )}
                    {track.type !== 'text' && (
                      <button
                        type="button"
                        onClick={() => toggleTrackMute(track.id)}
                        title={track.muted ? 'Unmute track' : 'Mute track'}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                      >
                        {track.muted ? (
                          <VolumeX className="h-3 w-3 text-rose-400" />
                        ) : (
                          <Volume2 className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    {track.type !== 'audio' && (
                      <button
                        type="button"
                        onClick={() => toggleTrackHidden(track.id)}
                        title={track.hidden ? 'Show track' : 'Hide track'}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                      >
                        {track.hidden ? (
                          <EyeOff className="h-3 w-3 text-amber-400" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleTrackLock(track.id)}
                      title={track.locked ? 'Unlock track' : 'Lock track'}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {track.locked ? (
                        <Lock className="h-3 w-3 text-sky-400" />
                      ) : (
                        <Unlock className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable Timeline Canvas Area */}
        <div
          ref={scrollContainerRef}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const assetId = e.dataTransfer.getData(
              'application/x-frameforge-asset'
            );
            if (assetId) {
              const dropTime = clientXToTime(e.clientX);
              const targetEl = e.target as HTMLElement | null;
              const laneEl = targetEl?.closest('[data-track-id]') as
                | HTMLElement
                | null;
              appendAssetToTimeline(
                assetId,
                dropTime,
                laneEl?.dataset.trackId
              );
            }
          }}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#090D16]"
        >
          <div
            style={{ width: `${timelineWidthPx}px` }}
            className="min-h-full flex flex-col relative"
          >
            {/* Timecode Ruler */}
            <div
              onPointerDown={(e) => {
                setIsPlaying(false);
                setPlayheadTime(clientXToTime(e.clientX));
                setDragMode({
                  type: 'scrub',
                  initialMouseX: e.clientX,
                  initialStartTime: 0,
                  initialDuration: 0,
                });
              }}
              data-testid="timeline-ruler"
              className="h-7 border-b border-slate-800 bg-[#0F172A]/70 relative cursor-ew-resize shrink-0"
            >
              {tickMarks.map((sec) => (
                <div
                  key={sec}
                  style={{ left: `${sec * timelineZoom}px` }}
                  className="absolute top-0 bottom-0 flex flex-col justify-end pb-1 pointer-events-none"
                >
                  <div className="h-2 w-px bg-slate-700" />
                  <span className="text-[10px] font-mono tabular-nums text-slate-400 pl-1">
                    {formatTimecode(sec).slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>

            {/* Track Lanes */}
            <div className="flex-1 flex flex-col divide-y divide-slate-800/60 relative">
              {tracks.map((track) => {
                const allTrackClips = clips.filter(
                  (c) => c.trackId === track.id
                );
                // Virtualize clip rendering when a track contains many clips (>24)
                const trackClips =
                  allTrackClips.length > 24
                    ? filterVisibleClips(
                        allTrackClips,
                        viewportRange.start,
                        viewportRange.end,
                        4.0
                      )
                    : allTrackClips;
                const trackGaps = detectTrackGaps(allTrackClips, track.id);

                return (
                  <div
                    key={track.id}
                    data-track-id={track.id}
                    data-testid={`timeline-track-${track.id}`}
                    className={`flex-1 relative min-h-[36px] ${
                      track.locked ? 'bg-slate-900/40 opacity-75' : ''
                    }`}
                  >
                    {/* Subtle interactive gap blocks */}
                    {trackGaps.map((gap, idx) => {
                      const gapLeftPx = gap.startTime * timelineZoom;
                      const gapWidthPx = gap.duration * timelineZoom;
                      if (gapWidthPx < 24) return null;
                      return (
                        <button
                          key={`gap_${track.id}_${idx}`}
                          type="button"
                          onClick={() => closeGapsOnTrack(track.id)}
                          style={{
                            left: `${gapLeftPx}px`,
                            width: `${gapWidthPx}px`,
                          }}
                          title={`Empty gap (${gap.duration.toFixed(2)}s) — click to ripple close`}
                          className="absolute top-1.5 bottom-1.5 rounded border border-dashed border-slate-800/90 bg-slate-900/20 hover:bg-emerald-500/10 hover:border-emerald-500/40 flex items-center justify-center text-[9px] font-mono text-slate-600 hover:text-emerald-300 transition-colors cursor-pointer"
                        >
                          {gapWidthPx > 56 ? `Gap ${gap.duration.toFixed(1)}s` : '↔'}
                        </button>
                      );
                    })}

                    {trackClips.map((clip) => {
                      const isSelected = clip.id === selectedClipId;
                      const leftPx = clip.startTime * timelineZoom;
                      const widthPx = Math.max(18, clip.duration * timelineZoom);
                      const asset = assets.find((a) => a.id === clip.assetId);
                      const peaks = asset?.waveformPeaks ?? [];

                      return (
                        <div
                          key={clip.id}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            selectClip(clip.id);
                            if (track.locked) return;
                            beginClipGesture();
                            setDragMode({
                              type: 'move',
                              clipId: clip.id,
                              initialMouseX: e.clientX,
                              initialStartTime: clip.startTime,
                              initialDuration: clip.duration,
                              targetTrackId: clip.trackId,
                            });
                          }}
                          data-testid={`timeline-clip-${clip.id}`}
                          className={`group absolute top-1 bottom-1 rounded-md overflow-hidden border transition-shadow cursor-grab active:cursor-grabbing flex flex-col justify-between px-2 py-1 ${
                            isSelected
                              ? 'border-sky-400 ring-2 ring-sky-400/30 bg-slate-800/95 z-10'
                              : 'border-slate-700/90 bg-slate-800/75 hover:border-slate-600'
                          }`}
                        >
                          {/* Top Clip Title, Source Bounds & Duration */}
                          <div className="flex items-center justify-between gap-1 text-[11px] pointer-events-none z-10">
                            <span className="font-medium text-white truncate">
                              {clip.label}
                            </span>
                            <span className="font-mono tabular-nums text-[10px] text-slate-300 shrink-0">
                              {clip.duration.toFixed(2)}s
                              {clip.playbackRate !== 1
                                ? ` · ${clip.playbackRate}x`
                                : ''}
                            </span>
                          </div>

                          {/* Audio Waveform Bars (computed via Web Worker) */}
                          {peaks.length > 0 && (
                            <div className="flex items-end gap-px h-3 opacity-45 pointer-events-none">
                              {peaks.slice(0, 36).map((p, idx) => (
                                <div
                                  key={idx}
                                  style={{ height: `${Math.round(p * 100)}%` }}
                                  className={`flex-1 rounded-t-xs ${
                                    clip.trackType === 'audio'
                                      ? 'bg-emerald-400'
                                      : 'bg-sky-400'
                                  }`}
                                />
                              ))}
                            </div>
                          )}

                          {/* Left Trim Handle */}
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              selectClip(clip.id);
                              if (track.locked) return;
                              beginClipGesture();
                              setDragMode({
                                type: 'trim-left',
                                clipId: clip.id,
                                initialMouseX: e.clientX,
                                initialStartTime: clip.startTime,
                                initialDuration: clip.duration,
                              });
                            }}
                            title="Drag to trim clip In-Point"
                            data-testid={`trim-left-${clip.id}`}
                            className="absolute left-0 top-0 bottom-0 w-2.5 bg-sky-400/0 group-hover:bg-sky-400/60 hover:bg-sky-400 cursor-ew-resize z-20"
                          />

                          {/* Right Trim Handle */}
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              selectClip(clip.id);
                              if (track.locked) return;
                              beginClipGesture();
                              setDragMode({
                                type: 'trim-right',
                                clipId: clip.id,
                                initialMouseX: e.clientX,
                                initialStartTime: clip.startTime,
                                initialDuration: clip.duration,
                              });
                            }}
                            title="Drag to trim clip Out-Point"
                            data-testid={`trim-right-${clip.id}`}
                            className="absolute right-0 top-0 bottom-0 w-2.5 bg-sky-400/0 group-hover:bg-sky-400/60 hover:bg-sky-400 cursor-ew-resize z-20"
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Vertical Playhead Line */}
              <div
                style={{ left: `${playheadTime * timelineZoom}px` }}
                className="absolute top-0 bottom-0 w-0.5 bg-sky-400 pointer-events-none z-30"
                data-testid="timeline-playhead-indicator"
              >
                <div className="w-3 h-3 -ml-[5px] -mt-1.5 rotate-45 bg-sky-400 rounded-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
