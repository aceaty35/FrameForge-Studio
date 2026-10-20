'use client';

import React, { useState } from 'react';
import { ShieldCheck, Cpu, HardDrive, Keyboard, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/store/use-editor-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function SettingsDialog() {
  const isOpen = useEditorStore((s) => s.isSettingsDialogOpen);
  const setOpen = useEditorStore((s) => s.setSettingsDialogOpen);
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useEditorStore((s) => s.setAutoSaveEnabled);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const rippleDeleteEnabled = useEditorStore((s) => s.rippleDeleteEnabled);
  const toggleRippleDelete = useEditorStore((s) => s.toggleRippleDelete);
  const showSafeGuides = useEditorStore((s) => s.showSafeGuides);
  const toggleSafeGuides = useEditorStore((s) => s.toggleSafeGuides);
  const clearAllLocalData = useEditorStore((s) => s.clearAllLocalData);

  const [confirmPurge, setConfirmPurge] = useState(false);

  const hasSharedArrayBuffer =
    typeof window !== 'undefined' && typeof SharedArrayBuffer !== 'undefined';

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>Workspace Settings & Browser Capabilities</DialogTitle>
          <DialogDescription>
            Configure editor preferences, keyboard shortcuts, and inspect local
            browser media boundaries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-xs">
          {/* Preferences */}
          <div className="space-y-2.5">
            <h3 className="font-semibold text-slate-200">Editor Preferences</h3>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800">
              <div>
                <div className="font-medium text-white">
                  Auto-Save Project to IndexedDB
                </div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Automatically persist timeline changes and warn before tab close.
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant={autoSaveEnabled ? 'default' : 'secondary'}
                onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
              >
                {autoSaveEnabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={toggleSnap}
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  snapEnabled
                    ? 'border-sky-500/60 bg-sky-500/10 text-white'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                <div className="font-semibold">Magnetic Snap</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {snapEnabled ? 'Active (150ms)' : 'Off'}
                </div>
              </button>

              <button
                type="button"
                onClick={toggleRippleDelete}
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  rippleDeleteEnabled
                    ? 'border-sky-500/60 bg-sky-500/10 text-white'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                <div className="font-semibold">Ripple Delete</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {rippleDeleteEnabled ? 'Auto-close gaps' : 'Keep gaps'}
                </div>
              </button>

              <button
                type="button"
                onClick={toggleSafeGuides}
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  showSafeGuides
                    ? 'border-sky-500/60 bg-sky-500/10 text-white'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                <div className="font-semibold">Safe Guides</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {showSafeGuides ? '90% / 80% Grid' : 'Hidden'}
                </div>
              </button>
            </div>
          </div>

          {/* Browser Limitations & Hardware Transparency */}
          <div className="space-y-2.5 pt-2 border-t border-slate-800">
            <h3 className="font-semibold text-slate-200">
              Browser Capabilities & Memory Boundaries
            </h3>
            <div className="space-y-2 text-slate-300">
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-white">
                    100% Local Zero-Upload Privacy
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Media files never leave your device. Object URLs and IndexedDB
                    blobs execute strictly within your browser sandbox.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                <HardDrive className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-white">
                    Browser Tab Memory Limits (Recommended &lt; 500 MB)
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Browsers cap per-tab WebAssembly and Blob heap memory (~2 GB–4 GB).
                    Files over 80 MB automatically use lightweight waveform sampling
                    to prevent tab out-of-memory crashes.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                <Cpu className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-white">
                    Transcode Pipeline ({hasSharedArrayBuffer ? 'Multi-Threaded Wasm Ready' : 'Single-Thread Wasm + Native MediaRecorder'})
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    When Cross-Origin Isolation headers (COOP/COEP) are restricted by
                    an iframe, FrameForge automatically falls back to native HTML5
                    Canvas Stream + VP9 MediaRecorder encoding.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <h3 className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Keyboard className="h-3.5 w-3.5 text-sky-400" />
              <span>Keyboard Shortcuts</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400">Play / Pause</span>
                <span className="text-white">Space</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400">Split at Playhead</span>
                <span className="text-white">S</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400">Delete Selected</span>
                <span className="text-white">Delete / Backspace</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400">Undo / Redo</span>
                <span className="text-white">Ctrl+Z / Ctrl+Y</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400">Save Snapshot</span>
                <span className="text-white">Ctrl+S / Cmd+S</span>
              </div>
            </div>
          </div>

          {/* Clear Local Project Data */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <h3 className="font-semibold text-slate-200">
              Local Project Data &amp; Storage Reset
            </h3>
            <p className="text-[11px] text-slate-400">
              Browser storage (IndexedDB) is non-permanent and subject to browser
              eviction policies. You can permanently delete all locally stored
              project metadata and cached media blobs at any time.
            </p>
            {!confirmPurge ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                onClick={() => setConfirmPurge(true)}
                data-testid="settings-delete-local-data-btn"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Local Project Data</span>
              </Button>
            ) : (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-rose-500/50 bg-rose-950/40">
                <span className="text-rose-200 text-[11px]">
                  Confirm deleting all saved projects and cached media blobs?
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      void clearAllLocalData();
                      setConfirmPurge(false);
                    }}
                    data-testid="settings-confirm-delete-local-data-btn"
                  >
                    Confirm Delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmPurge(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
