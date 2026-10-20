export type MediaType = 'video' | 'audio' | 'image';

export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:5';

export interface AspectRatioDimensions {
  ratio: AspectRatioPreset;
  label: string;
  width: number;
  height: number;
  description: string;
}

export const ASPECT_RATIO_PRESETS: Record<AspectRatioPreset, AspectRatioDimensions> = {
  '16:9': {
    ratio: '16:9',
    label: '16:9 Widescreen',
    width: 1920,
    height: 1080,
    description: 'YouTube, Desktop & Standard HD',
  },
  '9:16': {
    ratio: '9:16',
    label: '9:16 Vertical',
    width: 1080,
    height: 1920,
    description: 'Shorts, Reels & Mobile Stories',
  },
  '1:1': {
    ratio: '1:1',
    label: '1:1 Square',
    width: 1080,
    height: 1080,
    description: 'Social Feed & Carousel Square',
  },
  '4:5': {
    ratio: '4:5',
    label: '4:5 Portrait',
    width: 1080,
    height: 1350,
    description: 'Editorial Portrait Feed',
  },
};

export interface MediaAsset {
  id: string;
  fingerprint: string; // deterministic hash from name + sizeBytes + lastModified for duplicate detection
  name: string;
  type: MediaType;
  mimeType: string;
  sizeBytes: number;
  lastModified?: number;
  duration: number; // in seconds
  width?: number;
  height?: number;
  rotationMetadata?: 0 | 90 | 180 | 270; // intrinsic container rotation metadata (e.g., mobile portrait MOV/MP4)
  objectUrl: string;
  thumbnailUrl?: string;
  waveformPeaks: number[]; // normalized 0..1 array for timeline rendering
  createdAt: number;
  isSyntheticSample?: boolean;
  persistedInIdb?: boolean;
  isMissingMedia?: boolean;
  storageWarning?: string;
}

export type DuplicatePolicy = 'skip' | 'allow' | 'replace';

export interface MediaImportError {
  fileName: string;
  code: 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'METADATA_FAILED' | 'ABORTED';
  message: string;
}

export interface MediaImportProgress {
  totalFiles: number;
  completedFiles: number;
  currentFileName: string;
  stage: 'validating' | 'probing' | 'thumbnail' | 'waveform' | 'storing';
}

export interface MediaImportBatchResult {
  imported: MediaAsset[];
  duplicatesSkipped: string[];
  errors: MediaImportError[];
  storageWarnings: string[];
  cancelled: boolean;
}

export interface StorageQuotaEstimate {
  usageBytes: number;
  quotaBytes: number;
  availableBytes: number;
  usageRatio: number;
}

export interface VideoFilterState {
  brightness: number; // 0 to 200, default 100
  contrast: number;   // 0 to 200, default 100
  saturation: number; // 0 to 200, default 100
  hueRotate: number;  // -180 to 180, default 0
  blur: number;       // 0 to 20px, default 0
  sepia: number;      // 0 to 100, default 0
  opacity: number;    // 0 to 100, default 100
}

export const DEFAULT_VIDEO_FILTERS: VideoFilterState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hueRotate: 0,
  blur: 0,
  sepia: 0,
  opacity: 100,
};

export interface CropSettings {
  top: number;    // percentage 0..45
  bottom: number; // percentage 0..45
  left: number;   // percentage 0..45
  right: number;  // percentage 0..45
}

export const DEFAULT_CROP_SETTINGS: CropSettings = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

export type TransitionType = 'none' | 'crossfade' | 'dip-to-black' | 'dip-to-white' | 'zoom-in';

export interface ClipTransform {
  scale: number;     // 0.25 to 3, default 1
  rotation: number;  // 0 to 360 degrees
  flipH: boolean;
  flipV: boolean;
  x: number;         // normalized offset -1..1
  y: number;         // normalized offset -1..1
  fitMode: 'contain' | 'cover' | 'fill';
  crop?: CropSettings;
}

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  scale: 1,
  rotation: 0,
  flipH: false,
  flipV: false,
  x: 0,
  y: 0,
  fitMode: 'contain',
  crop: { ...DEFAULT_CROP_SETTINGS },
};

export type TextAnimationPreset =
  | 'none'
  | 'fade-in-out'
  | 'slide-up'
  | 'pop-in'
  | 'typewriter';

export interface TextOverlayStyle {
  text: string;
  fontFamily: string;
  fontSize: number;      // in canvas reference pixels (1080p vertical ref), e.g., 56
  fontWeight: number;    // 400, 600, 700, 800
  color: string;         // hex e.g. #FFFFFF
  backgroundColor: string; // hex with alpha, rgba, or 'transparent'
  textAlign: 'left' | 'center' | 'right';
  x: number;             // normalized 0..1 (0.5 center)
  y: number;             // normalized 0..1 (0.85 bottom caption)
  rotation?: number;     // -180 to 180 degrees, default 0
  outlineColor: string;
  outlineWidth: number;
  animation?: TextAnimationPreset;
  keepWithinCanvas?: boolean;
  isSubtitle?: boolean;
}

export type TrackType = 'video' | 'overlay' | 'text' | 'audio';

export interface TimelineClip {
  id: string;
  trackId: string;
  trackType: TrackType;
  assetId: string | null; // null for pure text clips
  label: string;
  startTime: number;      // timeline position in seconds
  duration: number;       // timeline duration in seconds
  inPoint: number;        // source media start offset in seconds
  outPoint: number;       // source media end offset in seconds
  playbackRate: number;   // 0.25 to 4.0, default 1.0
  volume: number;         // 0 to 100, default 100
  muted: boolean;
  fadeIn: number;         // seconds
  fadeOut: number;        // seconds
  transitionType?: TransitionType;
  filters: VideoFilterState;
  transform: ClipTransform;
  textStyle?: TextOverlayStyle;
  colorTag?: string;
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export type ExportFormat = 'mp4' | 'webm' | 'gif';
export type ExportResolution = '1080p' | '720p' | '480p';
export type ExportEngineMode = 'auto' | 'ffmpeg-wasm' | 'native-stream';
export type AudioBitratePreset = '128k' | '192k' | '320k';

export interface ExportSettings {
  format: ExportFormat;
  resolution: ExportResolution;
  fps: 24 | 30 | 60;
  quality: 'high' | 'balanced' | 'fast';
  engine: ExportEngineMode;
  filename: string;
  audioBitrate?: AudioBitratePreset;
  removeAudio?: boolean;
}

export interface ExportProgress {
  status: 'idle' | 'initializing' | 'rendering' | 'encoding' | 'completed' | 'cancelled' | 'error';
  progress: number; // 0 to 100
  currentFrame?: number;
  totalFrames?: number;
  stageLabel: string;
  engineUsed?: 'ffmpeg-wasm' | 'native-stream';
  outputFormat?: ExportFormat;
  codecSummary?: string;
  hasAudio?: boolean;
  memoryUsedMb?: number;
  fallbackWarning?: string;
  outputUrl?: string;
  outputSizeBytes?: number;
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
}

export type ProjectSaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface ProjectEditingSettings {
  timelineZoom: number;
  snapEnabled: boolean;
  rippleDeleteEnabled: boolean;
  showSafeGuides: boolean;
  masterMuted: boolean;
  isLooping: boolean;
  autoSaveEnabled: boolean;
  canvasZoom?: 'fit' | 50 | 75 | 100 | 125 | 150;
  exportSettings: ExportSettings;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  aspectRatio: AspectRatioPreset;
  duration: number;
  clipCount: number;
  assetCount: number;
  schemaVersion?: number;
  missingMediaCount?: number;
}

export interface SerializedProject {
  id: string;
  name: string;
  version: number;
  schemaVersion?: number;
  updatedAt: number;
  aspectRatio: AspectRatioPreset;
  canvasBackground: string;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assetsMetadata: Omit<MediaAsset, 'objectUrl' | 'thumbnailUrl'>[];
  editingSettings?: ProjectEditingSettings;
}
