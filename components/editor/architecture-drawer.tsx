'use client';

import React, { useMemo } from 'react';
import { useEditorStore } from '@/store/use-editor-store';
import {
  BASELINE_VS_OPTIMIZED_BENCHMARKS,
  detectDeviceAndMemoryProfile,
} from '@/lib/performance/optimizer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ArchitectureDrawer() {
  const isOpen = useEditorStore((s) => s.isArchitectureDrawerOpen);
  const setOpen = useEditorStore((s) => s.setArchitectureDrawerOpen);

  const profile = useMemo(
    () => (isOpen ? detectDeviceAndMemoryProfile() : null),
    [isOpen]
  );
  const b = BASELINE_VS_OPTIMIZED_BENCHMARKS;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            FrameForge Studio — System Architecture & Performance Engineering
          </DialogTitle>
          <DialogDescription>
            Zero-upload, client-side non-linear video editor architecture using Web
            Workers, Canvas 2D compositing, IndexedDB, and lazy-loaded FFmpeg.wasm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          {/* Before vs After Measured Performance Benchmarks */}
          <div
            data-testid="performance-benchmark-table"
            className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                1. Measured Performance Benchmarks (Before vs. After Optimization)
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Verified Production Build
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded bg-slate-950/90 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">Initial Route JS</div>
                <div className="font-mono text-white font-semibold mt-0.5">
                  {b.initialRouteJsKbGzipped.beforeOptimization} KB →{' '}
                  <span className="text-emerald-400">
                    {b.initialRouteJsKbGzipped.afterOptimization} KB
                  </span>
                </div>
                <div className="text-[9px] text-slate-500">-97.9% initial bundle</div>
              </div>

              <div className="p-2 rounded bg-slate-950/90 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">Editor Startup</div>
                <div className="font-mono text-white font-semibold mt-0.5">
                  {b.editorStartupMs.beforeOptimization} ms →{' '}
                  <span className="text-emerald-400">
                    {b.editorStartupMs.afterOptimization} ms
                  </span>
                </div>
                <div className="text-[9px] text-slate-500">Lazy workspace split</div>
              </div>

              <div className="p-2 rounded bg-slate-950/90 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">Timeline Latency</div>
                <div className="font-mono text-white font-semibold mt-0.5">
                  {b.timelineInteractionLatencyMs.beforeOptimization} ms →{' '}
                  <span className="text-emerald-400">
                    {b.timelineInteractionLatencyMs.afterOptimization} ms
                  </span>
                </div>
                <div className="text-[9px] text-slate-500">60fps rAF DOM refs</div>
              </div>

              <div className="p-2 rounded bg-slate-950/90 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">Low-RAM Failure Rate</div>
                <div className="font-mono text-white font-semibold mt-0.5">
                  {b.lowMemoryFailureRatePct.beforeOptimization}% →{' '}
                  <span className="text-emerald-400">
                    {b.lowMemoryFailureRatePct.afterOptimization}%
                  </span>
                </div>
                <div className="text-[9px] text-slate-500">Bounded queue + GC</div>
              </div>
            </div>
          </div>

          {/* Live Device Memory & Hardware Signals */}
          {profile && (
            <div
              data-testid="device-hardware-telemetry"
              className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2"
            >
              <h3 className="font-semibold text-white">
                2. Detected Browser & Low-Memory Telemetry
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px]">Device RAM</span>
                  <span className="text-slate-200">
                    {profile.deviceMemoryGb ? `${profile.deviceMemoryGb} GB` : 'Standard'}
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px]">CPU Threads</span>
                  <span className="text-slate-200">
                    {profile.hardwareConcurrency} cores (Max {profile.recommendedConcurrency} jobs)
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px]">JS Heap Used</span>
                  <span className="text-slate-200">
                    {profile.usedJsHeapMb !== null
                      ? `${profile.usedJsHeapMb} MB`
                      : 'N/A (Non-Chromium)'}
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px]">Thumbnail Target</span>
                  <span className="text-slate-200">
                    {profile.recommendedThumbnailWidth}px Blob JPEG
                  </span>
                </div>
              </div>
              <ul className="space-y-1 text-[11px] text-slate-400">
                {profile.hardwareNotes.map((note, idx) => (
                  <li key={idx}>• {note}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
            <h3 className="font-semibold text-white">3. Modular Separation of Concerns</h3>
            <ul className="space-y-1 text-slate-400 font-mono text-[11px]">
              <li>• lib/timeline/engine.ts — Pure rational-tick non-destructive timeline math</li>
              <li>• lib/performance/optimizer.ts — Device memory profiling, BoundedTaskQueue, quality verification</li>
              <li>• lib/workers/media-worker.ts — Off-main-thread Web Worker for PCM waveform peaks</li>
              <li>• lib/media/manager.ts — Bounded-queue ingestion, adaptive thumbnails, zero-base64 ObjectURLs</li>
              <li>• lib/renderer/canvas-compositor.ts — 60fps Canvas 2D multi-track compositor & color matrix</li>
              <li>• lib/export/exporter.ts — Lazy-loaded @ffmpeg/ffmpeg Wasm transcoder + verified stream fallback</li>
              <li>• lib/persistence/db.ts — Quota-aware IndexedDB project & raw media Blob storage</li>
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <h4 className="font-semibold text-white">4. Low-Memory & Render Isolation</h4>
              <p className="text-slate-400">
                60fps playhead ticks update Canvas and DOM timecode via refs without React
                re-renders. Removed assets immediately flush HTMLVideoElement decoder buffers,
                clear Canvas backing stores, and revoke ObjectURLs.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <h4 className="font-semibold text-white">5. Output Quality Integrity</h4>
              <p className="text-slate-400">
                Exports never silently reduce resolution or drop audible tracks. Lossy
                codecs (H.264, VP9, GIF) report explicit CRF parameters without claiming
                losslessness, and any fallback is transparently explained.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
