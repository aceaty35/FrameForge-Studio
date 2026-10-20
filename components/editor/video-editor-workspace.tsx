'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Film,
  Type,
  Subtitles,
  Sliders,
  Crop,
  SlidersHorizontal,
  X,
  AlertTriangle,
} from 'lucide-react';
import { ActiveSidebarTab, useEditorStore } from '@/store/use-editor-store';
import { detectDeviceAndMemoryProfile } from '@/lib/performance/optimizer';
import { TopBar } from '@/components/editor/top-bar';
import {
  MediaSidebar,
  SIDEBAR_TABS,
  SidebarToolContent,
} from '@/components/editor/media-sidebar';
import { ViewportPlayer } from '@/components/editor/viewport-player';
import {
  InspectorContent,
  InspectorPanel,
} from '@/components/editor/inspector-panel';
import { TimelinePanel } from '@/components/editor/timeline-panel';

import { SecurityRecoveryBanner } from '@/components/editor/security-audit-dialog';

// Lazy-load heavy export, architecture, settings, and security modals only when opened
const LazyExportDialog = dynamic(
  () =>
    import('@/components/editor/export-dialog').then((mod) => mod.ExportDialog),
  { ssr: false }
);
const LazyArchitectureDrawer = dynamic(
  () =>
    import('@/components/editor/architecture-drawer').then(
      (mod) => mod.ArchitectureDrawer
    ),
  { ssr: false }
);
const LazySettingsDialog = dynamic(
  () =>
    import('@/components/editor/settings-dialog').then(
      (mod) => mod.SettingsDialog
    ),
  { ssr: false }
);
const LazySecurityAuditDialog = dynamic(
  () =>
    import('@/components/editor/security-audit-dialog').then(
      (mod) => mod.SecurityAuditDialog
    ),
  { ssr: false }
);

export function VideoEditorWorkspace() {
  const mediaElementsRef = useRef<
    Map<string, HTMLVideoElement | HTMLImageElement>
  >(new Map());

  const [hardwareWarning, setHardwareWarning] = useState<string | null>(() => {
    const profile = detectDeviceAndMemoryProfile();
    return profile.warnings[0] ?? null;
  });

  const togglePlayPause = useEditorStore((s) => s.togglePlayPause);
  const splitSelectedClipAtPlayhead = useEditorStore(
    (s) => s.splitSelectedClipAtPlayhead
  );
  const deleteSelectedClip = useEditorStore((s) => s.deleteSelectedClip);
  const duplicateSelectedClip = useEditorStore((s) => s.duplicateSelectedClip);
  const stepPlayheadFrames = useEditorStore((s) => s.stepPlayheadFrames);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const moveClip = useEditorStore((s) => s.moveClip);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const hasUnsavedChanges = useEditorStore((s) => s.hasUnsavedChanges);
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled);
  const saveCurrentProject = useEditorStore((s) => s.saveCurrentProject);
  const restoreLastSessionProject = useEditorStore(
    (s) => s.restoreLastSessionProject
  );
  const missingMediaAssetIds = useEditorStore((s) => s.missingMediaAssetIds);

  const activeSidebarTab = useEditorStore((s) => s.activeSidebarTab);
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);
  const mobileSheetMode = useEditorStore((s) => s.mobileSheetMode);
  const setMobileSheetMode = useEditorStore((s) => s.setMobileSheetMode);
  const isExportDialogOpen = useEditorStore((s) => s.isExportDialogOpen);
  const isArchitectureDrawerOpen = useEditorStore(
    (s) => s.isArchitectureDrawerOpen
  );
  const isSettingsDialogOpen = useEditorStore((s) => s.isSettingsDialogOpen);
  const isSecurityDialogOpen = useEditorStore((s) => s.isSecurityDialogOpen);

  // Restore last active project from IndexedDB after page refresh
  useEffect(() => {
    void restoreLastSessionProject();
  }, [restoreLastSessionProject]);

  // Prevent accidental project loss via beforeunload warning & debounced IndexedDB auto-save
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    let timer: number | undefined;
    if (autoSaveEnabled) {
      timer = window.setTimeout(() => {
        void saveCurrentProject().catch(() => undefined);
      }, 2200);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [hasUnsavedChanges, autoSaveEnabled, saveCurrentProject]);

  // Global keyboard shortcuts (disabled when typing inside inputs/textareas)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveCurrentProject();
      } else if (e.key === 's' || e.key === 'S') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          splitSelectedClipAtPlayhead();
        }
      } else if (e.key === 'n' || e.key === 'N') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          toggleSnap();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelectedClip();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedClip();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (e.altKey && state.selectedClipId) {
          const clip = state.clips.find((c) => c.id === state.selectedClipId);
          if (clip) {
            moveClip(clip.id, Math.max(0, clip.startTime - 1 / 30));
          }
        } else {
          stepPlayheadFrames(e.shiftKey ? -5 : -1, state.exportSettings.fps);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (e.altKey && state.selectedClipId) {
          const clip = state.clips.find((c) => c.id === state.selectedClipId);
          if (clip) {
            moveClip(clip.id, clip.startTime + 1 / 30);
          }
        } else {
          stepPlayheadFrames(e.shiftKey ? 5 : 1, state.exportSettings.fps);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlayPause,
    splitSelectedClipAtPlayhead,
    deleteSelectedClip,
    duplicateSelectedClip,
    stepPlayheadFrames,
    toggleSnap,
    moveClip,
    undo,
    redo,
    saveCurrentProject,
  ]);

  const mobileNavItems: {
    label: string;
    tab?: ActiveSidebarTab;
    mode: 'tools' | 'properties';
    icon: React.ReactNode;
  }[] = [
    {
      label: 'Media',
      tab: 'media',
      mode: 'tools',
      icon: <Film className="h-4 w-4" />,
    },
    {
      label: 'Text',
      tab: 'text',
      mode: 'tools',
      icon: <Type className="h-4 w-4" />,
    },
    {
      label: 'Subtitles',
      tab: 'subtitles',
      mode: 'tools',
      icon: <Subtitles className="h-4 w-4" />,
    },
    {
      label: 'Effects',
      tab: 'effects',
      mode: 'tools',
      icon: <Sliders className="h-4 w-4" />,
    },
    {
      label: 'Crop',
      tab: 'crop',
      mode: 'tools',
      icon: <Crop className="h-4 w-4" />,
    },
    {
      label: 'Properties',
      mode: 'properties',
      icon: <SlidersHorizontal className="h-4 w-4" />,
    },
  ];

  return (
    <div
      id="workspace"
      className="flex flex-col h-screen w-full overflow-hidden bg-[#0B0F17]"
    >
      <TopBar />

      {/* Visible Recovery Path Banner for All 9 Expected Failure Scenarios */}
      <SecurityRecoveryBanner />

      {/* Low-Memory / Constrained Device Hardware Notice */}
      {hardwareWarning && (
        <div
          role="status"
          data-testid="low-memory-device-banner"
          className="flex items-center justify-between gap-2 px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-xs shrink-0"
        >
          <span className="inline-flex items-center gap-2 truncate">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="truncate">{hardwareWarning}</span>
          </span>
          <button
            type="button"
            onClick={() => setHardwareWarning(null)}
            aria-label="Dismiss hardware notice"
            className="text-[11px] underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Missing Local Media Relink Notice */}
      {missingMediaAssetIds.length > 0 && (
        <div
          role="alert"
          data-testid="missing-media-banner"
          className="flex items-center justify-between gap-2 px-4 py-1.5 bg-rose-500/15 border-b border-rose-500/30 text-rose-200 text-xs shrink-0"
        >
          <span className="inline-flex items-center gap-2 truncate">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span className="truncate">
              {missingMediaAssetIds.length} media file(s) in this project are missing from local browser storage. Relink the original file(s) from your device.
            </span>
          </span>
          <button
            type="button"
            onClick={() => setActiveSidebarTab('projects')}
            data-testid="open-missing-media-relink-btn"
            className="px-2.5 py-0.5 rounded bg-rose-500 text-slate-950 font-semibold text-[11px] hover:bg-rose-400 cursor-pointer shrink-0"
          >
            Relink Media
          </button>
        </div>
      )}

      {/* Center 3-Column Studio Stage */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <MediaSidebar />
        <ViewportPlayer mediaElementsRef={mediaElementsRef} />
        <InspectorPanel />
      </div>

      {/* Bottom Non-Linear Multi-Track Timeline */}
      <TimelinePanel />

      {/* Mobile Touch Bottom Editing Toolbar (<lg screens) */}
      <nav
        aria-label="Mobile editing toolbar"
        className="lg:hidden grid grid-cols-6 items-center h-14 border-t border-slate-800 bg-[#0F172A] shrink-0 px-1"
      >
        {mobileNavItems.map((item) => {
          const isActive =
            (item.mode === 'properties' && mobileSheetMode === 'properties') ||
            (item.mode === 'tools' &&
              mobileSheetMode === 'tools' &&
              item.tab === activeSidebarTab);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                if (item.mode === 'properties') {
                  setMobileSheetMode(
                    mobileSheetMode === 'properties' ? 'none' : 'properties'
                  );
                } else if (item.tab) {
                  setActiveSidebarTab(item.tab);
                  setMobileSheetMode('tools');
                }
              }}
              className={`min-h-[44px] flex flex-col items-center justify-center rounded-lg text-[10px] font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'text-sky-400 bg-slate-800/80'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.icon}
              <span className="mt-0.5 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Bottom-Sheet Drawer for Tools & Properties (<lg screens) */}
      {mobileSheetMode !== 'none' && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex flex-col justify-end"
          onClick={() => setMobileSheetMode('none')}
        >
          <div
            className="bg-[#0F172A] border-t border-slate-700 rounded-t-3xl max-h-[72vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grab Handle & Sheet Header */}
            <div className="pt-2.5 pb-2 px-4 border-b border-slate-800 flex items-center justify-between">
              <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto" />
              <button
                type="button"
                onClick={() => setMobileSheetMode('none')}
                aria-label="Close mobile drawer"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {mobileSheetMode === 'tools' ? (
              <>
                {/* Horizontal Switcher for All 10 Tool Tabs */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-800 overflow-x-auto bg-[#0B0F17]">
                  {SIDEBAR_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveSidebarTab(tab.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                        activeSidebarTab === tab.id
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-400 bg-slate-900 hover:text-white'
                      }`}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
                <SidebarToolContent />
              </>
            ) : (
              <InspectorContent />
            )}
          </div>
        </div>
      )}

      {/* Lazy-Loaded Modals (mounted only when requested) */}
      {isExportDialogOpen && (
        <LazyExportDialog mediaElementsRef={mediaElementsRef} />
      )}
      {isArchitectureDrawerOpen && <LazyArchitectureDrawer />}
      {isSettingsDialogOpen && <LazySettingsDialog />}
      {isSecurityDialogOpen && <LazySecurityAuditDialog />}
    </div>
  );
}
