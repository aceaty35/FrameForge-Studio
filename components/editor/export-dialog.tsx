'use client';

import React, { useRef } from 'react';
import {
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Volume2,
  VolumeX,
  Cpu,
} from 'lucide-react';
import { useEditorStore } from '@/store/use-editor-store';
import {
  AudioBitratePreset,
  ExportEngineMode,
  ExportFormat,
  ExportResolution,
} from '@/types/editor';
import {
  estimateExportFileSizeBytes,
  exportTimelineVideo,
  FFMPEG_RUNTIME_SPEC,
  getExportRuntimeEnvironment,
  sanitizeSafeFilename,
} from '@/lib/export/exporter';
import { getResolutionDimensions } from '@/lib/renderer/canvas-compositor';
import { calculateProjectDuration, formatTimecode } from '@/lib/timeline/engine';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function ExportDialog({
  mediaElementsRef,
}: {
  mediaElementsRef: React.MutableRefObject<
    Map<string, HTMLVideoElement | HTMLImageElement>
  >;
}) {
  const isOpen = useEditorStore((s) => s.isExportDialogOpen);
  const setOpen = useEditorStore((s) => s.setExportDialogOpen);
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const canvasBackground = useEditorStore((s) => s.canvasBackground);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const assets = useEditorStore((s) => s.assets);
  const exportSettings = useEditorStore((s) => s.exportSettings);
  const updateExportSettings = useEditorStore((s) => s.updateExportSettings);
  const exportProgress = useEditorStore((s) => s.exportProgress);
  const setExportProgress = useEditorStore((s) => s.setExportProgress);

  const abortControllerRef = useRef<AbortController | null>(null);

  const duration = Math.max(1, calculateProjectDuration(clips));
  const dims = getResolutionDimensions(aspectRatio, exportSettings.resolution);
  const estimatedSizeBytes = estimateExportFileSizeBytes(
    duration,
    exportSettings
  );
  const estimatedSizeMb = (estimatedSizeBytes / (1024 * 1024)).toFixed(2);
  const runtimeEnv = getExportRuntimeEnvironment();

  const isRunning =
    exportProgress.status === 'initializing' ||
    exportProgress.status === 'rendering' ||
    exportProgress.status === 'encoding';

  const handleStartExport = async () => {
    if (isRunning) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await exportTimelineVideo({
        settings: exportSettings,
        aspectRatio,
        canvasBackground,
        clips,
        tracks,
        assets,
        mediaElements: mediaElementsRef.current,
        signal: controller.signal,
        onProgress: (p) => setExportProgress(p),
      });

      setExportProgress({
        status: 'completed',
        progress: 100,
        stageLabel: 'Verified video file rendered and encoded locally in browser.',
        outputUrl: result.url,
        outputSizeBytes: result.sizeBytes,
        engineUsed: result.engineUsed,
        outputFormat: result.outputFormat,
        codecSummary: result.codecSummary,
        hasAudio: result.hasAudio,
        fallbackWarning: result.fallbackWarning,
        memoryUsedMb: getExportRuntimeEnvironment().memoryUsedMb,
        completedAt: Date.now(),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        setExportProgress({
          status: 'cancelled',
          progress: 0,
          stageLabel: 'Export cancelled by user.',
        });
      } else {
        setExportProgress({
          status: 'error',
          progress: 0,
          stageLabel: 'Export failed',
          errorMessage:
            err instanceof Error ? err.message : 'Unknown encoding error',
        });
      }
    }
  };

  const handleCancelExport = () => {
    abortControllerRef.current?.abort();
  };

  const safeDownloadBase = sanitizeSafeFilename(exportSettings.filename);
  const downloadExt =
    exportProgress.outputFormat ??
    (exportProgress.engineUsed === 'native-stream'
      ? 'webm'
      : exportSettings.format);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        data-testid="export-dialog"
      >
        <DialogHeader>
          <DialogTitle>Export Video Locally</DialogTitle>
          <DialogDescription>
            Render and transcode your sequence directly in a Web Worker. Zero server
            uploads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Output Summary & Estimated File Size */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono tabular-nums text-slate-300">
            <span>
              {dims.width}×{dims.height} ({aspectRatio})
            </span>
            <span>·</span>
            <span>{formatTimecode(duration)}</span>
            <span>·</span>
            <span
              className="text-sky-400 font-semibold"
              data-testid="export-estimated-size"
            >
              Est. ~{estimatedSizeMb} MB
            </span>
          </div>

          {/* Filename */}
          <div className="space-y-1.5">
            <label
              htmlFor="export-filename-input"
              className="text-xs font-medium text-slate-300 block"
            >
              Output Filename
            </label>
            <input
              id="export-filename-input"
              type="text"
              disabled={isRunning}
              value={exportSettings.filename}
              onChange={(e) =>
                updateExportSettings({ filename: e.target.value })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white font-mono focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Format & Resolution */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">
                Output Format
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {(['webm', 'mp4', 'gif'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    disabled={isRunning}
                    onClick={() => updateExportSettings({ format: fmt })}
                    data-testid={`export-format-${fmt}`}
                    className={`py-1.5 text-xs font-mono uppercase rounded transition-colors cursor-pointer ${
                      exportSettings.format === fmt
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">
                Resolution
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {(['1080p', '720p', '480p'] as ExportResolution[]).map((res) => (
                  <button
                    key={res}
                    type="button"
                    disabled={isRunning}
                    onClick={() => updateExportSettings({ resolution: res })}
                    data-testid={`export-res-${res}`}
                    className={`py-1.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                      exportSettings.resolution === res
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Frame Rate & Quality Presets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">
                Frame Rate
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {([24, 30, 60] as const).map((fpsVal) => (
                  <button
                    key={fpsVal}
                    type="button"
                    disabled={isRunning}
                    onClick={() => updateExportSettings({ fps: fpsVal })}
                    className={`py-1.5 text-xs font-mono tabular-nums rounded transition-colors cursor-pointer ${
                      exportSettings.fps === fpsVal
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {fpsVal} FPS
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">
                Video Quality Preset
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {(['high', 'balanced', 'fast'] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isRunning}
                    onClick={() => updateExportSettings({ quality: q })}
                    className={`py-1.5 text-xs capitalize rounded transition-colors cursor-pointer ${
                      exportSettings.quality === q
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Audio Bitrate & Optional Audio Removal */}
          {exportSettings.format !== 'gif' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 block">
                  Audio Bitrate ({exportSettings.format === 'mp4' ? 'AAC' : 'Opus'})
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                  {(['128k', '192k', '320k'] as AudioBitratePreset[]).map(
                    (bitrate) => (
                      <button
                        key={bitrate}
                        type="button"
                        disabled={isRunning || Boolean(exportSettings.removeAudio)}
                        onClick={() =>
                          updateExportSettings({ audioBitrate: bitrate })
                        }
                        data-testid={`export-audio-bitrate-${bitrate}`}
                        className={`py-1.5 text-xs font-mono rounded transition-colors cursor-pointer disabled:opacity-40 ${
                          (exportSettings.audioBitrate ?? '192k') === bitrate
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {bitrate}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 block">
                  Audio Stream Output
                </label>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() =>
                    updateExportSettings({
                      removeAudio: !exportSettings.removeAudio,
                    })
                  }
                  data-testid="export-remove-audio-toggle"
                  className={`w-full h-[38px] px-3 rounded-lg border flex items-center justify-between text-xs transition-colors cursor-pointer ${
                    exportSettings.removeAudio
                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-200 font-medium'
                      : 'border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {exportSettings.removeAudio ? (
                      <VolumeX className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                    <span>
                      {exportSettings.removeAudio
                        ? 'Audio Stripped (-an)'
                        : 'Include Audio Track'}
                    </span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {exportSettings.removeAudio ? 'Muted' : 'Active'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Engine Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Transcode Pipeline Engine
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'auto', label: 'Auto (Recommended)' },
                  { id: 'native-stream', label: 'Native Stream' },
                  { id: 'ffmpeg-wasm', label: 'FFmpeg.wasm' },
                ] as { id: ExportEngineMode; label: string }[]
              ).map((eng) => (
                <button
                  key={eng.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => updateExportSettings({ engine: eng.id })}
                  className={`p-2 text-xs rounded-lg border transition-colors cursor-pointer ${
                    exportSettings.engine === eng.id
                      ? 'border-sky-500 bg-sky-500/15 text-white font-medium'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {eng.label}
                </button>
              ))}
            </div>
          </div>

          {/* Runtime & Worker Compatibility Telemetry */}
          <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-sky-400" />
              <span>
                FFmpeg.wasm v{FFMPEG_RUNTIME_SPEC.ffmpegPackageVersion} (core v
                {FFMPEG_RUNTIME_SPEC.coreVersion})
              </span>
            </span>
            <span>
              Worker: {runtimeEnv.webWorkerSupported ? 'Ready' : 'Unavailable'} ·
              COI: {runtimeEnv.crossOriginIsolated ? 'Multi-Thread' : 'Single-Thread'}
              {runtimeEnv.memoryUsedMb !== undefined
                ? ` · Heap ${runtimeEnv.memoryUsedMb} MB`
                : ''}
            </span>
          </div>

          {/* Live Progress Telemetry */}
          {exportProgress.status !== 'idle' && (
            <div
              className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/90 space-y-2"
              data-testid="export-progress-box"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200 flex items-center gap-2">
                  {isRunning && (
                    <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin" />
                  )}
                  {exportProgress.status === 'completed' && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                  {exportProgress.status === 'cancelled' && (
                    <XCircle className="h-4 w-4 text-amber-400" />
                  )}
                  {exportProgress.status === 'error' && (
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                  )}
                  {exportProgress.stageLabel}
                </span>
                <span className="font-mono tabular-nums text-sky-400">
                  {exportProgress.progress}%
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-150"
                  style={{ width: `${exportProgress.progress}%` }}
                />
              </div>

              {exportProgress.status === 'error' &&
                exportProgress.errorMessage && (
                  <p className="text-xs text-rose-300 pt-1">
                    {exportProgress.errorMessage}
                  </p>
                )}

              {exportProgress.fallbackWarning && (
                <p className="text-[11px] text-amber-300 pt-1">
                  {exportProgress.fallbackWarning}
                </p>
              )}

              {exportProgress.status === 'completed' && exportProgress.outputUrl && (
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-mono tabular-nums text-slate-400 space-y-0.5">
                    <div>
                      Size:{' '}
                      {Math.max(
                        1,
                        Math.round((exportProgress.outputSizeBytes || 2048) / 1024)
                      )}{' '}
                      KB · Engine: {exportProgress.engineUsed}
                    </div>
                    {exportProgress.codecSummary && (
                      <div className="text-slate-300">
                        Codec: {exportProgress.codecSummary}
                      </div>
                    )}
                  </div>
                  <a
                    href={exportProgress.outputUrl}
                    download={`${safeDownloadBase}.${downloadExt}`}
                    data-testid="download-exported-video-link"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-slate-950 font-semibold text-xs hover:bg-emerald-400 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download Result (.{downloadExt})</span>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            {isRunning ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleCancelExport}
                data-testid="cancel-export-btn"
              >
                Cancel Export
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleStartExport()}
                  data-testid="start-export-btn"
                >
                  Start Local Export
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
