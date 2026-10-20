'use client';

import React from 'react';
import {
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Trash2,
  Copy,
  Scissors,
  RotateCcw,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import { useEditorStore } from '@/store/use-editor-store';
import {
  ASPECT_RATIO_PRESETS,
  DEFAULT_CROP_SETTINGS,
  TextAnimationPreset,
} from '@/types/editor';
import { formatTimecode } from '@/lib/timeline/engine';
import {
  buildFfmpegDrawtextFilter,
  FONT_FAMILY_OPTIONS,
  TEXT_ANIMATION_OPTIONS,
} from '@/lib/subtitles/text-and-subtitles';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export function InspectorContent() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const clips = useEditorStore((s) => s.clips);
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const updateClip = useEditorStore((s) => s.updateClip);
  const setClipTiming = useEditorStore((s) => s.setClipTiming);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const setClipAudioFades = useEditorStore((s) => s.setClipAudioFades);
  const trimClipRight = useEditorStore((s) => s.trimClipRight);
  const updateClipFilters = useEditorStore((s) => s.updateClipFilters);
  const resetClipFilters = useEditorStore((s) => s.resetClipFilters);
  const updateClipTransform = useEditorStore((s) => s.updateClipTransform);
  const updateClipCrop = useEditorStore((s) => s.updateClipCrop);
  const resetClipCrop = useEditorStore((s) => s.resetClipCrop);
  const updateClipTextStyle = useEditorStore((s) => s.updateClipTextStyle);
  const splitSelectedClipAtPlayhead = useEditorStore(
    (s) => s.splitSelectedClipAtPlayhead
  );
  const duplicateSelectedClip = useEditorStore((s) => s.duplicateSelectedClip);
  const deleteSelectedClip = useEditorStore((s) => s.deleteSelectedClip);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  if (!selectedClip) {
    return (
      <div className="p-5 flex flex-col justify-between h-full select-none space-y-6">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Properties Panel</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Select any video, subtitle, or audio clip on the timeline to adjust its
            position, scale, rotation, opacity, volume, text formatting, or crop
            settings.
          </p>
        </div>

        <div className="border-t border-slate-800 pt-4 space-y-2 text-xs text-slate-400">
          <div className="font-semibold text-slate-300">Keyboard Shortcuts</div>
          <div className="flex justify-between">
            <span>Play / Pause</span>
            <kbd className="font-mono text-slate-200">Space</kbd>
          </div>
          <div className="flex justify-between">
            <span>Split Clip at Playhead</span>
            <kbd className="font-mono text-slate-200">S</kbd>
          </div>
          <div className="flex justify-between">
            <span>Delete Selected Clip</span>
            <kbd className="font-mono text-slate-200">Delete / Backspace</kbd>
          </div>
          <div className="flex justify-between">
            <span>Undo / Redo</span>
            <kbd className="font-mono text-slate-200">Ctrl+Z / Ctrl+Y</kbd>
          </div>
        </div>
      </div>
    );
  }

  const speedPresets = [0.5, 1, 1.5, 2];
  const crop = selectedClip.transform.crop ?? DEFAULT_CROP_SETTINGS;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5 select-none">
      {/* 1. Selected Clip Properties & Quick Actions */}
      <div className="space-y-3 pb-3 border-b border-slate-800">
        <div>
          <div className="text-[11px] text-slate-400 font-mono uppercase">
            {selectedClip.trackType} Clip Properties
          </div>
          <h2
            className="text-sm font-semibold text-white truncate mt-0.5"
            data-testid="inspector-clip-label"
          >
            {selectedClip.label}
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => splitSelectedClipAtPlayhead()}
            title="Split clip at current playhead (S)"
            data-testid="inspector-split-btn"
          >
            <Scissors className="h-3.5 w-3.5 text-sky-400" />
            <span>Split</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={duplicateSelectedClip}
            title="Duplicate clip"
            data-testid="inspector-duplicate-btn"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copy</span>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={deleteSelectedClip}
            title="Delete clip (Delete)"
            data-testid="inspector-delete-btn"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete</span>
          </Button>
        </div>

        {/* Timing Readout */}
        <div className="grid grid-cols-3 gap-1.5 text-center pt-1">
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
            <div className="text-[10px] text-slate-400">Start</div>
            <div className="text-xs font-mono tabular-nums text-white mt-0.5">
              {formatTimecode(selectedClip.startTime)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
            <div className="text-[10px] text-slate-400">Duration</div>
            <div
              className="text-xs font-mono tabular-nums text-sky-400 mt-0.5"
              data-testid="inspector-clip-duration"
            >
              {formatTimecode(selectedClip.duration)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
            <div className="text-[10px] text-slate-400">Source In</div>
            <div className="text-xs font-mono tabular-nums text-white mt-0.5">
              {formatTimecode(selectedClip.inPoint)}
            </div>
          </div>
        </div>

        {/* Precision Trim Duration Slider */}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Trim Duration</span>
            <span className="font-mono tabular-nums text-slate-200">
              {selectedClip.duration.toFixed(2)}s
            </span>
          </div>
          <Slider
            min={0.2}
            max={Math.max(10, Math.ceil(selectedClip.duration + 4))}
            step={0.1}
            value={[selectedClip.duration]}
            onValueChange={([val]) => trimClipRight(selectedClip.id, val)}
            aria-label="Trim clip duration"
          />
        </div>
      </div>

      {/* 2. Text Properties (when Text or Subtitle clip is selected) */}
      {selectedClip.trackType === 'text' && selectedClip.textStyle && (
        <div className="space-y-3.5 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Text &amp; Subtitle Styling
            </span>
            <span className="text-[10px] font-mono text-sky-400">
              Drag on canvas to move
            </span>
          </div>

          {/* Multiline & Unicode/Hindi Text Content */}
          <div className="space-y-1.5">
            <label
              htmlFor="caption-text-input"
              className="text-xs text-slate-400 block"
            >
              Caption Content (Multiline &amp; Unicode / Hindi Supported)
            </label>
            <textarea
              id="caption-text-input"
              rows={3}
              value={selectedClip.textStyle.text}
              onChange={(e) =>
                updateClipTextStyle(selectedClip.id, { text: e.target.value })
              }
              data-testid="inspector-caption-textarea"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Start Time & End Time Precision Controls */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label
                htmlFor="inspector-text-start-input"
                className="text-[11px] text-slate-400 block"
              >
                Start Time (s)
              </label>
              <input
                id="inspector-text-start-input"
                type="number"
                min={0}
                step={0.1}
                value={Number(selectedClip.startTime.toFixed(2))}
                onChange={(e) => {
                  const nextStart = Number(e.target.value);
                  const currentEnd =
                    selectedClip.startTime + selectedClip.duration;
                  if (Number.isFinite(nextStart) && nextStart >= 0) {
                    setClipTiming(
                      selectedClip.id,
                      nextStart,
                      Math.max(nextStart + 0.2, currentEnd)
                    );
                  }
                }}
                data-testid="inspector-text-start-input"
                className="w-full rounded bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs font-mono tabular-nums text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="inspector-text-end-input"
                className="text-[11px] text-slate-400 block"
              >
                End Time (s)
              </label>
              <input
                id="inspector-text-end-input"
                type="number"
                min={Number((selectedClip.startTime + 0.2).toFixed(2))}
                step={0.1}
                value={Number(
                  (selectedClip.startTime + selectedClip.duration).toFixed(2)
                )}
                onChange={(e) => {
                  const nextEnd = Number(e.target.value);
                  if (Number.isFinite(nextEnd)) {
                    setClipTiming(
                      selectedClip.id,
                      selectedClip.startTime,
                      nextEnd
                    );
                  }
                }}
                data-testid="inspector-text-end-input"
                className="w-full rounded bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs font-mono tabular-nums text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Font Family & Weight */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label
                htmlFor="inspector-font-family-select"
                className="text-[11px] text-slate-400 block"
              >
                Font Family
              </label>
              <select
                id="inspector-font-family-select"
                value={selectedClip.textStyle.fontFamily}
                onChange={(e) =>
                  updateClipTextStyle(selectedClip.id, {
                    fontFamily: e.target.value,
                  })
                }
                data-testid="inspector-font-family-select"
                className="w-full h-8 rounded bg-slate-900 border border-slate-800 px-2 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                {FONT_FAMILY_OPTIONS.map((font) => (
                  <option
                    key={font.id}
                    value={font.cssFamily}
                    className="bg-slate-900"
                  >
                    {font.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="inspector-font-weight-select"
                className="text-[11px] text-slate-400 block"
              >
                Weight
              </label>
              <select
                id="inspector-font-weight-select"
                value={selectedClip.textStyle.fontWeight || 700}
                onChange={(e) =>
                  updateClipTextStyle(selectedClip.id, {
                    fontWeight: Number(e.target.value),
                  })
                }
                className="w-full h-8 rounded bg-slate-900 border border-slate-800 px-2 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value={400} className="bg-slate-900">
                  400 Reg
                </option>
                <option value={600} className="bg-slate-900">
                  600 Semi
                </option>
                <option value={700} className="bg-slate-900">
                  700 Bold
                </option>
              </select>
            </div>
          </div>

          {/* Font Size */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Font Size</span>
              <span className="font-mono tabular-nums text-slate-200">
                {selectedClip.textStyle.fontSize}px
              </span>
            </div>
            <Slider
              min={16}
              max={140}
              step={2}
              value={[selectedClip.textStyle.fontSize]}
              onValueChange={([val]) =>
                updateClipTextStyle(selectedClip.id, { fontSize: val })
              }
            />
          </div>

          {/* Text Color & Alignment */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label
                htmlFor="text-color-picker"
                className="text-[11px] text-slate-400 block"
              >
                Text Color
              </label>
              <input
                id="text-color-picker"
                type="color"
                value={selectedClip.textStyle.color || '#FFFFFF'}
                onChange={(e) =>
                  updateClipTextStyle(selectedClip.id, { color: e.target.value })
                }
                data-testid="inspector-text-color-input"
                className="w-full h-8 rounded bg-slate-900 border border-slate-800 cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] text-slate-400 block">Alignment</span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800 h-8">
                {(
                  [
                    { id: 'left', icon: <AlignLeft className="h-3.5 w-3.5" /> },
                    { id: 'center', icon: <AlignCenter className="h-3.5 w-3.5" /> },
                    { id: 'right', icon: <AlignRight className="h-3.5 w-3.5" /> },
                  ] as const
                ).map((align) => (
                  <button
                    key={align.id}
                    type="button"
                    onClick={() =>
                      updateClipTextStyle(selectedClip.id, {
                        textAlign: align.id,
                      })
                    }
                    data-testid={`inspector-text-align-${align.id}`}
                    className={`flex items-center justify-center rounded cursor-pointer ${
                      selectedClip.textStyle?.textAlign === align.id
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {align.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Background Pill Style & Outline Stroke */}
          <div className="space-y-2 pt-1 border-t border-slate-800/70">
            <div className="text-[11px] text-slate-400">
              Background Box Preset
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: 'None', value: 'transparent' },
                { label: 'Slate', value: 'rgba(15, 23, 42, 0.86)' },
                { label: 'Brand', value: 'rgba(2, 132, 199, 0.9)' },
                { label: 'Black', value: 'rgba(0, 0, 0, 0.85)' },
              ].map((bg) => (
                <button
                  key={bg.label}
                  type="button"
                  onClick={() =>
                    updateClipTextStyle(selectedClip.id, {
                      backgroundColor: bg.value,
                    })
                  }
                  className={`py-1 text-[11px] rounded border transition-colors cursor-pointer ${
                    selectedClip.textStyle?.backgroundColor === bg.value
                      ? 'border-sky-500 bg-sky-500/15 text-white font-medium'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 items-end pt-1">
              <div className="col-span-2 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Outline Width</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {selectedClip.textStyle.outlineWidth || 0}px
                  </span>
                </div>
                <Slider
                  min={0}
                  max={12}
                  step={1}
                  value={[selectedClip.textStyle.outlineWidth || 0]}
                  onValueChange={([val]) =>
                    updateClipTextStyle(selectedClip.id, { outlineWidth: val })
                  }
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="outline-color-picker"
                  className="text-[11px] text-slate-400 block"
                >
                  Outline
                </label>
                <input
                  id="outline-color-picker"
                  type="color"
                  value={selectedClip.textStyle.outlineColor || '#000000'}
                  onChange={(e) =>
                    updateClipTextStyle(selectedClip.id, {
                      outlineColor: e.target.value,
                    })
                  }
                  className="w-full h-8 rounded bg-slate-900 border border-slate-800 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Text Animation Preset */}
          <div className="space-y-1.5 pt-1 border-t border-slate-800/70">
            <label
              htmlFor="inspector-text-animation-select"
              className="text-[11px] text-slate-400 block"
            >
              Text Animation Preset
            </label>
            <select
              id="inspector-text-animation-select"
              value={selectedClip.textStyle.animation || 'fade-in-out'}
              onChange={(e) =>
                updateClipTextStyle(selectedClip.id, {
                  animation: e.target.value as TextAnimationPreset,
                })
              }
              data-testid="inspector-text-animation-select"
              className="w-full h-8 rounded bg-slate-900 border border-slate-800 px-2 text-xs text-white focus:border-sky-500 focus:outline-none"
            >
              {TEXT_ANIMATION_OPTIONS.map((anim) => (
                <option
                  key={anim.id}
                  value={anim.id}
                  className="bg-slate-900"
                >
                  {anim.label}
                </option>
              ))}
            </select>
          </div>

          {/* Position (X, Y), Rotation & Keep Within Canvas */}
          <div className="space-y-2.5 pt-1 border-t border-slate-800/70">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Horizontal Position (X)</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {Math.round(selectedClip.textStyle.x * 100)}%
                </span>
              </div>
              <Slider
                min={5}
                max={95}
                step={1}
                value={[Math.round(selectedClip.textStyle.x * 100)]}
                onValueChange={([val]) =>
                  updateClipTextStyle(selectedClip.id, { x: val / 100 })
                }
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Vertical Position (Y)</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {Math.round(selectedClip.textStyle.y * 100)}%
                </span>
              </div>
              <Slider
                min={5}
                max={95}
                step={1}
                value={[Math.round(selectedClip.textStyle.y * 100)]}
                onValueChange={([val]) =>
                  updateClipTextStyle(selectedClip.id, { y: val / 100 })
                }
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Text Rotation</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-slate-200">
                    {selectedClip.textStyle.rotation ?? 0}°
                  </span>
                  {(selectedClip.textStyle.rotation ?? 0) !== 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateClipTextStyle(selectedClip.id, { rotation: 0 })
                      }
                      className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <Slider
                min={-180}
                max={180}
                step={1}
                value={[selectedClip.textStyle.rotation ?? 0]}
                onValueChange={([val]) =>
                  updateClipTextStyle(selectedClip.id, { rotation: val })
                }
              />
            </div>

            {/* Keep Within Output Canvas Toggle */}
            <label className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer text-xs">
              <span className="text-slate-300">
                Keep text within output canvas
              </span>
              <input
                type="checkbox"
                checked={selectedClip.textStyle.keepWithinCanvas !== false}
                onChange={(e) =>
                  updateClipTextStyle(selectedClip.id, {
                    keepWithinCanvas: e.target.checked,
                  })
                }
                data-testid="inspector-keep-in-canvas-checkbox"
                className="accent-sky-400 h-3.5 w-3.5 cursor-pointer"
              />
            </label>
          </div>

          {/* Escaped FFmpeg Drawtext Filter Readout */}
          <div className="space-y-1 pt-1 border-t border-slate-800/70">
            <div className="text-[10px] font-mono text-slate-400">
              Escaped FFmpeg drawtext Filter ({aspectRatio}):
            </div>
            <div
              className="p-2 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400 break-all max-h-20 overflow-y-auto"
              data-testid="inspector-ffmpeg-drawtext-preview"
            >
              {buildFfmpegDrawtextFilter(
                selectedClip,
                ASPECT_RATIO_PRESETS[aspectRatio].width,
                ASPECT_RATIO_PRESETS[aspectRatio].height
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Position, Scale & Rotation (for Video & Overlay clips) */}
      {(selectedClip.trackType === 'video' ||
        selectedClip.trackType === 'overlay') && (
        <div className="space-y-3 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Position, Scale & Rotation
            </span>
            <button
              type="button"
              onClick={() =>
                updateClipTransform(selectedClip.id, {
                  scale: 1,
                  x: 0,
                  y: 0,
                  rotation: 0,
                  flipH: false,
                  flipV: false,
                })
              }
              className="text-[11px] text-sky-400 hover:underline cursor-pointer"
            >
              Reset
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Scale</span>
              <span className="font-mono tabular-nums text-slate-200">
                {Math.round(selectedClip.transform.scale * 100)}%
              </span>
            </div>
            <Slider
              min={25}
              max={250}
              step={5}
              value={[Math.round(selectedClip.transform.scale * 100)]}
              onValueChange={([val]) =>
                updateClipTransform(selectedClip.id, { scale: val / 100 })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Pos X</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {Math.round(selectedClip.transform.x * 100)}%
                </span>
              </div>
              <Slider
                min={-80}
                max={80}
                step={2}
                value={[Math.round(selectedClip.transform.x * 100)]}
                onValueChange={([val]) =>
                  updateClipTransform(selectedClip.id, { x: val / 100 })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Pos Y</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {Math.round(selectedClip.transform.y * 100)}%
                </span>
              </div>
              <Slider
                min={-80}
                max={80}
                step={2}
                value={[Math.round(selectedClip.transform.y * 100)]}
                onValueChange={([val]) =>
                  updateClipTransform(selectedClip.id, { y: val / 100 })
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() =>
                updateClipTransform(selectedClip.id, {
                  rotation: (selectedClip.transform.rotation + 90) % 360,
                })
              }
              title="Rotate 90 degrees clockwise"
              data-testid="inspector-rotate-btn"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Rotate ({selectedClip.transform.rotation}°)</span>
            </Button>
            <Button
              type="button"
              variant={selectedClip.transform.flipH ? 'default' : 'secondary'}
              size="sm"
              onClick={() =>
                updateClipTransform(selectedClip.id, {
                  flipH: !selectedClip.transform.flipH,
                })
              }
              title="Flip Horizontal"
            >
              <FlipHorizontal className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant={selectedClip.transform.flipV ? 'default' : 'secondary'}
              size="sm"
              onClick={() =>
                updateClipTransform(selectedClip.id, {
                  flipV: !selectedClip.transform.flipV,
                })
              }
              title="Flip Vertical"
            >
              <FlipVertical className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 4. Crop Settings (for Video & Overlay clips) */}
      {(selectedClip.trackType === 'video' ||
        selectedClip.trackType === 'overlay') && (
        <div className="space-y-3 pb-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Crop Settings
            </span>
            <button
              type="button"
              onClick={() => resetClipCrop(selectedClip.id)}
              className="text-[11px] text-sky-400 hover:underline cursor-pointer"
            >
              Reset Crop
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: 'top', label: 'Top' },
                { key: 'bottom', label: 'Bottom' },
                { key: 'left', label: 'Left' },
                { key: 'right', label: 'Right' },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {crop[key]}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={40}
                  step={1}
                  value={[crop[key]]}
                  onValueChange={([val]) =>
                    updateClipCrop(selectedClip.id, { [key]: val })
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Opacity, Volume & Playback Speed */}
      <div className="space-y-3 pb-3 border-b border-slate-800">
        <div className="text-xs font-semibold text-slate-200">
          Opacity, Volume & Speed
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Opacity</span>
            <span className="font-mono tabular-nums text-slate-200">
              {selectedClip.filters.opacity}%
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={2}
            value={[selectedClip.filters.opacity]}
            onValueChange={([val]) =>
              updateClipFilters(selectedClip.id, { opacity: val })
            }
          />
        </div>

        {selectedClip.trackType !== 'text' && (
          <>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Volume</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {selectedClip.volume}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[selectedClip.volume]}
                onValueChange={([val]) =>
                  updateClip(selectedClip.id, { volume: val })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Fade In</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {selectedClip.fadeIn.toFixed(2)}s
                  </span>
                </div>
                <Slider
                  min={0}
                  max={Math.max(0.5, Number((selectedClip.duration / 2).toFixed(1)))}
                  step={0.05}
                  value={[selectedClip.fadeIn]}
                  onValueChange={([val]) =>
                    setClipAudioFades(selectedClip.id, { fadeIn: val })
                  }
                  aria-label="Audio fade in"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Fade Out</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {selectedClip.fadeOut.toFixed(2)}s
                  </span>
                </div>
                <Slider
                  min={0}
                  max={Math.max(0.5, Number((selectedClip.duration / 2).toFixed(1)))}
                  step={0.05}
                  value={[selectedClip.fadeOut]}
                  onValueChange={([val]) =>
                    setClipAudioFades(selectedClip.id, { fadeOut: val })
                  }
                  aria-label="Audio fade out"
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Speed</span>
                <span className="font-mono tabular-nums text-sky-400">
                  {selectedClip.playbackRate}x
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {speedPresets.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setClipSpeed(selectedClip.id, rate)}
                    className={`py-1 text-xs font-mono tabular-nums rounded transition-colors cursor-pointer ${
                      selectedClip.playbackRate === rate
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 6. Color Grading (for Video / Overlay) */}
      {(selectedClip.trackType === 'video' ||
        selectedClip.trackType === 'overlay') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Color Grading
            </span>
            <button
              type="button"
              onClick={() => resetClipFilters(selectedClip.id)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-400 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Brightness</span>
              <span className="font-mono tabular-nums text-slate-200">
                {selectedClip.filters.brightness}%
              </span>
            </div>
            <Slider
              min={40}
              max={180}
              step={2}
              value={[selectedClip.filters.brightness]}
              onValueChange={([val]) =>
                updateClipFilters(selectedClip.id, { brightness: val })
              }
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Contrast</span>
              <span className="font-mono tabular-nums text-slate-200">
                {selectedClip.filters.contrast}%
              </span>
            </div>
            <Slider
              min={40}
              max={180}
              step={2}
              value={[selectedClip.filters.contrast]}
              onValueChange={([val]) =>
                updateClipFilters(selectedClip.id, { contrast: val })
              }
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Saturation</span>
              <span className="font-mono tabular-nums text-slate-200">
                {selectedClip.filters.saturation}%
              </span>
            </div>
            <Slider
              min={0}
              max={200}
              step={5}
              value={[selectedClip.filters.saturation]}
              onValueChange={([val]) =>
                updateClipFilters(selectedClip.id, { saturation: val })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function InspectorPanel() {
  return (
    <aside
      aria-label="Clip properties panel"
      className="hidden lg:flex w-80 shrink-0 border-l border-slate-800/90 bg-[#0F172A]/85 flex-col h-full overflow-hidden"
      data-testid="inspector-panel"
    >
      <InspectorContent />
    </aside>
  );
}
