'use client';

import React from 'react';
import Link from 'next/link';
import {
  Undo2,
  Redo2,
  Save,
  Check,
  AlertTriangle,
  Settings,
  Cpu,
  Home,
  LayoutGrid,
  ShieldCheck,
} from 'lucide-react';
import { ActiveSidebarTab, useEditorStore } from '@/store/use-editor-store';
import { ALL_INDEXABLE_PAGES } from '@/lib/seo/registry';
import { Button } from '@/components/ui/button';

export function TopBar() {
  const activeSidebarTab = useEditorStore((s) => s.activeSidebarTab);
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);
  const setExportDialogOpen = useEditorStore((s) => s.setExportDialogOpen);
  const setArchitectureDrawerOpen = useEditorStore(
    (s) => s.setArchitectureDrawerOpen
  );
  const setSettingsDialogOpen = useEditorStore((s) => s.setSettingsDialogOpen);
  const setSecurityDialogOpen = useEditorStore((s) => s.setSecurityDialogOpen);

  const projectName = useEditorStore((s) => s.projectName);
  const setProjectName = useEditorStore((s) => s.setProjectName);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const hasUnsavedChanges = useEditorStore((s) => s.hasUnsavedChanges);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const saveError = useEditorStore((s) => s.saveError);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const saveCurrentProject = useEditorStore((s) => s.saveCurrentProject);

  const handleQuickSave = async () => {
    await saveCurrentProject();
  };

  const navItems: { label: string; tab?: ActiveSidebarTab; action?: () => void }[] = [
    { label: 'Media Library', tab: 'media' },
    { label: 'Subtitles', tab: 'subtitles' },
    { label: 'Effects', tab: 'effects' },
    { label: 'Crop & Resize', tab: 'crop' },
    { label: 'Projects', tab: 'projects' },
  ];

  return (
    <div className="shrink-0 bg-[#0B0F17] border-b border-slate-800/90">
      {/* Row 1: Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-4 sm:px-6 h-13 border-b border-slate-800/60">
        {/* Zone 1: Single text element wordmark linking to Homepage */}
        <Link
          href="/"
          className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-sky-300 transition-colors"
        >
          FrameForge Studio
        </Link>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav
          aria-label="Primary workspace navigation"
          className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400"
        >
          {navItems.map((item) => {
            const isActive = item.tab && activeSidebarTab === item.tab;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (item.tab) setActiveSidebarTab(item.tab);
                  if (item.action) item.action();
                }}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer underline-offset-8 hover:text-white hover:underline ${
                  isActive ? 'text-sky-400 underline decoration-sky-400' : ''
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <Button
            type="button"
            onClick={() => setExportDialogOpen(true)}
            data-testid="open-export-button"
          >
            Export Video
          </Button>
        </div>
      </header>

      {/* Row 2: Project Command Sub-Bar (Project Name, Save Status, Home & Categories, Undo/Redo, Settings) */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-10 bg-[#0F172A]/85 text-xs border-b border-slate-800/60">
        {/* Left: Home Link, Editable Project Title & Save Status */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0"
            title="Go to Homepage & All Categories"
          >
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Homepage</span>
          </Link>

          <Link
            href="/#all-categories"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap shrink-0"
            title="Browse All Tool Categories"
          >
            <LayoutGrid className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">All Categories</span>
          </Link>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          <label htmlFor="top-project-name" className="sr-only">
            Project Name
          </label>
          <input
            id="top-project-name"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            aria-label="Project Name"
            data-testid="top-project-name-input"
            className="bg-transparent hover:bg-slate-800/70 focus:bg-slate-900 border border-transparent focus:border-sky-500/70 rounded px-2 py-1 text-xs font-medium text-slate-100 truncate max-w-[150px] sm:max-w-[220px] focus:outline-none transition-colors"
          />

          <button
            type="button"
            onClick={() => void handleQuickSave()}
            title={
              saveError
                ? `Save failed: ${saveError}. Click to retry.`
                : 'Save project snapshot to local IndexedDB'
            }
            data-testid="top-save-status-btn"
            data-save-status={saveStatus}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {saveStatus === 'saving' ? (
              <>
                <Save className="h-3.5 w-3.5 text-sky-400 animate-pulse" />
                <span className="text-sky-300">Saving locally...</span>
              </>
            ) : saveStatus === 'failed' ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                <span className="text-rose-300">
                  Save failed · Click to retry
                </span>
              </>
            ) : hasUnsavedChanges ? (
              <>
                <Save className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-amber-300">
                  Unsaved edits · Click to save
                </span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-300">
                  {lastSavedAt ? 'Saved to IndexedDB' : 'Local Workspace Ready'}
                </span>
              </>
            )}
          </button>
        </div>

        {/* Right: Undo / Redo, Architecture & Settings Menu */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={undoStack.length === 0}
            onClick={undo}
            title="Undo (Ctrl+Z)"
            data-testid="top-undo-btn"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Undo</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={redoStack.length === 0}
            onClick={redo}
            title="Redo (Ctrl+Y)"
            data-testid="top-redo-btn"
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Redo</span>
          </Button>

          <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSecurityDialogOpen(true)}
            title="Application Security & Recovery Center"
            data-testid="open-security-dialog-btn"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden md:inline">Security &amp; Recovery</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setArchitectureDrawerOpen(true)}
            title="Inspect System Architecture"
            className="hidden lg:inline-flex"
          >
            <Cpu className="h-3.5 w-3.5 text-sky-400" />
            <span>Architecture</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSettingsDialogOpen(true)}
            title="Settings & Browser Limits"
            data-testid="open-settings-button"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
        </div>
      </div>

      {/* Row 3: Compact All Categories & Tools Navigation Strip */}
      <nav
        aria-label="All categories and tools strip"
        className="flex items-center gap-3 px-4 sm:px-6 h-8 bg-[#080B11] overflow-x-auto text-[11px] text-slate-400"
      >
        <span className="font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap shrink-0">
          Categories:
        </span>
        {ALL_INDEXABLE_PAGES.map((page) => (
          <Link
            key={page.path}
            href={page.path}
            className="whitespace-nowrap shrink-0 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
          >
            {page.path === '/' ? 'Homepage' : page.navLabel}
          </Link>
        ))}
      </nav>
    </div>
  );
}
