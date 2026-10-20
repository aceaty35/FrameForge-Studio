'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  Film,
  Type,
  Music,
  Subtitles,
  Sparkles,
  Sliders,
  Crop,
  Gauge,
  Download,
  FolderKanban,
  Upload,
  Plus,
  Trash2,
  Image as ImageIcon,
  Search,
  Save,
  RotateCcw,
  FilePlus2,
  Volume2,
  VolumeX,
  Wand2,
  XCircle,
  AlertTriangle,
  HardDrive,
  Copy,
  Pencil,
  Check,
  Link2,
} from 'lucide-react';
import { ActiveSidebarTab, useEditorStore } from '@/store/use-editor-store';
import {
  ASPECT_RATIO_PRESETS,
  AspectRatioPreset,
  DEFAULT_CROP_SETTINGS,
  DEFAULT_VIDEO_FILTERS,
  DuplicatePolicy,
  ExportFormat,
  ExportResolution,
  MediaAsset,
  MediaImportError,
  MediaImportProgress,
  MediaType,
  StorageQuotaEstimate,
  TransitionType,
  VideoFilterState,
} from '@/types/editor';
import {
  createProceduralSampleAsset,
  defaultMediaManager,
} from '@/lib/media/manager';
import { getStorageQuotaEstimate } from '@/lib/persistence/db';
import {
  calculateProjectDuration,
  formatTimecode,
} from '@/lib/timeline/engine';
import { estimateExportFileSizeBytes, sanitizeSafeFilename } from '@/lib/export/exporter';
import {
  detectSubtitleOverlaps,
  FONT_FAMILY_OPTIONS,
  getTextAndSubtitleCapabilities,
  parseSrtSubtitles,
  serializeSubtitlesToSrt,
  SubtitleValidationIssue,
  TEXT_ANIMATION_OPTIONS,
} from '@/lib/subtitles/text-and-subtitles';
import { TextAnimationPreset } from '@/types/editor';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export const SIDEBAR_TABS: {
  id: ActiveSidebarTab;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: 'media', label: 'Media', icon: <Film className="h-4 w-4" /> },
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" /> },
  { id: 'audio', label: 'Audio', icon: <Music className="h-4 w-4" /> },
  { id: 'subtitles', label: 'Subtitles', icon: <Subtitles className="h-4 w-4" /> },
  { id: 'transitions', label: 'Transitions', icon: <Wand2 className="h-4 w-4" /> },
  { id: 'effects', label: 'Effects', icon: <Sliders className="h-4 w-4" /> },
  { id: 'crop', label: 'Crop', icon: <Crop className="h-4 w-4" /> },
  { id: 'speed', label: 'Speed', icon: <Gauge className="h-4 w-4" /> },
  { id: 'export', label: 'Export', icon: <Download className="h-4 w-4" /> },
  { id: 'projects', label: 'Projects', icon: <FolderKanban className="h-4 w-4" /> },
];

/**
 * Lazy on-demand thumbnail observer component so video thumbnails are generated
 * only when the media card is visible in the viewport.
 */
function LazyMediaThumbnail({
  asset,
  onThumbnailReady,
}: {
  asset: MediaAsset;
  onThumbnailReady: (id: string, url: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      asset.thumbnailUrl ||
      !asset.objectUrl ||
      asset.type === 'audio' ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          void defaultMediaManager
            .generateThumbnailOnDemand(asset)
            .then((url) => {
              if (!cancelled && url) {
                onThumbnailReady(asset.id, url);
              }
            })
            .catch(() => undefined);
        }
      },
      { rootMargin: '80px' }
    );

    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [asset, onThumbnailReady]);

  return (
    <div
      ref={containerRef}
      className="w-14 h-10 rounded bg-slate-950 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative"
    >
      {asset.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbnailUrl}
          alt={asset.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      ) : asset.type === 'audio' ? (
        <Music className="h-4 w-4 text-emerald-400" />
      ) : asset.type === 'image' ? (
        <ImageIcon className="h-4 w-4 text-sky-400" />
      ) : (
        <Film className="h-4 w-4 text-sky-400" />
      )}
    </div>
  );
}

export function SidebarToolContent() {
  const activeTab = useEditorStore((s) => s.activeSidebarTab);
  const assets = useEditorStore((s) => s.assets);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const addTrack = useEditorStore((s) => s.addTrack);
  const addAsset = useEditorStore((s) => s.addAsset);
  const updateAssetThumbnail = useEditorStore((s) => s.updateAssetThumbnail);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const clearAllMediaAssets = useEditorStore((s) => s.clearAllMediaAssets);
  const appendAssetToTimeline = useEditorStore((s) => s.appendAssetToTimeline);
  const addTextOverlayClip = useEditorStore((s) => s.addTextOverlayClip);
  const addImageOverlayClip = useEditorStore((s) => s.addImageOverlayClip);
  const addBackgroundAudioClip = useEditorStore((s) => s.addBackgroundAudioClip);
  const importSubtitlesBatch = useEditorStore((s) => s.importSubtitlesBatch);
  const resolveOverlapsOnTrack = useEditorStore((s) => s.resolveOverlapsOnTrack);
  const aspectRatio = useEditorStore((s) => s.aspectRatio);
  const setAspectRatio = useEditorStore((s) => s.setAspectRatio);
  const canvasBackground = useEditorStore((s) => s.canvasBackground);
  const setCanvasBackground = useEditorStore((s) => s.setCanvasBackground);
  const showSafeGuides = useEditorStore((s) => s.showSafeGuides);
  const toggleSafeGuides = useEditorStore((s) => s.toggleSafeGuides);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const setPlayheadTime = useEditorStore((s) => s.setPlayheadTime);
  const updateClip = useEditorStore((s) => s.updateClip);
  const setClipTiming = useEditorStore((s) => s.setClipTiming);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const setClipAudioFades = useEditorStore((s) => s.setClipAudioFades);
  const applyClipTransition = useEditorStore((s) => s.applyClipTransition);
  const updateClipFilters = useEditorStore((s) => s.updateClipFilters);
  const resetClipFilters = useEditorStore((s) => s.resetClipFilters);
  const updateClipTransform = useEditorStore((s) => s.updateClipTransform);
  const updateClipCrop = useEditorStore((s) => s.updateClipCrop);
  const resetClipCrop = useEditorStore((s) => s.resetClipCrop);
  const updateClipTextStyle = useEditorStore((s) => s.updateClipTextStyle);
  const masterMuted = useEditorStore((s) => s.masterMuted);
  const setMasterMuted = useEditorStore((s) => s.setMasterMuted);
  const exportSettings = useEditorStore((s) => s.exportSettings);
  const updateExportSettings = useEditorStore((s) => s.updateExportSettings);
  const setExportDialogOpen = useEditorStore((s) => s.setExportDialogOpen);
  const projectId = useEditorStore((s) => s.projectId);
  const projectName = useEditorStore((s) => s.projectName);
  const schemaVersion = useEditorStore((s) => s.schemaVersion);
  const setProjectName = useEditorStore((s) => s.setProjectName);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const saveError = useEditorStore((s) => s.saveError);
  const hasUnsavedChanges = useEditorStore((s) => s.hasUnsavedChanges);
  const persistenceNotice = useEditorStore((s) => s.persistenceNotice);
  const setPersistenceNotice = useEditorStore((s) => s.setPersistenceNotice);
  const saveCurrentProject = useEditorStore((s) => s.saveCurrentProject);
  const savedProjects = useEditorStore((s) => s.savedProjects);
  const refreshSavedProjects = useEditorStore((s) => s.refreshSavedProjects);
  const loadSavedProject = useEditorStore((s) => s.loadSavedProject);
  const renameProject = useEditorStore((s) => s.renameProject);
  const duplicateProject = useEditorStore((s) => s.duplicateProject);
  const deleteSavedProject = useEditorStore((s) => s.deleteSavedProject);
  const clearAllLocalData = useEditorStore((s) => s.clearAllLocalData);
  const relinkMissingMediaAsset = useEditorStore(
    (s) => s.relinkMissingMediaAsset
  );
  const createNewBlankProject = useEditorStore((s) => s.createNewBlankProject);
  const resetToDemoProject = useEditorStore((s) => s.resetToDemoProject);
  const setErrorBanner = useEditorStore((s) => s.setErrorBanner);
  const reportFailureIncident = useEditorStore((s) => s.reportFailureIncident);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const srtFileInputRef = useRef<HTMLInputElement | null>(null);
  const relinkFileInputRef = useRef<HTMLInputElement | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  const [isIngesting, setIsIngesting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>('skip');
  const [importProgress, setImportProgress] =
    useState<MediaImportProgress | null>(null);
  const [importErrors, setImportErrors] = useState<MediaImportError[]>([]);
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const [quotaEstimate, setQuotaEstimate] =
    useState<StorageQuotaEstimate | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<'all' | MediaType>('all');
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<
    string | null
  >(null);
  const [confirmClearAllData, setConfirmClearAllData] = useState(false);
  const [relinkingAssetId, setRelinkingAssetId] = useState<string | null>(null);
  const [srtImportNotice, setSrtImportNotice] = useState<string | null>(null);
  const [srtImportErrors, setSrtImportErrors] = useState<
    SubtitleValidationIssue[]
  >([]);

  useEffect(() => {
    void refreshSavedProjects();
    void getStorageQuotaEstimate().then((est) => setQuotaEstimate(est));
  }, [refreshSavedProjects, assets.length]);

  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  );

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      const matchesType = mediaFilter === 'all' || a.type === mediaFilter;
      const matchesQuery =
        !searchQuery.trim() ||
        a.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesType && matchesQuery;
    });
  }, [assets, mediaFilter, searchQuery]);

  const subtitleClips = useMemo(
    () =>
      clips
        .filter((c) => c.trackType === 'text')
        .sort((a, b) => a.startTime - b.startTime || a.duration - b.duration),
    [clips]
  );

  const subtitleOverlaps = useMemo(() => {
    const entries = subtitleClips.map((c, idx) => ({
      id: c.id,
      index: idx + 1,
      startTime: c.startTime,
      endTime: c.startTime + c.duration,
      text: c.textStyle?.text || c.label,
    }));
    return detectSubtitleOverlaps(entries);
  }, [subtitleClips]);

  const handleSrtFileSelected = async (file: File | null) => {
    if (!file) return;
    setSrtImportNotice(null);
    setSrtImportErrors([]);
    try {
      const rawText = await file.text();
      const parsed = parseSrtSubtitles(rawText);
      if (parsed.errors.length > 0) {
        setSrtImportErrors(parsed.errors);
      }
      if (parsed.entries.length > 0) {
        importSubtitlesBatch(
          parsed.entries.map((entry) => ({
            startTime: entry.startTime,
            duration: Math.max(0.2, entry.endTime - entry.startTime),
            text: entry.text,
          }))
        );
        setSrtImportNotice(
          `Imported ${parsed.entries.length} subtitle cue(s) from "${file.name}".`
        );
      } else if (parsed.errors.length === 0) {
        setSrtImportNotice('No valid subtitle cues found in the selected .srt file.');
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to read .srt subtitle file.'
      );
    } finally {
      if (srtFileInputRef.current) {
        srtFileInputRef.current.value = '';
      }
    }
  };

  const handleExportSrtFile = () => {
    const srtText = serializeSubtitlesToSrt(clips);
    if (!srtText) return;
    const blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeSafeFilename(projectName, 'subtitles')}.srt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleFilesSelected = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    const controller = new AbortController();
    importAbortRef.current = controller;

    setIsIngesting(true);
    setImportErrors([]);
    setImportNotices([]);
    setErrorBanner(null);

    try {
      const batchResult = await defaultMediaManager.importFiles(files, {
        existingAssets: assets,
        duplicatePolicy,
        generateThumbnails: true,
        signal: controller.signal,
        onProgress: (prog) => setImportProgress(prog),
      });

      for (const asset of batchResult.imported) {
        addAsset(asset, true);
      }

      const notices: string[] = [];
      if (batchResult.duplicatesSkipped.length > 0) {
        notices.push(
          `Skipped ${batchResult.duplicatesSkipped.length} duplicate file(s): ${batchResult.duplicatesSkipped.join(', ')}`
        );
      }
      if (batchResult.storageWarnings.length > 0) {
        notices.push(...batchResult.storageWarnings);
      }
      if (batchResult.cancelled) {
        notices.push('Media import cancelled by user.');
      }

      setImportNotices(notices);
      setImportErrors(batchResult.errors);

      if (batchResult.errors.length > 0) {
        const firstErr = batchResult.errors[0];
        const explicitCategory =
          firstErr.code === 'UNSUPPORTED_TYPE' || firstErr.code === 'EMPTY_FILE'
            ? 'UNSUPPORTED_MEDIA'
            : firstErr.code === 'FILE_TOO_LARGE'
              ? 'OUT_OF_MEMORY'
              : firstErr.code === 'ABORTED'
                ? 'INTERRUPTED_PROCESSING'
                : 'CORRUPTED_FILE';
        reportFailureIncident(firstErr.message, explicitCategory);
      } else if (batchResult.storageWarnings.length > 0) {
        reportFailureIncident(
          batchResult.storageWarnings[0],
          'INSUFFICIENT_STORAGE'
        );
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Could not import media files.'
      );
    } finally {
      setIsIngesting(false);
      setImportProgress(null);
      importAbortRef.current = null;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCancelImport = () => {
    importAbortRef.current?.abort();
  };

  const handleGenerateSample = async (
    preset: 'studio-countdown' | 'kinetic-broll' | 'ambient-synth-audio'
  ) => {
    setIsIngesting(true);
    setErrorBanner(null);
    try {
      const sample = await createProceduralSampleAsset(preset);
      addAsset(sample, true);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to generate sample clip'
      );
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSaveProject = async () => {
    const ok = await saveCurrentProject();
    if (ok) {
      setSaveMessage('Project snapshot saved to browser IndexedDB');
      window.setTimeout(() => setSaveMessage(null), 2500);
    }
  };

  const handleRelinkFileChange = async (file: File | null) => {
    if (!file || !relinkingAssetId) return;
    await relinkMissingMediaAsset(relinkingAssetId, file);
    setRelinkingAssetId(null);
    if (relinkFileInputRef.current) {
      relinkFileInputRef.current.value = '';
    }
  };

  const colorLooks: { name: string; desc: string; filters: VideoFilterState }[] = [
    {
      name: 'Rec.709 Neutral',
      desc: 'Unmodified broadcast reference grade',
      filters: { ...DEFAULT_VIDEO_FILTERS },
    },
    {
      name: 'Studio Crisp',
      desc: 'Contrast 118% · Saturation 114%',
      filters: { ...DEFAULT_VIDEO_FILTERS, contrast: 118, saturation: 114 },
    },
    {
      name: 'Editorial Warmth',
      desc: 'Brightness 104% · Sepia 22% · Saturation 110%',
      filters: {
        ...DEFAULT_VIDEO_FILTERS,
        brightness: 104,
        sepia: 22,
        saturation: 110,
      },
    },
    {
      name: 'Silver Monochrome',
      desc: 'Saturation 0% · Contrast 125%',
      filters: { ...DEFAULT_VIDEO_FILTERS, saturation: 0, contrast: 125 },
    },
    {
      name: 'Cool Anamorphic',
      desc: 'Hue -12° · Contrast 112% · Saturation 92%',
      filters: {
        ...DEFAULT_VIDEO_FILTERS,
        hueRotate: -12,
        contrast: 112,
        saturation: 92,
      },
    },
  ];

  const totalSeqDuration = Math.max(1, calculateProjectDuration(clips));
  const estimatedBytes = estimateExportFileSizeBytes(
    totalSeqDuration,
    exportSettings
  );
  const estimatedMb = (estimatedBytes / (1024 * 1024)).toFixed(2);

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-4 space-y-5">
      {/* 1. MEDIA LIBRARY TAB */}
      {activeTab === 'media' && (
        <>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Media Library</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Processed locally via File &amp; Object URLs. Zero server uploads.
              </p>
            </div>
          </div>

          {/* Drag and Drop Upload Box */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              void handleFilesSelected(e.dataTransfer.files);
            }}
            data-testid="media-dropzone"
            className={`border border-dashed rounded-xl p-3.5 text-center transition-colors ${
              isDragOver
                ? 'border-sky-400 bg-sky-500/10'
                : 'border-slate-700 bg-slate-900/50 hover:border-sky-500/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/mp4,video/webm,video/quicktime,video/ogg,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => void handleFilesSelected(e.target.files)}
              className="hidden"
              data-testid="media-file-input"
            />
            <Upload className="h-5 w-5 text-sky-400 mx-auto mb-1.5" />
            <p className="text-xs font-medium text-slate-200">
              Drop video, audio, or image files
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              MP4 · WebM · MOV · WAV · MP3 · PNG · JPG (Max 500 MB)
            </p>

            <div className="mt-2.5 flex items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isIngesting}
                onClick={() => fileInputRef.current?.click()}
                data-testid="browse-media-btn"
                className="flex-1"
              >
                {isIngesting ? 'Importing...' : 'Select Files'}
              </Button>
              {isIngesting && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelImport}
                  data-testid="cancel-import-btn"
                >
                  Cancel
                </Button>
              )}
            </div>

            {/* Duplicate Handling Toggle */}
            <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>Duplicate Files:</span>
              <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setDuplicatePolicy('skip')}
                  data-testid="duplicate-policy-skip"
                  className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${
                    duplicatePolicy === 'skip'
                      ? 'bg-slate-800 text-sky-400 font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicatePolicy('allow')}
                  data-testid="duplicate-policy-allow"
                  className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${
                    duplicatePolicy === 'allow'
                      ? 'bg-slate-800 text-sky-400 font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Allow
                </button>
              </div>
            </div>
          </div>

          {/* Active Multi-File Import Progress & Cancellation Status */}
          {importProgress && (
            <div
              className="p-2.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs space-y-1.5"
              data-testid="media-import-progress"
            >
              <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-sky-300">
                <span className="truncate max-w-[180px]">
                  {importProgress.currentFileName}
                </span>
                <span>
                  {importProgress.completedFiles + 1}/{importProgress.totalFiles}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 capitalize">
                Stage: {importProgress.stage}...
              </div>
            </div>
          )}

          {/* Per-File Validation / Metadata Errors */}
          {importErrors.length > 0 && (
            <div
              role="alert"
              data-testid="media-import-errors"
              className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 space-y-1.5 text-xs text-rose-200"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  <span>Import Validation Issue ({importErrors.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setImportErrors([])}
                  className="text-[11px] underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <ul className="space-y-1 text-[11px] text-rose-300/90">
                {importErrors.map((err, i) => (
                  <li key={i}>{err.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Duplicate & Local Storage Quota Warnings */}
          {importNotices.length > 0 && (
            <div
              role="status"
              data-testid="media-import-notices"
              className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-1 text-xs text-amber-200"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>Import Notice</span>
                </span>
                <button
                  type="button"
                  onClick={() => setImportNotices([])}
                  className="text-[11px] underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
              {importNotices.map((notice, idx) => (
                <p key={idx} className="text-[11px] text-amber-300/90">
                  {notice}
                </p>
              ))}
            </div>
          )}

          {/* Instant Procedural Sample Generators */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-slate-400">
              Quick Sample Generators
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isIngesting}
                onClick={() => void handleGenerateSample('studio-countdown')}
                data-testid="generate-sample-video-btn"
              >
                <Plus className="h-3.5 w-3.5 text-sky-400" />
                <span>Calibration Reel</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isIngesting}
                onClick={() => void handleGenerateSample('ambient-synth-audio')}
                data-testid="generate-sample-audio-btn"
              >
                <Music className="h-3.5 w-3.5 text-emerald-400" />
                <span>Synth Audio</span>
              </Button>
            </div>
          </div>

          {/* Search & Type Filter */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search media by filename..."
                aria-label="Search media library"
                data-testid="media-search-input"
                className="w-full rounded-lg border border-slate-800 bg-slate-900/90 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
              {(['all', 'video', 'audio', 'image'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMediaFilter(type)}
                  className={`py-1 text-[11px] font-medium capitalize rounded transition-colors cursor-pointer ${
                    mediaFilter === type
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Loading Skeleton State */}
          {isIngesting && (
            <div
              className="space-y-2"
              aria-live="polite"
              data-testid="media-loading-skeleton"
            >
              <div className="h-14 rounded-lg bg-slate-800/60 animate-pulse border border-slate-800" />
            </div>
          )}

          {/* Media Asset Cards with Lazy Thumbnails & Remove Action */}
          <div className="space-y-2">
            {filteredAssets.length === 0 ? (
              <div className="py-6 px-3 text-center rounded-lg border border-slate-800/60 bg-slate-900/30 space-y-2">
                <p className="text-xs text-slate-400">
                  {assets.length === 0
                    ? 'Your media bin is empty. Upload a file or generate a sample clip.'
                    : `No media matching "${searchQuery}" in ${mediaFilter}.`}
                </p>
                {assets.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('');
                      setMediaFilter('all');
                    }}
                  >
                    Clear Filter
                  </Button>
                )}
              </div>
            ) : (
              filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/x-frameforge-asset',
                      asset.id
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  data-testid={`media-asset-card-${asset.id}`}
                  className="flex items-center justify-between gap-2.5 p-2 rounded-lg border border-slate-800 bg-slate-900/75 hover:border-slate-700 transition-colors cursor-grab active:cursor-grabbing"
                >
                  {/* Lazy Thumbnail Preview */}
                  <LazyMediaThumbnail
                    asset={asset}
                    onThumbnailReady={updateAssetThumbnail}
                  />

                  {/* Metadata */}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-100 truncate">
                      {asset.name}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                      <span>{formatTimecode(asset.duration)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {asset.width && asset.height
                          ? `${asset.width}×${asset.height}`
                          : asset.type}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {asset.type !== 'audio' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Add as Picture-in-Picture Image/Video Overlay"
                        onClick={() => addImageOverlayClip(asset.id)}
                        data-testid={`overlay-asset-${asset.id}`}
                      >
                        <ImageIcon className="h-3.5 w-3.5 text-teal-400" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      title={
                        asset.type === 'audio'
                          ? 'Add as Background Audio Track'
                          : 'Add clip to timeline'
                      }
                      onClick={() =>
                        asset.type === 'audio'
                          ? addBackgroundAudioClip(asset.id)
                          : appendAssetToTimeline(asset.id)
                      }
                      data-testid={`append-asset-${asset.id}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Remove media and revoke local Object URL"
                      onClick={() => removeAsset(asset.id)}
                      data-testid={`remove-asset-${asset.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-rose-400" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Local Storage Quota & Purge Action Footer */}
          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            {quotaEstimate && (
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="h-3 w-3 text-sky-400" />
                  <span>Local Cache</span>
                </span>
                <span>
                  {(quotaEstimate.usageBytes / (1024 * 1024)).toFixed(1)} MB used
                </span>
              </div>
            )}

            {assets.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAllMediaAssets}
                data-testid="purge-all-media-btn"
                className="w-full text-rose-300 hover:text-rose-200 border-slate-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove All Media &amp; Revoke URLs</span>
              </Button>
            )}
          </div>
        </>
      )}

      {/* 2. TEXT TAB */}
      {activeTab === 'text' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Text &amp; Multi-Layer Titles
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Insert graphic typography layers, animate titles, and drag directly
                on the preview canvas.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addTrack('text')}
              title="Add a new independent Text / Title track layer"
              data-testid="add-text-layer-track-btn"
              className="shrink-0 text-[11px]"
            >
              <Plus className="h-3.5 w-3.5 text-sky-400" />
              <span>
                + Layer ({tracks.filter((t) => t.type === 'text').length})
              </span>
            </Button>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              className="w-full justify-start"
              onClick={() =>
                addTextOverlayClip('HEADLINE TITLE OVERLAY', false, {
                  fontSize: 64,
                  fontWeight: 700,
                  animation: 'slide-up',
                  y: 0.48,
                })
              }
              data-testid="add-headline-text-btn"
            >
              <Plus className="h-4 w-4" />
              <span>Add Bold Headline Title (Slide Up)</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              onClick={() =>
                addTextOverlayClip('Lower-third speaker identification', true, {
                  fontSize: 42,
                  fontWeight: 600,
                  animation: 'fade-in-out',
                  y: 0.84,
                })
              }
              data-testid="add-subtitle-text-btn"
            >
              <Plus className="h-4 w-4 text-sky-400" />
              <span>Add Lower-Third Banner</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                addTextOverlayClip('CHAPTER 01 · INTRODUCTION', false, {
                  fontSize: 52,
                  fontWeight: 700,
                  animation: 'pop-in',
                  y: 0.25,
                })
              }
            >
              <Plus className="h-4 w-4 text-slate-400" />
              <span>Add Chapter Slate Card (Pop-In)</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                addTextOverlayClip(
                  'नमस्ते दुनिया · हिंदी और यूनिकोड शीर्षक',
                  false,
                  {
                    fontFamily:
                      '"Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", system-ui, sans-serif',
                    fontSize: 50,
                    fontWeight: 700,
                    animation: 'typewriter',
                    y: 0.65,
                  }
                )
              }
              data-testid="add-hindi-text-btn"
            >
              <Plus className="h-4 w-4 text-amber-400" />
              <span>Add Hindi / Unicode Title (नमस्ते)</span>
            </Button>
          </div>

          {selectedClip?.trackType === 'text' && selectedClip.textStyle && (
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  Active Text Clip Formatting
                </span>
                <span className="text-[10px] font-mono text-sky-400">
                  Drag on canvas
                </span>
              </div>

              <textarea
                rows={2}
                value={selectedClip.textStyle.text}
                onChange={(e) =>
                  updateClipTextStyle(selectedClip.id, { text: e.target.value })
                }
                data-testid="sidebar-text-content-input"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
              />

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 block">
                    Font Family
                  </label>
                  <select
                    value={selectedClip.textStyle.fontFamily}
                    onChange={(e) =>
                      updateClipTextStyle(selectedClip.id, {
                        fontFamily: e.target.value,
                      })
                    }
                    className="w-full h-8 rounded bg-slate-900 border border-slate-800 px-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                  >
                    {FONT_FAMILY_OPTIONS.map((f) => (
                      <option
                        key={f.id}
                        value={f.cssFamily}
                        className="bg-slate-900"
                      >
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 block">
                    Animation Preset
                  </label>
                  <select
                    value={selectedClip.textStyle.animation || 'fade-in-out'}
                    onChange={(e) =>
                      updateClipTextStyle(selectedClip.id, {
                        animation: e.target.value as TextAnimationPreset,
                      })
                    }
                    className="w-full h-8 rounded bg-slate-900 border border-slate-800 px-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                  >
                    {TEXT_ANIMATION_OPTIONS.map((a) => (
                      <option
                        key={a.id}
                        value={a.id}
                        className="bg-slate-900"
                      >
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Browser & Export Font Reproduction Notice */}
          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <div className="text-[11px] font-semibold text-slate-300">
              Font &amp; Script Reproduction Notes
            </div>
            {getTextAndSubtitleCapabilities().map((cap) => (
              <div
                key={cap.feature}
                className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 text-[11px] space-y-1"
              >
                <div className="font-medium text-slate-200">{cap.feature}</div>
                <p className="text-slate-400 leading-relaxed">
                  {cap.limitationNote}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. AUDIO TAB */}
      {activeTab === 'audio' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Audio &amp; Soundtrack
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Import voiceovers or music, inspect Web Worker waveforms, and balance
              mix levels.
            </p>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              disabled={isIngesting}
              onClick={() => void handleGenerateSample('ambient-synth-audio')}
            >
              <Music className="h-4 w-4 text-emerald-400" />
              <span>Generate Ambient Synth Chord Track (6.0s)</span>
            </Button>

            <Button
              type="button"
              variant={masterMuted ? 'destructive' : 'outline'}
              className="w-full justify-start"
              onClick={() => setMasterMuted(!masterMuted)}
            >
              {masterMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4 text-sky-400" />
              )}
              <span>
                {masterMuted
                  ? 'Master Output Muted (Click to Unmute)'
                  : 'Master Audio Output Active'}
              </span>
            </Button>
          </div>

          {selectedClip && selectedClip.trackType !== 'text' && (
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-white">
                Selected Clip Audio Envelope ({selectedClip.label})
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Clip Volume</span>
                  <span className="font-mono tabular-nums text-white">
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

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Fade In Duration</span>
                  <span className="font-mono tabular-nums text-white">
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
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Fade Out Duration</span>
                  <span className="font-mono tabular-nums text-white">
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
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. SUBTITLES TAB */}
      {activeTab === 'subtitles' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Timed Subtitles &amp; SRT Captions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Import or export .SRT subtitle files, validate timestamps, and edit
              multiline Unicode or Hindi cues.
            </p>
          </div>

          <input
            ref={srtFileInputRef}
            type="file"
            accept=".srt,text/plain"
            onChange={(e) =>
              void handleSrtFileSelected(e.target.files?.[0] ?? null)
            }
            className="hidden"
            data-testid="srt-file-input"
          />

          <div className="grid grid-cols-1 gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() =>
                addTextOverlayClip('Timed subtitle caption at playhead', true)
              }
              data-testid="add-timed-subtitle-btn"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Subtitle at Playhead</span>
            </Button>

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => srtFileInputRef.current?.click()}
                data-testid="import-srt-btn"
              >
                <Upload className="h-3.5 w-3.5 text-sky-400" />
                <span>Import .SRT</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={subtitleClips.length === 0}
                onClick={handleExportSrtFile}
                data-testid="export-srt-btn"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                <span>Export .SRT</span>
              </Button>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                importSubtitlesBatch([
                  {
                    startTime: 0.2,
                    duration: 2.5,
                    text: 'Welcome to FrameForge Studio — 100% browser-native editing.',
                  },
                  {
                    startTime: 3.0,
                    duration: 2.8,
                    text: 'नमस्ते दुनिया — 60 FPS पर ट्रिम और सबटाइटल संपादित करें।',
                  },
                  {
                    startTime: 6.0,
                    duration: 2.8,
                    text: 'Export locally via WebAssembly or MediaRecorder streams.',
                  },
                ])
              }
              data-testid="generate-batch-subtitles-btn"
            >
              <Sparkles className="h-3.5 w-3.5 text-sky-400" />
              <span>Insert 3 Timed Demo Subtitles (EN + HI)</span>
            </Button>
          </div>

          {/* SRT Import Notices & Validation Errors */}
          {srtImportNotice && (
            <div
              role="status"
              data-testid="srt-import-notice"
              className="p-2.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs text-sky-200 flex items-center justify-between gap-2"
            >
              <span>{srtImportNotice}</span>
              <button
                type="button"
                onClick={() => setSrtImportNotice(null)}
                className="text-[11px] underline cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {srtImportErrors.length > 0 && (
            <div
              role="alert"
              data-testid="srt-import-errors"
              className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200 space-y-1"
            >
              <div className="flex items-center justify-between font-semibold">
                <span>SRT Timestamp / Format Issues ({srtImportErrors.length})</span>
                <button
                  type="button"
                  onClick={() => setSrtImportErrors([])}
                  className="text-[11px] underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <ul className="space-y-0.5 text-[11px] text-rose-300">
                {srtImportErrors.map((err, i) => (
                  <li key={i}>{err.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Overlapping Subtitle Entries Warning Banner */}
          {subtitleOverlaps.length > 0 && (
            <div
              role="alert"
              data-testid="subtitle-overlap-warning"
              className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>
                    {subtitleOverlaps.length} Overlapping Subtitle Cue(s)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const textTrackIds = new Set(
                      subtitleClips.map((c) => c.trackId)
                    );
                    textTrackIds.forEach((tid) => resolveOverlapsOnTrack(tid));
                  }}
                  data-testid="resolve-subtitle-overlaps-btn"
                  className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-semibold text-[11px] hover:bg-amber-400 cursor-pointer shrink-0"
                >
                  Resolve Overlaps
                </button>
              </div>
              <p className="text-[11px] text-amber-300/90">
                Cue #{subtitleOverlaps[0].firstIndex} and Cue #
                {subtitleOverlaps[0].secondIndex} overlap by{' '}
                {subtitleOverlaps[0].overlapDuration.toFixed(2)}s.
              </p>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Subtitle Cue List ({subtitleClips.length})</span>
              <span className="text-[10px] font-mono text-slate-400">
                Sorted by Start Time
              </span>
            </div>

            {subtitleClips.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No subtitles on track yet. Add a subtitle or import an .SRT file
                above.
              </p>
            ) : (
              <div className="space-y-2">
                {subtitleClips.map((sub, idx) => (
                  <div
                    key={sub.id}
                    onClick={() => {
                      selectClip(sub.id);
                      setPlayheadTime(sub.startTime + 0.05);
                    }}
                    data-testid={`subtitle-cue-card-${idx}`}
                    className={`p-2.5 rounded-lg border transition-colors cursor-pointer space-y-2 ${
                      sub.id === selectedClipId
                        ? 'border-sky-500 bg-sky-500/10'
                        : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-sky-400">
                      <span>
                        #{idx + 1} · {formatTimecode(sub.startTime)} →{' '}
                        {formatTimecode(sub.startTime + sub.duration)}
                      </span>
                      <span>{sub.duration.toFixed(2)}s</span>
                    </div>

                    {/* Editable Start & End Time Inputs */}
                    <div
                      className="grid grid-cols-2 gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-400">
                        <span>In(s)</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={Number(sub.startTime.toFixed(2))}
                          onChange={(e) => {
                            const nextStart = Number(e.target.value);
                            const currEnd = sub.startTime + sub.duration;
                            if (Number.isFinite(nextStart) && nextStart >= 0) {
                              setClipTiming(
                                sub.id,
                                nextStart,
                                Math.max(nextStart + 0.2, currEnd)
                              );
                            }
                          }}
                          className="w-14 bg-transparent text-right text-white focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-400">
                        <span>Out(s)</span>
                        <input
                          type="number"
                          min={Number((sub.startTime + 0.2).toFixed(2))}
                          step={0.1}
                          value={Number(
                            (sub.startTime + sub.duration).toFixed(2)
                          )}
                          onChange={(e) => {
                            const nextEnd = Number(e.target.value);
                            if (Number.isFinite(nextEnd)) {
                              setClipTiming(sub.id, sub.startTime, nextEnd);
                            }
                          }}
                          className="w-14 bg-transparent text-right text-white focus:outline-none"
                        />
                      </label>
                    </div>

                    {/* Multiline & Unicode/Hindi Subtitle Textarea */}
                    <textarea
                      rows={2}
                      value={sub.textStyle?.text || sub.label}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        updateClipTextStyle(sub.id, { text: e.target.value })
                      }
                      aria-label="Subtitle cue text"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none resize-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. TRANSITIONS TAB */}
      {activeTab === 'transitions' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Clip Transitions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Apply smooth entry and exit transitions to the selected clip.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Transition Duration</span>
              <span className="font-mono tabular-nums text-sky-400">
                {transitionDuration.toFixed(2)}s
              </span>
            </div>
            <Slider
              min={0.15}
              max={1.5}
              step={0.05}
              value={[transitionDuration]}
              onValueChange={([val]) => setTransitionDuration(val)}
            />
          </div>

          {!selectedClip ? (
            <p className="text-xs text-slate-400 py-4">
              Select a clip on the timeline to apply a transition.
            </p>
          ) : (
            <div className="space-y-2">
              {(
                [
                  {
                    id: 'none',
                    name: 'Hard Cut (None)',
                    desc: 'Instantaneous frame cut with 0.0s fade',
                  },
                  {
                    id: 'crossfade',
                    name: 'Smooth Dissolve',
                    desc: 'Linear opacity fade in and out across clip bounds',
                  },
                  {
                    id: 'dip-to-black',
                    name: 'Dip to Black',
                    desc: 'Cinema fade through deep black matte',
                  },
                  {
                    id: 'dip-to-white',
                    name: 'Dip to White',
                    desc: 'Editorial flash fade through crisp white matte',
                  },
                  {
                    id: 'zoom-in',
                    name: 'Kinetic Scale Reveal',
                    desc: 'Smooth 85% → 100% scale ease-in on entry',
                  },
                ] as { id: TransitionType; name: string; desc: string }[]
              ).map((tr) => {
                const isCurrent =
                  (selectedClip.transitionType || 'none') === tr.id;
                return (
                  <button
                    key={tr.id}
                    type="button"
                    onClick={() =>
                      applyClipTransition(
                        selectedClip.id,
                        tr.id,
                        transitionDuration
                      )
                    }
                    data-testid={`transition-option-${tr.id}`}
                    className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                      isCurrent
                        ? 'border-sky-500 bg-sky-500/15 text-white'
                        : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{tr.name}</span>
                      {isCurrent && (
                        <span className="text-[11px] font-mono text-sky-400">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{tr.desc}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. EFFECTS & COLOR GRADING TAB */}
      {activeTab === 'effects' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Visual Effects &amp; Color Looks
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Apply non-destructive LUT presets and optical adjustments.
            </p>
          </div>

          {!selectedClip ? (
            <p className="text-xs text-slate-400 py-4">
              Select a video or image clip on the timeline to adjust visual effects.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {colorLooks.map((look) => (
                  <button
                    key={look.name}
                    type="button"
                    onClick={() =>
                      updateClipFilters(selectedClip.id, look.filters)
                    }
                    className="w-full text-left p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:border-sky-500/60 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-100">
                      {look.name}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                      {look.desc}
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    Fine Optical Adjustments
                  </span>
                  <button
                    type="button"
                    onClick={() => resetClipFilters(selectedClip.id)}
                    className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                  >
                    Reset All
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Hue Shift</span>
                    <span className="font-mono tabular-nums text-white">
                      {selectedClip.filters.hueRotate}°
                    </span>
                  </div>
                  <Slider
                    min={-180}
                    max={180}
                    step={5}
                    value={[selectedClip.filters.hueRotate]}
                    onValueChange={([val]) =>
                      updateClipFilters(selectedClip.id, { hueRotate: val })
                    }
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Gaussian Blur</span>
                    <span className="font-mono tabular-nums text-white">
                      {selectedClip.filters.blur}px
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={16}
                    step={1}
                    value={[selectedClip.filters.blur]}
                    onValueChange={([val]) =>
                      updateClipFilters(selectedClip.id, { blur: val })
                    }
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Warm Sepia Tone</span>
                    <span className="font-mono tabular-nums text-white">
                      {selectedClip.filters.sepia}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[selectedClip.filters.sepia]}
                    onValueChange={([val]) =>
                      updateClipFilters(selectedClip.id, { sepia: val })
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 7. CROP & RESIZE TAB */}
      {activeTab === 'crop' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Crop &amp; Canvas Resize
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure target aspect ratio, fit/fill scaling, and edge cropping.
            </p>
          </div>

          <div className="space-y-2">
            {(Object.keys(ASPECT_RATIO_PRESETS) as AspectRatioPreset[]).map(
              (ratioKey) => {
                const preset = ASPECT_RATIO_PRESETS[ratioKey];
                const active = aspectRatio === ratioKey;
                return (
                  <button
                    key={ratioKey}
                    type="button"
                    onClick={() => setAspectRatio(ratioKey)}
                    data-testid={`aspect-ratio-${ratioKey}`}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      active
                        ? 'border-sky-500 bg-sky-500/10 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{preset.label}</span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400">
                        {preset.width}×{preset.height}
                      </span>
                    </div>
                  </button>
                );
              }
            )}
          </div>

          {selectedClip &&
            (selectedClip.trackType === 'video' ||
              selectedClip.trackType === 'overlay') && (
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    Clip Edge Crop (%)
                  </span>
                  <button
                    type="button"
                    onClick={() => resetClipCrop(selectedClip.id)}
                    className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                  >
                    Reset Crop
                  </button>
                </div>

                {(
                  [
                    { key: 'top', label: 'Crop Top' },
                    { key: 'bottom', label: 'Crop Bottom' },
                    { key: 'left', label: 'Crop Left' },
                    { key: 'right', label: 'Crop Right' },
                  ] as const
                ).map(({ key, label }) => {
                  const val =
                    (selectedClip.transform.crop ?? DEFAULT_CROP_SETTINGS)[key] ??
                    0;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">{label}</span>
                        <span className="font-mono tabular-nums text-white">
                          {val}%
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={40}
                        step={1}
                        value={[val]}
                        onValueChange={([nextVal]) =>
                          updateClipCrop(selectedClip.id, { [key]: nextVal })
                        }
                      />
                    </div>
                  );
                })}

                <div className="space-y-1.5 pt-1">
                  <div className="text-xs text-slate-400">Frame Fit / Fill Mode</div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                    {(['contain', 'cover', 'fill'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          updateClipTransform(selectedClip.id, { fitMode: mode })
                        }
                        className={`py-1 text-xs capitalize rounded cursor-pointer ${
                          selectedClip.transform.fitMode === mode
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {mode === 'contain'
                          ? 'Fit'
                          : mode === 'cover'
                            ? 'Fill'
                            : 'Stretch'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

          <div className="space-y-2 pt-3 border-t border-slate-800">
            <label className="text-xs font-medium text-slate-300 block">
              Canvas Background Matte
            </label>
            <div className="flex items-center gap-2">
              {['#090D16', '#000000', '#1E293B', '#F8FAFC', '#0F766E'].map(
                (swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setCanvasBackground(swatch)}
                    title={`Matte ${swatch}`}
                    className={`w-7 h-7 rounded-md border cursor-pointer ${
                      canvasBackground === swatch
                        ? 'border-sky-400 ring-2 ring-sky-400/40'
                        : 'border-slate-700'
                    }`}
                    style={{ backgroundColor: swatch }}
                  />
                )
              )}
            </div>
          </div>

          <Button
            type="button"
            variant={showSafeGuides ? 'default' : 'secondary'}
            size="sm"
            className="w-full"
            onClick={toggleSafeGuides}
          >
            {showSafeGuides ? 'Hide Safe Zone Grid' : 'Show Safe Zone Grid'}
          </Button>
        </div>
      )}

      {/* 8. SPEED TAB */}
      {activeTab === 'speed' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Playback Speed &amp; Time Remap
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Accelerate or slow down the selected clip. Timeline duration updates
              automatically.
            </p>
          </div>

          {!selectedClip ? (
            <p className="text-xs text-slate-400 py-4">
              Select a clip on the timeline to adjust its playback speed.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400">Active Clip</span>
                <span className="font-semibold text-white truncate max-w-[140px]">
                  {selectedClip.label}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Speed Multiplier</span>
                  <span className="font-mono tabular-nums text-sky-400 font-semibold">
                    {selectedClip.playbackRate.toFixed(2)}x
                  </span>
                </div>
                <Slider
                  min={0.25}
                  max={4}
                  step={0.25}
                  value={[selectedClip.playbackRate]}
                  onValueChange={([val]) => setClipSpeed(selectedClip.id, val)}
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setClipSpeed(selectedClip.id, rate)}
                    data-testid={`speed-preset-${rate}`}
                    className={`py-2 rounded-lg border text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                      selectedClip.playbackRate === rate
                        ? 'border-sky-500 bg-sky-500/15 text-white font-semibold'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] font-mono tabular-nums text-slate-400 flex justify-between">
                <span>Resulting Clip Duration:</span>
                <span className="text-white">
                  {formatTimecode(selectedClip.duration)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 9. EXPORT SETTINGS TAB */}
      {activeTab === 'export' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Export Configuration
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pre-configure output resolution, frame rate, container format, and
              inspect estimated size.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-medium block">
                Resolution
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {(['1080p', '720p', '480p'] as ExportResolution[]).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => updateExportSettings({ resolution: res })}
                    className={`py-1.5 text-xs font-mono rounded cursor-pointer ${
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

            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-medium block">
                Frame Rate (FPS)
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {([24, 30, 60] as const).map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => updateExportSettings({ fps })}
                    className={`py-1.5 text-xs font-mono tabular-nums rounded cursor-pointer ${
                      exportSettings.fps === fps
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-medium block">
                Format
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                {(['webm', 'mp4', 'gif'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => updateExportSettings({ format: fmt })}
                    className={`py-1.5 text-xs font-mono uppercase rounded cursor-pointer ${
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

            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1 text-xs font-mono tabular-nums">
              <div className="flex justify-between text-slate-400">
                <span>Sequence Duration:</span>
                <span className="text-white">
                  {formatTimecode(totalSeqDuration)}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Est. Output Size:</span>
                <span className="text-sky-400 font-semibold">
                  ~{estimatedMb} MB
                </span>
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={() => setExportDialogOpen(true)}
            >
              <Download className="h-4 w-4" />
              <span>Open Export Renderer</span>
            </Button>
          </div>
        </div>
      )}

      {/* 10. LOCAL PROJECTS TAB */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">
                Local IndexedDB Projects
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                Schema v{schemaVersion}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Persist your timeline structure, editing settings, and media locally
              in your browser. Never uploaded to any remote server.
            </p>
          </div>

          {/* Hidden File Input for Relinking Missing Media */}
          <input
            ref={relinkFileInputRef}
            type="file"
            accept="video/*,audio/*,image/*"
            onChange={(e) =>
              void handleRelinkFileChange(e.target.files?.[0] ?? null)
            }
            className="hidden"
            data-testid="relink-media-file-input"
          />

          {/* Persistence Status Pill / Banner */}
          <div
            data-testid="project-save-state-card"
            data-save-status={saveStatus}
            className="p-2.5 rounded-lg border border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs"
          >
            <span className="text-slate-400">Persistence Status</span>
            {saveStatus === 'saving' ? (
              <span className="font-medium text-sky-400 animate-pulse">
                Saving transaction...
              </span>
            ) : saveStatus === 'failed' ? (
              <span className="font-medium text-rose-400">
                Save Failed (Quota / Error)
              </span>
            ) : hasUnsavedChanges ? (
              <span className="font-medium text-amber-300">
                Unsaved Timeline Edits
              </span>
            ) : (
              <span className="font-medium text-emerald-400">
                Saved to IndexedDB
              </span>
            )}
          </div>

          {saveError && (
            <div
              role="alert"
              data-testid="project-save-error-banner"
              className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200 space-y-1"
            >
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span>Storage Transaction Failed</span>
              </div>
              <p className="text-[11px] text-rose-300">{saveError}</p>
            </div>
          )}

          {persistenceNotice && (
            <div
              role="status"
              data-testid="persistence-notice-banner"
              className="p-2.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs text-sky-200 flex items-center justify-between gap-2"
            >
              <span>{persistenceNotice}</span>
              <button
                type="button"
                onClick={() => setPersistenceNotice(null)}
                className="text-[11px] underline cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Missing Media Recovery Section */}
          {assets.some((a) => a.isMissingMedia) && (
            <div
              role="alert"
              data-testid="missing-media-recovery-panel"
              className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2 text-xs"
            >
              <div className="font-semibold text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>Missing Local Media Files</span>
              </div>
              <p className="text-[11px] text-amber-300/90">
                Browser storage is not permanent. Relink the original file(s) from
                your device to restore clip playback:
              </p>
              <div className="space-y-1.5">
                {assets
                  .filter((a) => a.isMissingMedia)
                  .map((missingAsset) => (
                    <div
                      key={missingAsset.id}
                      className="flex items-center justify-between gap-2 p-2 rounded bg-slate-950/90 border border-slate-800"
                    >
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">
                          {missingAsset.name}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          ID: {missingAsset.id}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRelinkingAssetId(missingAsset.id);
                          relinkFileInputRef.current?.click();
                        }}
                        data-testid={`relink-asset-btn-${missingAsset.id}`}
                      >
                        <Link2 className="h-3.5 w-3.5 text-sky-400" />
                        <span>Relink File</span>
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Active Project Title & Save / Duplicate Controls */}
          <div className="space-y-2">
            <label
              htmlFor="project-name-input"
              className="text-xs font-medium text-slate-300 block"
            >
              Active Project Title ({projectId})
            </label>
            <input
              id="project-name-input"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              data-testid="sidebar-project-name-input"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={saveStatus === 'saving'}
                onClick={() => void handleSaveProject()}
                data-testid="save-project-idb-btn"
              >
                <Save className="h-3.5 w-3.5" />
                <span>
                  {saveStatus === 'saving' ? 'Saving...' : 'Save Snapshot'}
                </span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => void duplicateProject()}
                data-testid="duplicate-current-project-btn"
              >
                <Copy className="h-3.5 w-3.5 text-sky-400" />
                <span>Save a Copy</span>
              </Button>
            </div>
            {saveMessage && (
              <p className="text-xs text-emerald-400 font-medium">{saveMessage}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={createNewBlankProject}
              data-testid="new-blank-project-btn"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              <span>Blank Project</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetToDemoProject}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Demo Reel</span>
            </Button>
          </div>

          {/* Saved Browser Snapshots List with Load, Rename, Copy, and Confirm Delete */}
          <div className="space-y-2 pt-3 border-t border-slate-800">
            <div className="text-xs font-medium text-slate-300">
              Saved Browser Snapshots ({savedProjects.length})
            </div>
            {savedProjects.length === 0 ? (
              <p className="text-xs text-slate-400">
                No snapshots saved yet. Click &ldquo;Save Snapshot&rdquo; above.
              </p>
            ) : (
              <div className="space-y-2">
                {savedProjects.map((proj) => {
                  const isRenaming = renamingProjectId === proj.id;
                  const isConfirmingDelete = confirmDeleteProjectId === proj.id;
                  const isCurrent = proj.id === projectId;

                  return (
                    <div
                      key={proj.id}
                      data-testid={`saved-project-card-${proj.id}`}
                      className={`p-2.5 rounded-lg border transition-colors space-y-2 ${
                        isCurrent
                          ? 'border-sky-500/60 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-900/70'
                      }`}
                    >
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={renamingValue}
                            onChange={(e) => setRenamingValue(e.target.value)}
                            aria-label="New project name"
                            data-testid={`rename-project-input-${proj.id}`}
                            className="flex-1 rounded border border-sky-500 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void renameProject(proj.id, renamingValue);
                              setRenamingProjectId(null);
                            }}
                            data-testid={`confirm-rename-project-btn-${proj.id}`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => void loadSavedProject(proj.id)}
                            className="text-left flex-1 min-w-0 cursor-pointer"
                          >
                            <div className="text-xs font-semibold text-white truncate hover:text-sky-400 transition-colors">
                              {proj.name}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
                              <span>{proj.aspectRatio}</span>
                              <span>·</span>
                              <span>{proj.clipCount} clips</span>
                              <span>·</span>
                              <span>{formatTimecode(proj.duration)}</span>
                              <span>·</span>
                              <span>v{proj.schemaVersion ?? 2}</span>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              title="Rename project"
                              onClick={() => {
                                setRenamingProjectId(proj.id);
                                setRenamingValue(proj.name);
                              }}
                              data-testid={`start-rename-project-btn-${proj.id}`}
                              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Create project copy"
                              onClick={() => void duplicateProject(proj.id)}
                              data-testid={`copy-project-btn-${proj.id}`}
                              className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Delete project"
                              onClick={() => setConfirmDeleteProjectId(proj.id)}
                              data-testid={`delete-project-btn-${proj.id}`}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {isConfirmingDelete && (
                        <div
                          role="alert"
                          data-testid={`confirm-delete-project-panel-${proj.id}`}
                          className="p-2 rounded bg-rose-950/60 border border-rose-500/40 flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="text-rose-200">
                            Delete &ldquo;{proj.name}&rdquo;?
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                void deleteSavedProject(proj.id);
                                setConfirmDeleteProjectId(null);
                              }}
                              data-testid={`confirm-delete-project-btn-${proj.id}`}
                              className="px-2 py-0.5 rounded bg-rose-500 text-slate-950 font-semibold hover:bg-rose-400 cursor-pointer"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteProjectId(null)}
                              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Delete All Local Project Data & Browser Storage Notice */}
          <div className="space-y-2.5 pt-3 border-t border-slate-800">
            <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="font-medium text-slate-200 flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span>Local Browser Storage Notice</span>
              </div>
              <p>
                IndexedDB storage is local to this browser and may be cleared by OS
                disk pressure or site-data resets. Media is never uploaded to a
                remote server without explicit consent.
              </p>
            </div>

            {!confirmClearAllData ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                onClick={() => setConfirmClearAllData(true)}
                data-testid="clear-all-local-data-btn"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete All Local Project Data</span>
              </Button>
            ) : (
              <div
                role="alert"
                data-testid="confirm-clear-all-local-data-panel"
                className="p-2.5 rounded-lg border border-rose-500/50 bg-rose-950/50 space-y-2 text-xs"
              >
                <p className="text-rose-200 text-[11px]">
                  Permanently delete all saved projects and cached media blobs from
                  IndexedDB? This cannot be undone.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      void clearAllLocalData();
                      setConfirmClearAllData(false);
                    }}
                    data-testid="confirm-clear-all-local-data-btn"
                  >
                    Confirm Purge
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmClearAllData(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MediaSidebar() {
  const activeTab = useEditorStore((s) => s.activeSidebarTab);
  const setActiveTab = useEditorStore((s) => s.setActiveSidebarTab);

  return (
    <aside
      aria-label="Editor tools and media bin"
      className="hidden lg:flex w-88 shrink-0 border-r border-slate-800/90 bg-[#0F172A]/85 select-none"
    >
      {/* Vertical Icon Rail (All 10 Tool Categories) */}
      <div className="flex flex-col items-center gap-1 py-2.5 px-1.5 border-r border-slate-800/80 bg-[#0B0F17] w-18 shrink-0 overflow-y-auto">
        {SIDEBAR_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              data-testid={`sidebar-tab-${tab.id}`}
              className={`flex flex-col items-center justify-center w-14 py-2 rounded-lg text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
                active
                  ? 'bg-slate-800 text-sky-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              {tab.icon}
              <span className="mt-1 whitespace-nowrap shrink-0">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tool Drawer Content */}
      <SidebarToolContent />
    </aside>
  );
}
