'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ActiveSidebarTab, useEditorStore } from '@/store/use-editor-store';

const DynamicVideoEditorWorkspace = dynamic(
  () =>
    import('@/components/editor/video-editor-workspace').then(
      (mod) => mod.VideoEditorWorkspace
    ),
  {
    ssr: false,
    loading: () => (
      <div
        id="workspace"
        data-testid="workspace-loading-skeleton"
        aria-busy="true"
        aria-label="Loading FrameForge Studio workspace"
        className="flex flex-col h-screen w-full overflow-hidden bg-[#0B0F17] text-slate-300 select-none"
      >
        {/* Top Bar Skeleton */}
        <div className="h-14 border-b border-slate-800/90 bg-[#0F172A] px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-slate-800 animate-pulse" />
            <div className="h-4 w-44 rounded bg-slate-800 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 rounded-lg bg-slate-800 animate-pulse" />
            <div className="h-8 w-24 rounded-lg bg-sky-500/30 animate-pulse" />
          </div>
        </div>

        {/* Center 3-Column Studio Stage Skeleton */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="hidden lg:block w-80 border-r border-slate-800/90 bg-[#0F172A]/85 p-4 space-y-3">
            <div className="h-5 w-32 rounded bg-slate-800 animate-pulse" />
            <div className="h-28 w-full rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
            <div className="h-14 w-full rounded-lg bg-slate-900 border border-slate-800 animate-pulse" />
            <div className="h-14 w-full rounded-lg bg-slate-900 border border-slate-800 animate-pulse" />
          </div>

          <div className="flex-1 flex flex-col items-center justify-center bg-[#090D16] p-6">
            <div className="w-full max-w-xl aspect-video rounded-lg border border-slate-800 bg-slate-950 flex flex-col items-center justify-center gap-2">
              <div className="h-5 w-5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
              <span className="text-xs font-mono text-slate-400">
                Initializing 60 FPS Canvas Compositor...
              </span>
            </div>
          </div>

          <div className="hidden lg:block w-80 border-l border-slate-800/90 bg-[#0F172A]/85 p-4 space-y-3">
            <div className="h-5 w-36 rounded bg-slate-800 animate-pulse" />
            <div className="h-20 w-full rounded-lg bg-slate-900 border border-slate-800 animate-pulse" />
            <div className="h-24 w-full rounded-lg bg-slate-900 border border-slate-800 animate-pulse" />
          </div>
        </div>

        {/* Bottom Timeline Skeleton */}
        <div className="h-64 border-t border-slate-800/90 bg-[#0F172A] p-3 space-y-2">
          <div className="h-7 w-full rounded bg-slate-900 animate-pulse" />
          <div className="h-11 w-full rounded bg-slate-900/70 animate-pulse" />
          <div className="h-11 w-full rounded bg-slate-900/70 animate-pulse" />
          <div className="h-11 w-full rounded bg-slate-900/70 animate-pulse" />
        </div>
      </div>
    ),
  }
);

export interface LazyWorkspaceLoaderProps {
  initialTab?: ActiveSidebarTab;
}

export function LazyWorkspaceLoader({ initialTab }: LazyWorkspaceLoaderProps) {
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);

  useEffect(() => {
    if (initialTab) {
      setActiveSidebarTab(initialTab);
    }
  }, [initialTab, setActiveSidebarTab]);

  return <DynamicVideoEditorWorkspace />;
}
