'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Play, Sliders, ShieldCheck, ArrowUpRight } from 'lucide-react';
import type { ActiveSidebarTab } from '@/store/use-editor-store';

const DeferredWorkspaceLoader = dynamic(
  () =>
    import('@/components/editor/lazy-workspace-loader').then(
      (m) => m.LazyWorkspaceLoader
    ),
  { ssr: false }
);

export interface OnDemandToolWorkspaceProps {
  toolName: string;
  toolSummary: string;
  defaultTab?: ActiveSidebarTab;
  autoMount?: boolean;
}

export function OnDemandToolWorkspace({
  toolName,
  toolSummary,
  defaultTab = 'media',
  autoMount = false,
}: OnDemandToolWorkspaceProps) {
  const [isWorkspaceMounted, setIsWorkspaceMounted] = useState(autoMount);

  if (isWorkspaceMounted) {
    return (
      <div
        id="interactive-tool-stage"
        data-testid="mounted-tool-workspace"
        className="w-full border-y border-slate-800 bg-[#0B0F17]"
      >
        <DeferredWorkspaceLoader initialTab={defaultTab} />
      </div>
    );
  }

  return (
    <div
      id="interactive-tool-stage"
      data-testid="deferred-tool-launcher"
      className="w-full rounded-2xl border border-slate-800 bg-[#0F172A]/85 p-6 sm:p-8 min-h-[340px] flex flex-col justify-between gap-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="space-y-1">
          <div className="text-xs text-sky-400 font-medium">
            <span>Client-Side WebAssembly & Canvas 2D Engine</span>
            <span aria-hidden="true"> · </span>
            <span>Zero Server Uploads</span>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-white">
            Interactive {toolName} Workspace
          </h2>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>Files stay on your device</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center my-auto">
        <div className="lg:col-span-7 space-y-4">
          <p className="text-sm text-slate-300 leading-relaxed">
            {toolSummary}
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            To keep initial page load fast and save mobile memory, the multi-track
            editor engine and FFmpeg.wasm worker load only when you launch the
            workspace.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsWorkspaceMounted(true)}
              data-testid="launch-inline-workspace-btn"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm px-5 py-2.5 min-h-11 transition-colors cursor-pointer"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>Launch {toolName} Here</span>
            </button>

            <Link
              href="/#workspace"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 font-medium text-sm px-4 py-2.5 min-h-11 transition-colors"
            >
              <span>Open Full Studio</span>
              <ArrowUpRight className="h-4 w-4 text-slate-400" />
            </Link>
          </div>
        </div>

        {/* Fixed aspect-video visual schematic to guarantee zero layout shift (CLS = 0) */}
        <div className="lg:col-span-5">
          <div className="aspect-video w-full rounded-xl border border-slate-800 bg-[#090D16] p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>60 FPS COMPOSITOR</span>
              <span>EDL MODE: {defaultTab.toUpperCase()}</span>
            </div>

            <div className="my-auto flex flex-col items-center justify-center text-center gap-2 py-4">
              <Sliders className="h-7 w-7 text-sky-400" />
              <p className="text-xs font-medium text-slate-200">
                Ready for Local Media Import
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                MP4 · WebM · MOV · WAV · MP3 · SRT
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="h-2 w-full rounded bg-slate-900 overflow-hidden flex gap-1">
                <div className="w-2/5 h-full bg-sky-500/60 rounded" />
                <div className="w-2/5 h-full bg-indigo-500/60 rounded" />
                <div className="w-1/5 h-full bg-emerald-500/60 rounded" />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>00:00.000</span>
                <span>NON-DESTRUCTIVE TIMELINE</span>
                <span>1080P EXPORT</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
