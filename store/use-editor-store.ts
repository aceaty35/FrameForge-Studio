import { create } from 'zustand';
import {
  ASPECT_RATIO_PRESETS,
  AspectRatioPreset,
  ClipTransform,
  CropSettings,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CROP_SETTINGS,
  DEFAULT_VIDEO_FILTERS,
  ExportProgress,
  ExportSettings,
  MediaAsset,
  ProjectSummary,
  SerializedProject,
  TextOverlayStyle,
  TimelineClip,
  TimelineTrack,
  TrackType,
  TransitionType,
  VideoFilterState,
} from '@/types/editor';
import {
  clampNormalizedTextPosition,
  validateSubtitleTiming,
} from '@/lib/subtitles/text-and-subtitles';
import {
  calculateProjectDuration,
  closeTrackGaps,
  deleteClipAndRipple,
  moveClipWithSnap,
  resolveTrackOverlaps,
  secondsToTicks,
  splitClipAtTime,
  ticksToSeconds,
  trimClipEnd,
  trimClipStart,
} from '@/lib/timeline/engine';
import {
  applyValidatedAudioFade,
  applyValidatedCrop,
  applyValidatedResize,
  applyValidatedRotation,
  applyValidatedSpeed,
  applyValidatedTrim,
  createValidatedBackgroundAudioClip,
  createValidatedImageOverlayClip,
  createValidatedTextOverlayClip,
} from '@/lib/operations/editing-operations';
import {
  createProceduralSampleAsset,
  defaultMediaManager,
  generateDeterministicPeaks,
} from '@/lib/media/manager';
import {
  clearAllLocalDataFromDb,
  clearAllMediaBlobsFromDb,
  CURRENT_PROJECT_SCHEMA_VERSION,
  deleteProjectFromDb,
  duplicateProjectInDb,
  getLastActiveProjectId,
  listProjectsFromDb,
  loadProjectFromDb,
  renameProjectInDb,
  saveMediaBlobToDb,
  saveProjectToDb,
  setSimulatedDbErrorForTests,
} from '@/lib/persistence/db';
import {
  classifyFailureIncident,
  EditorFailureCategory,
  EditorFailureIncident,
  RecoveryActionId,
  sanitizeProjectName,
  sanitizeUserText,
} from '@/lib/security/security-controls';
import { mediaWorkerClient } from '@/lib/workers/media-worker';
import { releaseExportResources } from '@/lib/export/exporter';
import { ProjectSaveStatus } from '@/types/editor';

interface HistorySnapshot {
  projectName: string;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  aspectRatio: AspectRatioPreset;
  canvasBackground: string;
}

export type ActiveSidebarTab =
  | 'media'
  | 'text'
  | 'audio'
  | 'subtitles'
  | 'transitions'
  | 'effects'
  | 'crop'
  | 'speed'
  | 'export'
  | 'projects';

export type CanvasZoomPreset = 'fit' | 50 | 75 | 100 | 125 | 150;

export interface EditorState {
  projectId: string;
  projectName: string;
  schemaVersion: number;
  aspectRatio: AspectRatioPreset;
  canvasBackground: string;
  canvasZoom: CanvasZoomPreset;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assets: MediaAsset[];

  // Selection & UI state
  selectedClipId: string | null;
  activeSidebarTab: ActiveSidebarTab;
  isExportDialogOpen: boolean;
  isArchitectureDrawerOpen: boolean;
  isSettingsDialogOpen: boolean;
  isSecurityDialogOpen: boolean;
  mobileSheetMode: 'none' | 'tools' | 'properties';
  hasUnsavedChanges: boolean;
  saveStatus: ProjectSaveStatus;
  saveError: string | null;
  autoSaveEnabled: boolean;
  lastSavedAt: number | null;
  savedProjects: ProjectSummary[];
  missingMediaAssetIds: string[];
  persistenceNotice: string | null;
  errorBanner: string | null;
  activeFailureIncident: EditorFailureIncident | null;

  // Playback & Timeline state
  playheadTime: number;
  isPlaying: boolean;
  isLooping: boolean;
  masterMuted: boolean;
  timelineZoom: number; // pixels per second (default 68)
  snapEnabled: boolean;
  rippleDeleteEnabled: boolean;
  showSafeGuides: boolean;

  // Undo / Redo stacks & pointer gesture snapshot
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  activeGestureSnapshot: HistorySnapshot | null;

  // Export state
  exportSettings: ExportSettings;
  exportProgress: ExportProgress;

  // Actions
  setProjectName: (name: string) => void;
  setAspectRatio: (ratio: AspectRatioPreset) => void;
  setCanvasBackground: (color: string) => void;
  setCanvasZoom: (zoom: CanvasZoomPreset) => void;
  setActiveSidebarTab: (tab: ActiveSidebarTab) => void;
  setExportDialogOpen: (open: boolean) => void;
  setArchitectureDrawerOpen: (open: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setSecurityDialogOpen: (open: boolean) => void;
  setMobileSheetMode: (mode: 'none' | 'tools' | 'properties') => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setErrorBanner: (msg: string | null) => void;
  reportFailureIncident: (
    rawError: unknown,
    explicitCategory?: EditorFailureCategory
  ) => void;
  dismissFailureIncident: () => void;
  executeRecoveryAction: (actionId: RecoveryActionId) => Promise<void>;

  // Playback & timeline controls
  setPlayheadTime: (time: number) => void;
  stepPlayheadFrames: (deltaFrames: number, fps?: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlayPause: () => void;
  setIsLooping: (loop: boolean) => void;
  setMasterMuted: (muted: boolean) => void;
  setTimelineZoom: (zoom: number) => void;
  toggleSnap: () => void;
  toggleRippleDelete: () => void;
  toggleSafeGuides: () => void;

  // Asset & Clip operations
  addAsset: (asset: MediaAsset, autoAppendToTimeline?: boolean) => void;
  updateAssetThumbnail: (assetId: string, thumbnailUrl: string) => void;
  removeAsset: (assetId: string) => void;
  clearAllMediaAssets: () => void;
  appendAssetToTimeline: (
    assetId: string,
    startTimeOverride?: number,
    targetTrackId?: string
  ) => void;
  addTextOverlayClip: (
    presetText?: string,
    presetSubtitle?: boolean,
    styleOverrides?: Partial<TextOverlayStyle>,
    targetTrackId?: string
  ) => void;
  addImageOverlayClip: (assetId?: string) => void;
  addBackgroundAudioClip: (assetId: string) => void;
  importSubtitlesBatch: (
    items: { startTime: number; duration: number; text: string }[]
  ) => void;
  selectClip: (clipId: string | null) => void;
  updateClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  setClipTiming: (clipId: string, startTime: number, endTime: number) => boolean;
  setClipSpeed: (clipId: string, rate: number) => void;
  setClipAudioFades: (
    clipId: string,
    fades: { fadeIn?: number; fadeOut?: number }
  ) => void;
  applyClipTransition: (
    clipId: string,
    transitionType: TransitionType,
    fadeDuration: number
  ) => void;
  updateClipFilters: (clipId: string, patch: Partial<VideoFilterState>) => void;
  resetClipFilters: (clipId: string) => void;
  updateClipTransform: (clipId: string, patch: Partial<ClipTransform>) => void;
  updateClipCrop: (clipId: string, patch: Partial<CropSettings>) => void;
  resetClipCrop: (clipId: string) => void;
  updateClipTextStyle: (
    clipId: string,
    patch: Partial<TextOverlayStyle>
  ) => void;

  // Non-destructive timeline editing & pointer gesture batching
  beginClipGesture: () => void;
  commitClipGesture: () => void;
  trimClipLeft: (clipId: string, newStartTime: number) => void;
  trimClipRight: (clipId: string, newDuration: number) => void;
  moveClip: (
    clipId: string,
    proposedStartTime: number,
    targetTrackId?: string
  ) => void;
  splitSelectedClipAtPlayhead: () => boolean;
  deleteSelectedClip: () => void;
  duplicateSelectedClip: () => void;
  closeGapsOnTrack: (trackId: string) => void;
  resolveOverlapsOnTrack: (trackId: string) => void;

  // Track controls
  addTrack: (type: TrackType) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackHidden: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Export
  updateExportSettings: (patch: Partial<ExportSettings>) => void;
  setExportProgress: (progress: ExportProgress) => void;

  // Persistence
  saveCurrentProject: (
    customTransactionCommit?: (record: SerializedProject) => Promise<void>
  ) => Promise<boolean>;
  refreshSavedProjects: () => Promise<void>;
  loadSavedProject: (id: string) => Promise<boolean>;
  restoreLastSessionProject: () => Promise<boolean>;
  renameProject: (projectId: string, newName: string) => Promise<boolean>;
  duplicateProject: (
    sourceProjectId?: string,
    customName?: string
  ) => Promise<SerializedProject | null>;
  deleteSavedProject: (projectId: string) => Promise<void>;
  clearAllLocalData: () => Promise<void>;
  relinkMissingMediaAsset: (assetId: string, file: File) => Promise<boolean>;
  setPersistenceNotice: (notice: string | null) => void;
  createNewBlankProject: () => void;
  resetToDemoProject: () => void;
}

export const INITIAL_TRACKS: TimelineTrack[] = [
  {
    id: 'track_text_1',
    name: 'Titles & Subtitles',
    type: 'text',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_overlay_1',
    name: 'B-Roll & Overlay',
    type: 'overlay',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_video_1',
    name: 'Primary Video V1',
    type: 'video',
    muted: false,
    hidden: false,
    locked: false,
  },
  {
    id: 'track_audio_1',
    name: 'Audio Soundtrack A1',
    type: 'audio',
    muted: false,
    hidden: false,
    locked: false,
  },
];

const INITIAL_DEMO_ASSETS: MediaAsset[] = [
  {
    id: 'demo_asset_scene_1',
    fingerprint: 'scene_01_calibration_reel.png::148200::0',
    name: 'Scene_01_Calibration_Reel.png',
    type: 'image',
    mimeType: 'image/png',
    sizeBytes: 148200,
    duration: 5,
    width: 1920,
    height: 1080,
    objectUrl: '',
    waveformPeaks: generateDeterministicPeaks(64, 11),
    createdAt: 1729230000000,
    isSyntheticSample: true,
    persistedInIdb: true,
  },
  {
    id: 'demo_asset_scene_2',
    fingerprint: 'scene_02_architectural_slate.png::162400::0',
    name: 'Scene_02_Architectural_Slate.png',
    type: 'image',
    mimeType: 'image/png',
    sizeBytes: 162400,
    duration: 4.5,
    width: 1920,
    height: 1080,
    objectUrl: '',
    waveformPeaks: generateDeterministicPeaks(64, 29),
    createdAt: 1729230010000,
    isSyntheticSample: true,
    persistedInIdb: true,
  },
];

const INITIAL_DEMO_CLIPS: TimelineClip[] = [
  {
    id: 'clip_demo_v1',
    trackId: 'track_video_1',
    trackType: 'video',
    assetId: 'demo_asset_scene_1',
    label: 'Scene 01 · Calibration Reel',
    startTime: 0,
    duration: 4.5,
    inPoint: 0,
    outPoint: 4.5,
    playbackRate: 1,
    volume: 100,
    muted: false,
    fadeIn: 0.3,
    fadeOut: 0,
    transitionType: 'crossfade',
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: { ...DEFAULT_CLIP_TRANSFORM, crop: { ...DEFAULT_CROP_SETTINGS } },
    colorTag: '#0284C7',
  },
  {
    id: 'clip_demo_v2',
    trackId: 'track_video_1',
    trackType: 'video',
    assetId: 'demo_asset_scene_2',
    label: 'Scene 02 · Architectural Slate',
    startTime: 4.5,
    duration: 4.5,
    inPoint: 0,
    outPoint: 4.5,
    playbackRate: 1,
    volume: 100,
    muted: false,
    fadeIn: 0.3,
    fadeOut: 0.5,
    transitionType: 'crossfade',
    filters: { ...DEFAULT_VIDEO_FILTERS, contrast: 108, saturation: 112 },
    transform: { ...DEFAULT_CLIP_TRANSFORM, crop: { ...DEFAULT_CROP_SETTINGS } },
    colorTag: '#0D9488',
  },
  {
    id: 'clip_demo_title_1',
    trackId: 'track_text_1',
    trackType: 'text',
    assetId: null,
    label: 'Headline Overlay · FrameForge Studio',
    startTime: 0.4,
    duration: 3.6,
    inPoint: 0,
    outPoint: 3.6,
    playbackRate: 1,
    volume: 100,
    muted: false,
    fadeIn: 0.25,
    fadeOut: 0.25,
    transitionType: 'crossfade',
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: { ...DEFAULT_CLIP_TRANSFORM, crop: { ...DEFAULT_CROP_SETTINGS } },
    textStyle: {
      text: 'FRAMEFORGE STUDIO · ZERO-UPLOAD NLE',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontSize: 48,
      fontWeight: 700,
      color: '#F8FAFC',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      textAlign: 'center',
      x: 0.5,
      y: 0.84,
      outlineColor: '#000000',
      outlineWidth: 0,
      isSubtitle: true,
    },
    colorTag: '#6366F1',
  },
];

function createSnapshot(state: EditorState): HistorySnapshot {
  return {
    projectName: state.projectName,
    tracks: structuredClone(state.tracks),
    clips: structuredClone(state.clips),
    aspectRatio: state.aspectRatio,
    canvasBackground: state.canvasBackground,
  };
}

function pushHistory(state: EditorState): {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  hasUnsavedChanges: boolean;
} {
  // If an interactive pointer gesture is active, don't push per-frame snapshots
  if (state.activeGestureSnapshot) {
    return {
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      hasUnsavedChanges: true,
    };
  }
  const snapshot = createSnapshot(state);
  const nextUndo = [...state.undoStack.slice(-49), snapshot];
  return {
    undoStack: nextUndo,
    redoStack: [],
    hasUnsavedChanges: true,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: 'proj_default_studio',
  projectName: 'Studio Reel 01 — Product Sequence',
  schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  aspectRatio: '16:9',
  canvasBackground: '#090D16',
  canvasZoom: 'fit',
  tracks: INITIAL_TRACKS,
  clips: INITIAL_DEMO_CLIPS,
  assets: INITIAL_DEMO_ASSETS,

  selectedClipId: 'clip_demo_v1',
  activeSidebarTab: 'media',
  isExportDialogOpen: false,
  isArchitectureDrawerOpen: false,
  isSettingsDialogOpen: false,
  isSecurityDialogOpen: false,
  mobileSheetMode: 'none',
  hasUnsavedChanges: false,
  saveStatus: 'idle',
  saveError: null,
  autoSaveEnabled: true,
  lastSavedAt: null,
  savedProjects: [],
  missingMediaAssetIds: [],
  persistenceNotice: null,
  errorBanner: null,
  activeFailureIncident: null,

  playheadTime: 1.2,
  isPlaying: false,
  isLooping: true,
  masterMuted: false,
  timelineZoom: 68,
  snapEnabled: true,
  rippleDeleteEnabled: false,
  showSafeGuides: false,

  undoStack: [],
  redoStack: [],
  activeGestureSnapshot: null,

  exportSettings: {
    format: 'webm',
    resolution: '720p',
    fps: 30,
    quality: 'high',
    engine: 'auto',
    filename: 'frameforge-sequence-export',
    audioBitrate: '192k',
    removeAudio: false,
  },
  exportProgress: {
    status: 'idle',
    progress: 0,
    stageLabel: 'Ready to export locally',
  },

  setProjectName: (rawProjectName) =>
    set((state) => {
      const projectName = sanitizeUserText(rawProjectName, {
        maxLength: 100,
        allowMultiline: false,
      });
      if (state.projectName === projectName) return state;
      return {
        ...pushHistory(state),
        projectName,
      };
    }),
  setAspectRatio: (aspectRatio) =>
    set((state) => ({
      ...pushHistory(state),
      aspectRatio,
    })),
  setCanvasBackground: (canvasBackground) =>
    set((state) => ({
      ...pushHistory(state),
      canvasBackground,
    })),
  setCanvasZoom: (canvasZoom) => set({ canvasZoom }),
  setActiveSidebarTab: (activeSidebarTab) =>
    set({ activeSidebarTab, mobileSheetMode: 'tools' }),
  setExportDialogOpen: (isExportDialogOpen) => set({ isExportDialogOpen }),
  setArchitectureDrawerOpen: (isArchitectureDrawerOpen) =>
    set({ isArchitectureDrawerOpen }),
  setSettingsDialogOpen: (isSettingsDialogOpen) => set({ isSettingsDialogOpen }),
  setSecurityDialogOpen: (isSecurityDialogOpen) => set({ isSecurityDialogOpen }),
  setMobileSheetMode: (mobileSheetMode) => set({ mobileSheetMode }),
  setAutoSaveEnabled: (autoSaveEnabled) => set({ autoSaveEnabled }),
  setErrorBanner: (errorBanner) =>
    set({
      errorBanner,
      activeFailureIncident: errorBanner
        ? classifyFailureIncident(errorBanner)
        : null,
    }),
  reportFailureIncident: (rawError, explicitCategory) => {
    const incident = classifyFailureIncident(rawError, explicitCategory);
    set({
      activeFailureIncident: incident,
      errorBanner: `${incident.recoverySpec.title}: ${incident.customDetail || incident.recoverySpec.userExplanation}`,
    });
  },
  dismissFailureIncident: () =>
    set({
      activeFailureIncident: null,
      errorBanner: null,
    }),
  executeRecoveryAction: async (actionId) => {
    const state = get();
    if (actionId === 'LOAD_SAFE_SAMPLE_REEL') {
      const sample = await createProceduralSampleAsset('studio-countdown');
      state.addAsset(sample, true);
      set({
        activeFailureIncident: null,
        errorBanner: null,
        persistenceNotice:
          'Recovery completed: loaded verified local calibration clip onto the timeline.',
      });
      return;
    }

    if (actionId === 'SWITCH_TO_SAFE_480P_EXPORT') {
      releaseExportResources(true);
      state.updateExportSettings({
        resolution: '480p',
        fps: 24,
        quality: 'fast',
        engine: 'native-stream',
      });
      set({
        activeFailureIncident: null,
        errorBanner: null,
        persistenceNotice:
          'Recovery completed: released temporary buffers and configured low-memory 480p @ 24fps export mode.',
      });
      return;
    }

    if (actionId === 'RETRY_EXPORT_NATIVE_WEBM') {
      releaseExportResources(true);
      state.updateExportSettings({
        format: 'webm',
        engine: 'native-stream',
      });
      set({
        activeFailureIncident: null,
        errorBanner: null,
        isExportDialogOpen: true,
        exportProgress: {
          status: 'idle',
          progress: 0,
          stageLabel: 'Switched to verified Native Browser WebM Stream',
        },
        persistenceNotice:
          'Recovery completed: switched export engine to universal Native Browser WebM Stream.',
      });
      return;
    }

    if (actionId === 'PURGE_CACHED_MEDIA_BLOBS') {
      await clearAllMediaBlobsFromDb();
      set({
        activeFailureIncident: null,
        errorBanner: null,
        persistenceNotice:
          'Recovery completed: purged cached IndexedDB media blobs while keeping active timeline metadata.',
      });
      return;
    }

    if (actionId === 'RESET_WORKER_AND_USE_FALLBACK') {
      mediaWorkerClient.resetWorkerAfterFailure();
      releaseExportResources(true);
      state.updateExportSettings({
        engine: 'native-stream',
        format: 'webm',
      });
      set({
        activeFailureIncident: null,
        errorBanner: null,
        persistenceNotice:
          'Recovery completed: reset background worker pool and enabled non-blocking fallback mode.',
      });
      return;
    }

    if (actionId === 'ENABLE_IN_MEMORY_PERSISTENCE') {
      setSimulatedDbErrorForTests(null);
      await clearAllMediaBlobsFromDb().catch(() => undefined);
      set({
        activeFailureIncident: null,
        errorBanner: null,
      });
      await get().saveCurrentProject();
      set({
        persistenceNotice:
          'Recovery completed: project metadata saved via transactional fallback store.',
      });
      return;
    }

    // DISMISS_AND_CLEAN_BUFFERS
    releaseExportResources(false);
    set({
      activeFailureIncident: null,
      errorBanner: null,
      persistenceNotice: 'Cleaned temporary buffers and resumed editing state.',
    });
  },

  setPlayheadTime: (time) => {
    const duration = Math.max(5, calculateProjectDuration(get().clips));
    const clampedTicks = Math.max(
      0,
      Math.min(secondsToTicks(duration + 2), secondsToTicks(time))
    );
    set({ playheadTime: ticksToSeconds(clampedTicks) });
  },

  stepPlayheadFrames: (deltaFrames, fps = 30) => {
    const current = get().playheadTime;
    const stepSeconds = deltaFrames / Math.max(1, fps);
    get().setIsPlaying(false);
    get().setPlayheadTime(Math.max(0, current + stepSeconds));
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  togglePlayPause: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setIsLooping: (isLooping) => set({ isLooping }),
  setMasterMuted: (masterMuted) => set({ masterMuted }),
  setTimelineZoom: (timelineZoom) =>
    set({ timelineZoom: Math.max(24, Math.min(200, timelineZoom)) }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  toggleRippleDelete: () =>
    set((s) => ({ rippleDeleteEnabled: !s.rippleDeleteEnabled })),
  toggleSafeGuides: () => set((s) => ({ showSafeGuides: !s.showSafeGuides })),

  addAsset: (asset, autoAppendToTimeline = true) => {
    set((state) => ({
      assets: [asset, ...state.assets],
      hasUnsavedChanges: true,
    }));
    if (autoAppendToTimeline) {
      get().appendAssetToTimeline(asset.id);
    }
  },

  updateAssetThumbnail: (assetId, thumbnailUrl) =>
    set((state) => ({
      assets: state.assets.map((a) =>
        a.id === assetId ? { ...a, thumbnailUrl } : a
      ),
    })),

  removeAsset: (assetId) =>
    set((state) => {
      const target = state.assets.find((a) => a.id === assetId);
      if (target) {
        void defaultMediaManager.releaseAssetResources(target);
      }
      return {
        ...pushHistory(state),
        assets: state.assets.filter((a) => a.id !== assetId),
        clips: state.clips.filter((c) => c.assetId !== assetId),
        selectedClipId:
          state.clips.find((c) => c.id === state.selectedClipId)?.assetId === assetId
            ? null
            : state.selectedClipId,
      };
    }),

  clearAllMediaAssets: () =>
    set((state) => {
      for (const asset of state.assets) {
        void defaultMediaManager.releaseAssetResources(asset);
      }
      defaultMediaManager.revokeAllTrackedUrls();
      void clearAllMediaBlobsFromDb();
      return {
        ...pushHistory(state),
        assets: [],
        clips: state.clips.filter((c) => c.assetId === null),
        selectedClipId: null,
      };
    }),

  appendAssetToTimeline: (assetId, startTimeOverride, targetTrackId) =>
    set((state) => {
      const asset = state.assets.find((a) => a.id === assetId);
      if (!asset) return state;

      const defaultTrackType = asset.type === 'audio' ? 'audio' : 'video';
      const requestedTrack = targetTrackId
        ? state.tracks.find((t) => t.id === targetTrackId)
        : undefined;
      const track =
        requestedTrack && !requestedTrack.locked && requestedTrack.type !== 'text'
          ? requestedTrack
          : state.tracks.find((t) => t.type === defaultTrackType && !t.locked) ||
            state.tracks[2];
      if (!track || track.locked) return state;

      const clipsOnTrack = state.clips.filter((c) => c.trackId === track.id);
      const trackEnd =
        startTimeOverride !== undefined
          ? ticksToSeconds(Math.max(0, secondsToTicks(startTimeOverride)))
          : clipsOnTrack.reduce(
              (max, c) =>
                Math.max(
                  max,
                  ticksToSeconds(
                    secondsToTicks(c.startTime) + secondsToTicks(c.duration)
                  )
                ),
              0
            );

      const exactDuration = ticksToSeconds(secondsToTicks(asset.duration));

      const newClip: TimelineClip = {
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        trackId: track.id,
        trackType: track.type,
        assetId: asset.id,
        label: asset.name.replace(/\.[^.]+$/, ''),
        startTime: trackEnd,
        duration: exactDuration,
        inPoint: 0,
        outPoint: exactDuration,
        playbackRate: 1,
        volume: 100,
        muted: false,
        fadeIn: 0,
        fadeOut: 0,
        transitionType: 'none',
        filters: { ...DEFAULT_VIDEO_FILTERS },
        transform: { ...DEFAULT_CLIP_TRANSFORM, crop: { ...DEFAULT_CROP_SETTINGS } },
        colorTag: asset.type === 'audio' ? '#10B981' : '#0284C7',
      };

      return {
        ...pushHistory(state),
        clips: [...state.clips, newClip],
        selectedClipId: newClip.id,
      };
    }),

  addTextOverlayClip: (
    presetText = 'NEW CAPTION OVERLAY',
    presetSubtitle = false,
    styleOverrides,
    targetTrackId
  ) =>
    set((state) => {
      const explicitTrack = targetTrackId
        ? state.tracks.find(
            (t) => t.id === targetTrackId && t.type === 'text' && !t.locked
          )
        : undefined;
      const textTrack =
        explicitTrack ||
        state.tracks.find((t) => t.type === 'text' && !t.locked) ||
        state.tracks[0];
      if (!textTrack || textTrack.locked) return state;

      const safeText = sanitizeUserText(presetText, {
        maxLength: 1000,
        allowMultiline: true,
      });
      const res = createValidatedTextOverlayClip({
        trackId: textTrack.id,
        text: safeText || 'NEW CAPTION OVERLAY',
        startTime: state.playheadTime,
        isSubtitle: presetSubtitle,
        style: styleOverrides,
      });

      return {
        ...pushHistory(state),
        clips: [...state.clips, res.value],
        selectedClipId: res.value.id,
      };
    }),

  addImageOverlayClip: (assetId) =>
    set((state) => {
      const overlayTrack =
        state.tracks.find((t) => t.type === 'overlay' && !t.locked) ||
        state.tracks.find((t) => t.type === 'video' && !t.locked);
      if (!overlayTrack || overlayTrack.locked) return state;

      const visualAsset =
        (assetId ? state.assets.find((a) => a.id === assetId) : undefined) ||
        state.assets.find((a) => a.type === 'image' || a.type === 'video');
      if (!visualAsset) return state;

      const res = createValidatedImageOverlayClip({
        asset: visualAsset,
        trackId: overlayTrack.id,
        startTime: state.playheadTime,
      });
      if (!res.valid) return state;

      return {
        ...pushHistory(state),
        clips: [...state.clips, res.value],
        selectedClipId: res.value.id,
      };
    }),

  addBackgroundAudioClip: (assetId) =>
    set((state) => {
      const audioTrack =
        state.tracks.find((t) => t.type === 'audio' && !t.locked);
      if (!audioTrack || audioTrack.locked) return state;

      const audioAsset = state.assets.find((a) => a.id === assetId);
      if (!audioAsset) return state;

      const clipsOnTrack = state.clips.filter((c) => c.trackId === audioTrack.id);
      const trackEnd = clipsOnTrack.reduce(
        (max, c) =>
          Math.max(
            max,
            ticksToSeconds(secondsToTicks(c.startTime) + secondsToTicks(c.duration))
          ),
        0
      );

      const res = createValidatedBackgroundAudioClip({
        asset: audioAsset,
        trackId: audioTrack.id,
        startTime: trackEnd,
      });
      if (!res.valid) return state;

      return {
        ...pushHistory(state),
        clips: [...state.clips, res.value],
        selectedClipId: res.value.id,
      };
    }),

  importSubtitlesBatch: (items) =>
    set((state) => {
      const textTrack =
        state.tracks.find((t) => t.type === 'text' && !t.locked) || state.tracks[0];
      if (!textTrack || textTrack.locked || items.length === 0) return state;

      const sortedItems = [...items].sort((a, b) => a.startTime - b.startTime);

      const added: TimelineClip[] = sortedItems.map((item, idx) => {
        const dur = ticksToSeconds(secondsToTicks(Math.max(0.2, item.duration)));
        const safeSubText = sanitizeUserText(item.text, {
          maxLength: 1000,
          allowMultiline: true,
        });
        return {
          id: `clip_sub_${Date.now()}_${idx}`,
          trackId: textTrack.id,
          trackType: 'text',
          assetId: null,
          label: `Sub: ${safeSubText.replace(/\n/g, ' ').slice(0, 22)}`,
          startTime: ticksToSeconds(secondsToTicks(Math.max(0, item.startTime))),
          duration: dur,
          inPoint: 0,
          outPoint: dur,
          playbackRate: 1,
          volume: 100,
          muted: false,
          fadeIn: 0.15,
          fadeOut: 0.15,
          transitionType: 'crossfade',
          filters: { ...DEFAULT_VIDEO_FILTERS },
          transform: {
            ...DEFAULT_CLIP_TRANSFORM,
            crop: { ...DEFAULT_CROP_SETTINGS },
          },
          textStyle: {
            text: safeSubText,
            fontFamily:
              '"Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", Plus Jakarta Sans, system-ui, sans-serif',
            fontSize: 40,
            fontWeight: 600,
            color: '#FFFFFF',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            textAlign: 'center',
            x: 0.5,
            y: 0.86,
            rotation: 0,
            outlineColor: '#000000',
            outlineWidth: 2,
            animation: 'fade-in-out',
            keepWithinCanvas: true,
            isSubtitle: true,
          },
          colorTag: '#6366F1',
        };
      });

      return {
        ...pushHistory(state),
        clips: [...state.clips, ...added],
        selectedClipId: added[0]?.id ?? state.selectedClipId,
      };
    }),

  selectClip: (selectedClipId) => set({ selectedClipId }),

  updateClip: (clipId, patch) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    })),

  setClipTiming: (clipId, startTime, endTime) => {
    const validation = validateSubtitleTiming(startTime, endTime, 1);
    if (!validation.valid) {
      return false;
    }
    const startTicks = secondsToTicks(startTime);
    const durTicks = secondsToTicks(endTime) - startTicks;
    const nextStart = ticksToSeconds(startTicks);
    const nextDur = ticksToSeconds(durTicks);

    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              startTime: nextStart,
              duration: nextDur,
              outPoint: c.trackType === 'text' ? nextDur : c.inPoint + nextDur,
            }
          : c
      ),
    }));
    return true;
  },

  setClipSpeed: (clipId, rate) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId ? applyValidatedSpeed(c, rate).value : c
      ),
    })),

  setClipAudioFades: (clipId, fades) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId ? applyValidatedAudioFade(c, fades).value : c
      ),
    })),

  applyClipTransition: (clipId, transitionType, fadeDuration) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) => {
        if (c.id !== clipId) return c;
        const maxFade = Math.min(2.0, c.duration * 0.45);
        const clampedFade =
          transitionType === 'none'
            ? 0
            : ticksToSeconds(
                secondsToTicks(Math.min(maxFade, Math.max(0.1, fadeDuration)))
              );
        return {
          ...c,
          transitionType,
          fadeIn: clampedFade,
          fadeOut: clampedFade,
        };
      }),
    })),

  updateClipFilters: (clipId, patch) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId ? { ...c, filters: { ...c.filters, ...patch } } : c
      ),
    })),

  resetClipFilters: (clipId) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId ? { ...c, filters: { ...DEFAULT_VIDEO_FILTERS } } : c
      ),
    })),

  updateClipTransform: (clipId, patch) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) => {
        if (c.id !== clipId) return c;
        let next = applyValidatedResize(c, {
          scale: patch.scale,
          x: patch.x,
          y: patch.y,
          fitMode: patch.fitMode,
        }).value;
        if (patch.rotation !== undefined) {
          next = applyValidatedRotation(next, patch.rotation).value;
        }
        return {
          ...next,
          transform: {
            ...next.transform,
            flipH: patch.flipH !== undefined ? patch.flipH : next.transform.flipH,
            flipV: patch.flipV !== undefined ? patch.flipV : next.transform.flipV,
            crop: patch.crop !== undefined ? patch.crop : next.transform.crop,
          },
        };
      }),
    })),

  updateClipCrop: (clipId, patch) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId ? applyValidatedCrop(c, patch).value : c
      ),
    })),

  resetClipCrop: (clipId) =>
    set((state) => ({
      ...pushHistory(state),
      clips: state.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              transform: { ...c.transform, crop: { ...DEFAULT_CROP_SETTINGS } },
            }
          : c
      ),
    })),

  updateClipTextStyle: (clipId, patch) =>
    set((state) => {
      const dims = ASPECT_RATIO_PRESETS[state.aspectRatio];
      return {
        ...pushHistory(state),
        clips: state.clips.map((c) => {
          if (c.id !== clipId || !c.textStyle) return c;
          const sanitizedPatch =
            patch.text !== undefined
              ? {
                  ...patch,
                  text: sanitizeUserText(patch.text, {
                    maxLength: 1000,
                    allowMultiline: true,
                  }),
                }
              : patch;
          const merged: TextOverlayStyle = {
            ...c.textStyle,
            ...sanitizedPatch,
          };
          if (merged.rotation !== undefined) {
            merged.rotation = Math.max(-180, Math.min(180, Math.round(merged.rotation)));
          }
          if (merged.fontSize !== undefined) {
            merged.fontSize = Math.max(14, Math.min(160, Math.round(merged.fontSize)));
          }
          if (merged.outlineWidth !== undefined) {
            merged.outlineWidth = Math.max(0, Math.min(16, Number(merged.outlineWidth)));
          }
          const clampedPos = clampNormalizedTextPosition(
            merged,
            dims.width,
            dims.height
          );
          merged.x = clampedPos.x;
          merged.y = clampedPos.y;
          return {
            ...c,
            label: sanitizedPatch.text
              ? sanitizedPatch.text.replace(/\n/g, ' ').slice(0, 28)
              : c.label,
            textStyle: merged,
          };
        }),
      };
    }),

  beginClipGesture: () =>
    set((state) => ({
      activeGestureSnapshot: createSnapshot(state),
    })),

  commitClipGesture: () =>
    set((state) => {
      if (!state.activeGestureSnapshot) return state;
      const prevJson = JSON.stringify(state.activeGestureSnapshot.clips);
      const currJson = JSON.stringify(state.clips);
      if (prevJson === currJson) {
        return { activeGestureSnapshot: null };
      }
      return {
        undoStack: [...state.undoStack.slice(-49), state.activeGestureSnapshot],
        redoStack: [],
        activeGestureSnapshot: null,
        hasUnsavedChanges: true,
      };
    }),

  trimClipLeft: (clipId, newStartTime) =>
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId);
      if (!target) return state;
      const track = state.tracks.find((t) => t.id === target.trackId);
      if (track?.locked) return state;
      const asset = state.assets.find((a) => a.id === target.assetId);
      const updated = applyValidatedTrim(target, {
        newStartTime,
        maxSourceDuration: asset?.duration,
      }).value;
      return {
        ...pushHistory(state),
        clips: state.clips.map((c) => (c.id === clipId ? updated : c)),
      };
    }),

  trimClipRight: (clipId, newDuration) =>
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId);
      if (!target) return state;
      const track = state.tracks.find((t) => t.id === target.trackId);
      if (track?.locked) return state;
      const asset = state.assets.find((a) => a.id === target.assetId);
      const updated = applyValidatedTrim(target, {
        newDuration,
        maxSourceDuration: asset?.duration,
      }).value;
      return {
        ...pushHistory(state),
        clips: state.clips.map((c) => (c.id === clipId ? updated : c)),
      };
    }),

  moveClip: (clipId, proposedStartTime, targetTrackId) =>
    set((state) => {
      const target = state.clips.find((c) => c.id === clipId);
      if (!target) return state;
      const currentTrack = state.tracks.find((t) => t.id === target.trackId);
      if (currentTrack?.locked) return state;

      let nextTrack = currentTrack;
      if (targetTrackId && targetTrackId !== target.trackId) {
        const candidateTrack = state.tracks.find((t) => t.id === targetTrackId);
        if (candidateTrack && !candidateTrack.locked) {
          // Allow moving visual clips between video & overlay tracks, text on text tracks, audio on audio tracks
          const isVisualTarget =
            target.trackType === 'video' || target.trackType === 'overlay';
          const isVisualCandidate =
            candidateTrack.type === 'video' || candidateTrack.type === 'overlay';
          if (
            (isVisualTarget && isVisualCandidate) ||
            candidateTrack.type === target.trackType
          ) {
            nextTrack = candidateTrack;
          }
        }
      }

      const snappedStart = moveClipWithSnap(
        target,
        proposedStartTime,
        state.clips,
        state.playheadTime,
        state.snapEnabled
      );

      return {
        ...pushHistory(state),
        clips: state.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                startTime: snappedStart,
                trackId: nextTrack ? nextTrack.id : c.trackId,
                trackType: nextTrack ? nextTrack.type : c.trackType,
              }
            : c
        ),
      };
    }),

  splitSelectedClipAtPlayhead: () => {
    const state = get();
    const targetClip =
      state.clips.find((c) => c.id === state.selectedClipId) ||
      state.clips.find(
        (c) =>
          state.playheadTime >= c.startTime + 0.2 &&
          state.playheadTime <= c.startTime + c.duration - 0.2
      );

    if (!targetClip) {
      set({
        errorBanner:
          'Place the playhead inside an active clip (at least 0.20s from its edges) to split.',
      });
      return false;
    }

    const track = state.tracks.find((t) => t.id === targetClip.trackId);
    if (track?.locked) {
      set({ errorBanner: 'Cannot split a clip on a locked track.' });
      return false;
    }

    const splitResult = splitClipAtTime(targetClip, state.playheadTime);
    if (!splitResult) {
      set({
        errorBanner:
          'Playhead must be inside the selected clip bounds (minimum 0.20s per segment) to split.',
      });
      return false;
    }

    const [leftClip, rightClip] = splitResult;
    set((s) => ({
      ...pushHistory(s),
      errorBanner: null,
      clips: s.clips.flatMap((c) =>
        c.id === targetClip.id ? [leftClip, rightClip] : [c]
      ),
      selectedClipId: rightClip.id,
    }));
    return true;
  },

  deleteSelectedClip: () =>
    set((state) => {
      if (!state.selectedClipId) return state;
      const target = state.clips.find((c) => c.id === state.selectedClipId);
      if (!target) return state;
      const track = state.tracks.find((t) => t.id === target.trackId);
      if (track?.locked) return state;

      const nextClips = deleteClipAndRipple(
        state.clips,
        state.selectedClipId,
        state.rippleDeleteEnabled
      );

      return {
        ...pushHistory(state),
        clips: nextClips,
        selectedClipId: nextClips[0]?.id ?? null,
      };
    }),

  duplicateSelectedClip: () =>
    set((state) => {
      const target = state.clips.find((c) => c.id === state.selectedClipId);
      if (!target) return state;
      const newStart = ticksToSeconds(
        secondsToTicks(target.startTime) + secondsToTicks(target.duration)
      );
      const duplicate: TimelineClip = {
        ...structuredClone(target),
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label: `${target.label} (Copy)`,
        startTime: newStart,
      };
      return {
        ...pushHistory(state),
        clips: [...state.clips, duplicate],
        selectedClipId: duplicate.id,
      };
    }),

  closeGapsOnTrack: (trackId) =>
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track || track.locked) return state;
      return {
        ...pushHistory(state),
        clips: closeTrackGaps(state.clips, trackId),
      };
    }),

  resolveOverlapsOnTrack: (trackId) =>
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track || track.locked) return state;
      return {
        ...pushHistory(state),
        clips: resolveTrackOverlaps(state.clips, trackId),
      };
    }),

  addTrack: (type) =>
    set((state) => {
      const countOfType = state.tracks.filter((t) => t.type === type).length + 1;
      const typeLabel =
        type === 'video'
          ? `Video Track V${countOfType}`
          : type === 'overlay'
            ? `Overlay Track O${countOfType}`
            : type === 'text'
              ? `Captions T${countOfType}`
              : `Audio Track A${countOfType}`;
      const newTrack: TimelineTrack = {
        id: `track_${type}_${Date.now().toString(36)}`,
        name: typeLabel,
        type,
        muted: false,
        hidden: false,
        locked: false,
      };
      return {
        ...pushHistory(state),
        tracks: [...state.tracks, newTrack],
      };
    }),

  toggleTrackMute: (trackId) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, muted: !t.muted } : t
      ),
    })),

  toggleTrackHidden: (trackId) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, hidden: !t.hidden } : t
      ),
    })),

  toggleTrackLock: (trackId) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, locked: !t.locked } : t
      ),
    })),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const previous = state.undoStack[state.undoStack.length - 1];
      const currentSnapshot = createSnapshot(state);
      return {
        projectName: previous.projectName,
        tracks: previous.tracks,
        clips: previous.clips,
        aspectRatio: previous.aspectRatio,
        canvasBackground: previous.canvasBackground,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, currentSnapshot],
        activeGestureSnapshot: null,
        hasUnsavedChanges: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      const currentSnapshot = createSnapshot(state);
      return {
        projectName: next.projectName,
        tracks: next.tracks,
        clips: next.clips,
        aspectRatio: next.aspectRatio,
        canvasBackground: next.canvasBackground,
        undoStack: [...state.undoStack, currentSnapshot],
        redoStack: state.redoStack.slice(0, -1),
        activeGestureSnapshot: null,
        hasUnsavedChanges: true,
      };
    }),

  updateExportSettings: (patch) =>
    set((state) => ({
      exportSettings: { ...state.exportSettings, ...patch },
      hasUnsavedChanges: true,
    })),

  setExportProgress: (exportProgress) =>
    set((state) => {
      if (exportProgress.status === 'error') {
        const incident = classifyFailureIncident(
          exportProgress.errorMessage || 'Video export failed',
          'FAILED_EXPORT'
        );
        return {
          exportProgress,
          activeFailureIncident: incident,
          errorBanner: `${incident.recoverySpec.title}: ${incident.customDetail}`,
        };
      }
      if (exportProgress.status === 'cancelled') {
        const incident = classifyFailureIncident(
          exportProgress.stageLabel || 'Export interrupted by user',
          'INTERRUPTED_PROCESSING'
        );
        return {
          exportProgress,
          activeFailureIncident: incident,
        };
      }
      return { exportProgress, activeFailureIncident: state.activeFailureIncident };
    }),

  saveCurrentProject: async (customTransactionCommit) => {
    // Mark as 'saving' BEFORE storage transaction begins; do NOT mark saved yet
    set({
      saveStatus: 'saving',
      saveError: null,
    });

    const state = get();
    const serialized: SerializedProject = {
      id: state.projectId,
      name: sanitizeProjectName(state.projectName),
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      updatedAt: Date.now(),
      aspectRatio: state.aspectRatio,
      canvasBackground: state.canvasBackground,
      tracks: state.tracks,
      clips: state.clips,
      assetsMetadata: state.assets.map((asset) => {
        const {
          objectUrl: _unusedUrl,
          thumbnailUrl: _unusedThumb,
          ...rest
        } = asset;
        void _unusedUrl;
        void _unusedThumb;
        return rest;
      }),
      editingSettings: {
        timelineZoom: state.timelineZoom,
        snapEnabled: state.snapEnabled,
        rippleDeleteEnabled: state.rippleDeleteEnabled,
        showSafeGuides: state.showSafeGuides,
        masterMuted: state.masterMuted,
        isLooping: state.isLooping,
        autoSaveEnabled: state.autoSaveEnabled,
        canvasZoom: state.canvasZoom,
        exportSettings: state.exportSettings,
      },
    };

    try {
      const result = await saveProjectToDb(serialized, customTransactionCommit);
      if (!result.persisted) {
        const errMsg =
          result.warning || 'Failed to save project to browser IndexedDB.';
        const incident = classifyFailureIncident(
          errMsg,
          result.quotaExceeded ? 'INSUFFICIENT_STORAGE' : 'INDEXEDDB_FAILURE'
        );
        set({
          saveStatus: 'failed',
          saveError: errMsg,
          errorBanner: errMsg,
          activeFailureIncident: incident,
        });
        return false;
      }

      const savedProjects = await listProjectsFromDb();
      set({
        saveStatus: 'saved',
        saveError: null,
        lastSavedAt: result.savedAt ?? Date.now(),
        hasUnsavedChanges: false,
        savedProjects,
      });
      return true;
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Storage transaction failed while saving project.';
      const incident = classifyFailureIncident(errMsg, 'INDEXEDDB_FAILURE');
      set({
        saveStatus: 'failed',
        saveError: errMsg,
        errorBanner: errMsg,
        activeFailureIncident: incident,
      });
      return false;
    }
  },

  refreshSavedProjects: async () => {
    const savedProjects = await listProjectsFromDb();
    set({ savedProjects });
  },

  loadSavedProject: async (id: string) => {
    try {
      const loaded = await loadProjectFromDb(id);
      if (!loaded) return false;
      const { project, hydratedAssets, missingAssetIds, warnings } = loaded;
      const settings = project.editingSettings;
      const savedProjects = await listProjectsFromDb();

      set({
        projectId: project.id,
        projectName: project.name,
        schemaVersion: project.schemaVersion ?? CURRENT_PROJECT_SCHEMA_VERSION,
        aspectRatio: project.aspectRatio,
        canvasBackground: project.canvasBackground,
        canvasZoom: settings?.canvasZoom ?? 'fit',
        tracks: project.tracks,
        clips: project.clips,
        assets:
          hydratedAssets.length > 0
            ? hydratedAssets
            : project.assetsMetadata.length === 0
              ? []
              : INITIAL_DEMO_ASSETS,
        selectedClipId: project.clips[0]?.id ?? null,
        playheadTime: 0,
        isPlaying: false,
        timelineZoom: settings?.timelineZoom ?? 68,
        snapEnabled: settings?.snapEnabled ?? true,
        rippleDeleteEnabled: settings?.rippleDeleteEnabled ?? false,
        showSafeGuides: settings?.showSafeGuides ?? false,
        masterMuted: settings?.masterMuted ?? false,
        isLooping: settings?.isLooping ?? true,
        autoSaveEnabled: settings?.autoSaveEnabled ?? true,
        exportSettings: settings?.exportSettings ?? get().exportSettings,
        hasUnsavedChanges: false,
        saveStatus: 'saved',
        saveError: null,
        lastSavedAt: project.updatedAt,
        savedProjects,
        missingMediaAssetIds: missingAssetIds,
        persistenceNotice:
          warnings.length > 0 ? warnings.join(' ') : null,
        undoStack: [],
        redoStack: [],
        activeGestureSnapshot: null,
      });
      return true;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to load saved project from IndexedDB.';
      set({
        saveStatus: 'failed',
        saveError: msg,
        errorBanner: msg,
      });
      return false;
    }
  },

  restoreLastSessionProject: async () => {
    try {
      const savedProjects = await listProjectsFromDb();
      set({ savedProjects });

      const lastActiveId = getLastActiveProjectId();
      const targetId =
        lastActiveId && savedProjects.some((p) => p.id === lastActiveId)
          ? lastActiveId
          : savedProjects[0]?.id ?? null;

      if (!targetId) return false;
      return await get().loadSavedProject(targetId);
    } catch {
      return false;
    }
  },

  renameProject: async (projectId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return false;

    const state = get();
    if (projectId === state.projectId) {
      set({
        ...pushHistory(state),
        projectName: trimmed,
      });
      // If this project is already persisted in IndexedDB, update it transactionally
      if (state.savedProjects.some((p) => p.id === projectId)) {
        return await get().saveCurrentProject();
      }
      return true;
    }

    try {
      const updated = await renameProjectInDb(projectId, trimmed);
      if (!updated) return false;
      const savedProjects = await listProjectsFromDb();
      set({
        savedProjects,
        persistenceNotice: `Renamed project to "${trimmed}".`,
      });
      return true;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to rename project.';
      set({ errorBanner: msg });
      return false;
    }
  },

  duplicateProject: async (sourceProjectId?: string, customName?: string) => {
    const state = get();
    try {
      let source: string | SerializedProject;
      if (!sourceProjectId || sourceProjectId === state.projectId) {
        source = {
          id: state.projectId,
          name: state.projectName,
          version: CURRENT_PROJECT_SCHEMA_VERSION,
          schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
          updatedAt: Date.now(),
          aspectRatio: state.aspectRatio,
          canvasBackground: state.canvasBackground,
          tracks: state.tracks,
          clips: state.clips,
          assetsMetadata: state.assets.map((asset) => {
            const {
              objectUrl: _unusedUrl,
              thumbnailUrl: _unusedThumb,
              ...rest
            } = asset;
            void _unusedUrl;
            void _unusedThumb;
            return rest;
          }),
          editingSettings: {
            timelineZoom: state.timelineZoom,
            snapEnabled: state.snapEnabled,
            rippleDeleteEnabled: state.rippleDeleteEnabled,
            showSafeGuides: state.showSafeGuides,
            masterMuted: state.masterMuted,
            isLooping: state.isLooping,
            autoSaveEnabled: state.autoSaveEnabled,
            canvasZoom: state.canvasZoom,
            exportSettings: state.exportSettings,
          },
        };
      } else {
        source = sourceProjectId;
      }

      const duplicated = await duplicateProjectInDb(source, customName);
      if (!duplicated) return null;

      const savedProjects = await listProjectsFromDb();
      set({
        savedProjects,
        persistenceNotice: `Created project copy "${duplicated.name}".`,
      });
      return duplicated;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to duplicate project in IndexedDB.';
      set({
        saveStatus: 'failed',
        saveError: msg,
        errorBanner: msg,
      });
      return null;
    }
  },

  deleteSavedProject: async (projectId: string) => {
    await deleteProjectFromDb(projectId);
    const savedProjects = await listProjectsFromDb();
    const state = get();
    if (state.projectId === projectId) {
      set({
        projectId: `proj_${Date.now().toString(36)}`,
        projectName: 'Untitled Video Project',
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        aspectRatio: '16:9',
        canvasBackground: '#090D16',
        tracks: structuredClone(INITIAL_TRACKS),
        clips: [],
        selectedClipId: null,
        playheadTime: 0,
        isPlaying: false,
        hasUnsavedChanges: false,
        saveStatus: 'idle',
        saveError: null,
        lastSavedAt: null,
        savedProjects,
        missingMediaAssetIds: [],
        persistenceNotice: 'Deleted active project and initialized a new blank workspace.',
        undoStack: [],
        redoStack: [],
        activeGestureSnapshot: null,
      });
    } else {
      set({
        savedProjects,
        persistenceNotice: 'Project deleted from local IndexedDB storage.',
      });
    }
  },

  clearAllLocalData: async () => {
    const state = get();
    for (const asset of state.assets) {
      void defaultMediaManager.releaseAssetResources(asset);
    }
    defaultMediaManager.revokeAllTrackedUrls();
    await clearAllLocalDataFromDb();
    set({
      projectId: `proj_${Date.now().toString(36)}`,
      projectName: 'Untitled Video Project',
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      tracks: structuredClone(INITIAL_TRACKS),
      clips: [],
      assets: [],
      selectedClipId: null,
      playheadTime: 0,
      isPlaying: false,
      hasUnsavedChanges: false,
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: null,
      savedProjects: [],
      missingMediaAssetIds: [],
      persistenceNotice:
        'All local project metadata and cached media blobs have been permanently deleted from browser storage.',
      undoStack: [],
      redoStack: [],
      activeGestureSnapshot: null,
    });
  },

  relinkMissingMediaAsset: async (assetId: string, file: File) => {
    if (!file || file.size === 0) return false;
    const objectUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : `blob:relinked-${assetId}`;

    const blobSave = await saveMediaBlobToDb(assetId, file);

    set((state) => {
      const updatedAssets = state.assets.map((a) =>
        a.id === assetId
          ? {
              ...a,
              name: file.name,
              sizeBytes: file.size,
              mimeType: file.type || a.mimeType,
              objectUrl,
              persistedInIdb: blobSave.persisted,
              isMissingMedia: false,
              storageWarning: blobSave.warning,
            }
          : a
      );
      const nextMissing = state.missingMediaAssetIds.filter(
        (id) => id !== assetId
      );
      return {
        assets: updatedAssets,
        missingMediaAssetIds: nextMissing,
        hasUnsavedChanges: true,
        persistenceNotice: `Relinked media file "${file.name}" successfully.`,
      };
    });

    await get().saveCurrentProject();
    return true;
  },

  setPersistenceNotice: (persistenceNotice) => set({ persistenceNotice }),

  createNewBlankProject: () =>
    set({
      projectId: `proj_${Date.now().toString(36)}`,
      projectName: 'Untitled Video Project',
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      tracks: structuredClone(INITIAL_TRACKS),
      clips: [],
      selectedClipId: null,
      playheadTime: 0,
      isPlaying: false,
      hasUnsavedChanges: false,
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: null,
      missingMediaAssetIds: [],
      undoStack: [],
      redoStack: [],
      activeGestureSnapshot: null,
    }),

  resetToDemoProject: () =>
    set({
      projectId: 'proj_default_studio',
      projectName: 'Studio Reel 01 — Product Sequence',
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      tracks: structuredClone(INITIAL_TRACKS),
      clips: structuredClone(INITIAL_DEMO_CLIPS),
      assets: structuredClone(INITIAL_DEMO_ASSETS),
      selectedClipId: 'clip_demo_v1',
      playheadTime: 1.2,
      isPlaying: false,
      hasUnsavedChanges: false,
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: null,
      missingMediaAssetIds: [],
      persistenceNotice: null,
      errorBanner: null,
      undoStack: [],
      redoStack: [],
      activeGestureSnapshot: null,
    }),
}));
