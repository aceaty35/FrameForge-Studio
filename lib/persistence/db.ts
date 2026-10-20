import { openDB, IDBPDatabase } from 'idb';
import {
  ASPECT_RATIO_PRESETS,
  AspectRatioPreset,
  ClipTransform,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CROP_SETTINGS,
  DEFAULT_VIDEO_FILTERS,
  MediaAsset,
  ProjectEditingSettings,
  ProjectSummary,
  SerializedProject,
  StorageQuotaEstimate,
  TimelineClip,
  TimelineTrack,
  TrackType,
  VideoFilterState,
} from '@/types/editor';
import { calculateProjectDuration } from '@/lib/timeline/engine';

const DB_NAME = 'frameforge_studio_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_MEDIA_BLOBS = 'media_blobs';

export const CURRENT_PROJECT_SCHEMA_VERSION = 2;
export const LAST_ACTIVE_PROJECT_KEY = 'frameforge_last_active_project_id';

/**
 * Maximum single Blob size persisted into IndexedDB (120 MB).
 * Larger files remain active via zero-copy in-memory File ObjectURLs for the current session
 * to avoid exhausting browser IndexedDB quota.
 */
export const MAX_IDB_BLOB_SIZE_BYTES = 120 * 1024 * 1024;

export const DEFAULT_PROJECT_EDITING_SETTINGS: ProjectEditingSettings = {
  timelineZoom: 68,
  snapEnabled: true,
  rippleDeleteEnabled: false,
  showSafeGuides: false,
  masterMuted: false,
  isLooping: true,
  autoSaveEnabled: true,
  canvasZoom: 'fit',
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
};

export const FALLBACK_RECOVERY_TRACKS: TimelineTrack[] = [
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

interface FrameForgeDB {
  projects: {
    key: string;
    value: SerializedProject;
  };
  media_blobs: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      updatedAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<FrameForgeDB>> | null = null;

// Fallback transactional in-memory store used when IndexedDB is unavailable (e.g., headless test runner or restricted sandbox)
const memoryProjectsStore = new Map<string, SerializedProject>();
const memoryMediaBlobsStore = new Map<
  string,
  { id: string; blob: Blob; updatedAt: number }
>();
let memoryLastActiveProjectId: string | null = null;
let simulatedDbError: Error | null = null;

export function resetInMemoryDbForTests(): void {
  memoryProjectsStore.clear();
  memoryMediaBlobsStore.clear();
  memoryLastActiveProjectId = null;
  simulatedDbError = null;
}

export function setSimulatedDbErrorForTests(err: Error | null): void {
  simulatedDbError = err;
}

function hasNativeIndexedDb(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof indexedDB !== 'undefined' &&
    indexedDB !== null
  );
}

function getDb(): Promise<IDBPDatabase<FrameForgeDB>> {
  if (!hasNativeIndexedDb()) {
    return Promise.reject(
      new Error('IndexedDB is only available in browser environments')
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<FrameForgeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_MEDIA_BLOBS)) {
          db.createObjectStore(STORE_MEDIA_BLOBS, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export function getLastActiveProjectId(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(LAST_ACTIVE_PROJECT_KEY) || memoryLastActiveProjectId;
    }
  } catch {
    // Ignore storage access errors in restricted iframes
  }
  return memoryLastActiveProjectId;
}

export function setLastActiveProjectId(projectId: string | null): void {
  memoryLastActiveProjectId = projectId;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (projectId) {
        window.localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, projectId);
      } else {
        window.localStorage.removeItem(LAST_ACTIVE_PROJECT_KEY);
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Detects whether an unknown error thrown by IndexedDB is a storage quota exhaustion error.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const domErr = err as { name?: string; code?: number; message?: string };
  if (
    domErr.name === 'QuotaExceededError' ||
    domErr.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    domErr.code === 22 ||
    domErr.code === 1014
  ) {
    return true;
  }
  if (
    typeof domErr.message === 'string' &&
    /quota|storage full|insufficient.*space/i.test(domErr.message)
  ) {
    return true;
  }
  return false;
}

/**
 * Queries the browser StorageManager API for current usage and available quota.
 */
export async function getStorageQuotaEstimate(): Promise<StorageQuotaEstimate | null> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usageBytes = estimate.usage ?? 0;
    const quotaBytes = estimate.quota ?? 0;
    if (quotaBytes <= 0) return null;
    const availableBytes = Math.max(0, quotaBytes - usageBytes);
    return {
      usageBytes,
      quotaBytes,
      availableBytes,
      usageRatio: Number((usageBytes / quotaBytes).toFixed(4)),
    };
  } catch {
    return null;
  }
}

export interface SaveBlobResult {
  persisted: boolean;
  savedAt?: number;
  quotaExceeded?: boolean;
  warning?: string;
}

export interface SchemaMigrationResult {
  migrated: Record<string, unknown>;
  fromVersion: number;
  toVersion: number;
  migratedFields: string[];
}

/**
 * Migrates older or unversioned project records to CURRENT_PROJECT_SCHEMA_VERSION (v2).
 * Preserves all timeline structure, clip source in/out points, transforms, and text/audio settings.
 */
export function migrateProjectSchema(raw: unknown): SchemaMigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      migrated: {},
      fromVersion: 0,
      toVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      migratedFields: [],
    };
  }

  const record = { ...(raw as Record<string, unknown>) };
  const rawSchemaVersion =
    typeof record.schemaVersion === 'number'
      ? record.schemaVersion
      : typeof record.version === 'number'
        ? record.version
        : 0;

  const migratedFields: string[] = [];

  if (rawSchemaVersion < 1) {
    if (!record.aspectRatio) {
      record.aspectRatio = '16:9';
      migratedFields.push('aspectRatio');
    }
    if (!record.canvasBackground) {
      record.canvasBackground = '#090D16';
      migratedFields.push('canvasBackground');
    }
    if (!Array.isArray(record.assetsMetadata)) {
      record.assetsMetadata = [];
      migratedFields.push('assetsMetadata');
    }
  }

  if (rawSchemaVersion < 2) {
    record.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
    record.version = CURRENT_PROJECT_SCHEMA_VERSION;
    migratedFields.push('schemaVersion');

    const existingSettings =
      record.editingSettings && typeof record.editingSettings === 'object'
        ? (record.editingSettings as Partial<ProjectEditingSettings>)
        : {};

    record.editingSettings = {
      ...DEFAULT_PROJECT_EDITING_SETTINGS,
      ...existingSettings,
      exportSettings: {
        ...DEFAULT_PROJECT_EDITING_SETTINGS.exportSettings,
        ...(existingSettings.exportSettings ?? {}),
      },
    };
    migratedFields.push('editingSettings');

    // Upgrade legacy clips missing v2 transform.crop, filters, or audio envelope fields
    if (Array.isArray(record.clips)) {
      record.clips = record.clips.map((c) => {
        if (!c || typeof c !== 'object') return c;
        const clipObj = { ...(c as Record<string, unknown>) };
        if (typeof clipObj.inPoint !== 'number') {
          clipObj.inPoint = 0;
          migratedFields.push('clips.inPoint');
        }
        if (typeof clipObj.outPoint !== 'number') {
          const dur = typeof clipObj.duration === 'number' ? clipObj.duration : 3;
          clipObj.outPoint = (clipObj.inPoint as number) + dur;
          migratedFields.push('clips.outPoint');
        }
        if (typeof clipObj.playbackRate !== 'number') {
          clipObj.playbackRate = 1;
          migratedFields.push('clips.playbackRate');
        }
        if (typeof clipObj.volume !== 'number') {
          clipObj.volume = 100;
          migratedFields.push('clips.volume');
        }
        if (typeof clipObj.muted !== 'boolean') {
          clipObj.muted = false;
        }
        if (typeof clipObj.fadeIn !== 'number') {
          clipObj.fadeIn = 0;
        }
        if (typeof clipObj.fadeOut !== 'number') {
          clipObj.fadeOut = 0;
        }
        const rawTransform =
          clipObj.transform && typeof clipObj.transform === 'object'
            ? (clipObj.transform as Partial<ClipTransform>)
            : {};
        clipObj.transform = {
          ...DEFAULT_CLIP_TRANSFORM,
          ...rawTransform,
          crop: {
            ...DEFAULT_CROP_SETTINGS,
            ...(rawTransform.crop ?? {}),
          },
        };
        const rawFilters =
          clipObj.filters && typeof clipObj.filters === 'object'
            ? (clipObj.filters as Partial<VideoFilterState>)
            : {};
        clipObj.filters = {
          ...DEFAULT_VIDEO_FILTERS,
          ...rawFilters,
        };
        return clipObj;
      });
    }
  }

  return {
    migrated: record,
    fromVersion: rawSchemaVersion,
    toVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    migratedFields: Array.from(new Set(migratedFields)),
  };
}

export interface ProjectValidationAndRecoveryResult {
  valid: boolean;
  project: SerializedProject | null;
  errors: string[];
  warnings: string[];
  migratedFromVersion: number;
}

const VALID_TRACK_TYPES: TrackType[] = ['video', 'overlay', 'text', 'audio'];

/**
 * Validates restored project data and automatically repairs recoverable anomalies
 * (such as invalid aspect ratios, negative timestamps, missing tracks, or orphaned clips).
 */
export function validateAndRecoverProjectData(
  raw: unknown
): ProjectValidationAndRecoveryResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      project: null,
      errors: ['Project data must be a non-null JSON object.'],
      warnings: [],
      migratedFromVersion: 0,
    };
  }

  const { migrated, fromVersion, migratedFields } = migrateProjectSchema(raw);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (fromVersion < CURRENT_PROJECT_SCHEMA_VERSION && migratedFields.length > 0) {
    warnings.push(
      `Migrated project schema from v${fromVersion} to v${CURRENT_PROJECT_SCHEMA_VERSION} (${migratedFields.join(', ')}).`
    );
  }

  const rawId = typeof migrated.id === 'string' ? migrated.id.trim() : '';
  if (!rawId) {
    return {
      valid: false,
      project: null,
      errors: ['Project record is missing a valid string "id".'],
      warnings,
      migratedFromVersion: fromVersion,
    };
  }

  let name = typeof migrated.name === 'string' ? migrated.name.trim() : '';
  if (!name) {
    name = 'Recovered Video Project';
    warnings.push('Project name was empty or invalid; restored as "Recovered Video Project".');
  }

  const rawRatio = migrated.aspectRatio as AspectRatioPreset;
  let aspectRatio: AspectRatioPreset = '16:9';
  if (rawRatio && rawRatio in ASPECT_RATIO_PRESETS) {
    aspectRatio = rawRatio;
  } else {
    warnings.push(
      `Invalid aspect ratio "${String(migrated.aspectRatio)}"; defaulted to 16:9.`
    );
  }

  const canvasBackground =
    typeof migrated.canvasBackground === 'string' &&
    migrated.canvasBackground.trim().length > 0
      ? migrated.canvasBackground.trim()
      : '#090D16';

  // Validate tracks
  const validTracks: TimelineTrack[] = [];
  if (Array.isArray(migrated.tracks)) {
    for (const t of migrated.tracks) {
      if (t && typeof t === 'object') {
        const trackObj = t as Record<string, unknown>;
        const id = typeof trackObj.id === 'string' ? trackObj.id.trim() : '';
        const type = VALID_TRACK_TYPES.includes(trackObj.type as TrackType)
          ? (trackObj.type as TrackType)
          : 'video';
        if (id) {
          validTracks.push({
            id,
            name:
              typeof trackObj.name === 'string' && trackObj.name.trim()
                ? trackObj.name.trim()
                : `Track ${id}`,
            type,
            muted: Boolean(trackObj.muted),
            hidden: Boolean(trackObj.hidden),
            locked: Boolean(trackObj.locked),
          });
        }
      }
    }
  }

  if (validTracks.length === 0) {
    validTracks.push(...structuredClone(FALLBACK_RECOVERY_TRACKS));
    warnings.push(
      'Track configuration was empty or corrupted; restored standard studio tracks.'
    );
  }

  const trackIds = new Set(validTracks.map((t) => t.id));

  // Validate clips
  const validClips: TimelineClip[] = [];
  if (Array.isArray(migrated.clips)) {
    for (const rawClip of migrated.clips) {
      if (!rawClip || typeof rawClip !== 'object') {
        warnings.push('Skipped corrupted non-object clip entry.');
        continue;
      }
      const c = rawClip as Record<string, unknown>;
      const clipId = typeof c.id === 'string' ? c.id.trim() : '';
      if (!clipId) {
        warnings.push('Skipped clip entry missing an ID.');
        continue;
      }

      const trackType: TrackType = VALID_TRACK_TYPES.includes(c.trackType as TrackType)
        ? (c.trackType as TrackType)
        : 'video';

      let trackId = typeof c.trackId === 'string' ? c.trackId : '';
      if (!trackIds.has(trackId)) {
        // Recover orphaned clip by attaching to a matching track type or creating one
        let fallbackTrack = validTracks.find((t) => t.type === trackType);
        if (!fallbackTrack) {
          fallbackTrack = {
            id: `track_${trackType}_recovered`,
            name: `Recovered ${trackType.toUpperCase()} Track`,
            type: trackType,
            muted: false,
            hidden: false,
            locked: false,
          };
          validTracks.push(fallbackTrack);
          trackIds.add(fallbackTrack.id);
        }
        trackId = fallbackTrack.id;
        warnings.push(
          `Clip "${clipId}" referenced missing track "${String(c.trackId)}"; reattached to "${trackId}".`
        );
      }

      let startTime = Number(c.startTime);
      if (!Number.isFinite(startTime) || startTime < 0) {
        startTime = 0;
        warnings.push(`Clip "${clipId}" had invalid startTime; clamped to 0s.`);
      }

      let inPoint = Number(c.inPoint);
      if (!Number.isFinite(inPoint) || inPoint < 0) {
        inPoint = 0;
        warnings.push(`Clip "${clipId}" had invalid source inPoint; reset to 0s.`);
      }

      let duration = Number(c.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        const candidateSpan = Number(c.outPoint) - inPoint;
        duration = Number.isFinite(candidateSpan) && candidateSpan > 0 ? candidateSpan : 2.0;
        warnings.push(
          `Clip "${clipId}" had non-positive duration; recovered to ${duration.toFixed(2)}s.`
        );
      }

      let playbackRate = Number(c.playbackRate);
      if (!Number.isFinite(playbackRate) || playbackRate < 0.25 || playbackRate > 4) {
        playbackRate = 1;
        warnings.push(`Clip "${clipId}" had out-of-range playbackRate; reset to 1.0x.`);
      }

      let outPoint = Number(c.outPoint);
      if (!Number.isFinite(outPoint) || outPoint <= inPoint) {
        outPoint = Number((inPoint + duration * playbackRate).toFixed(4));
        warnings.push(
          `Clip "${clipId}" had invalid source outPoint; recalculated to ${outPoint}s.`
        );
      }

      const volume = Number.isFinite(Number(c.volume))
        ? Math.max(0, Math.min(100, Number(c.volume)))
        : 100;

      const fadeIn =
        Number.isFinite(Number(c.fadeIn)) && Number(c.fadeIn) >= 0
          ? Number(c.fadeIn)
          : 0;
      const fadeOut =
        Number.isFinite(Number(c.fadeOut)) && Number(c.fadeOut) >= 0
          ? Number(c.fadeOut)
          : 0;

      const rawTransform =
        c.transform && typeof c.transform === 'object'
          ? (c.transform as Partial<ClipTransform>)
          : {};
      const transform: ClipTransform = {
        scale:
          Number.isFinite(Number(rawTransform.scale)) && Number(rawTransform.scale) > 0
            ? Number(rawTransform.scale)
            : 1,
        rotation: Number.isFinite(Number(rawTransform.rotation))
          ? Number(rawTransform.rotation)
          : 0,
        flipH: Boolean(rawTransform.flipH),
        flipV: Boolean(rawTransform.flipV),
        x: Number.isFinite(Number(rawTransform.x)) ? Number(rawTransform.x) : 0,
        y: Number.isFinite(Number(rawTransform.y)) ? Number(rawTransform.y) : 0,
        fitMode:
          rawTransform.fitMode === 'cover' || rawTransform.fitMode === 'fill'
            ? rawTransform.fitMode
            : 'contain',
        crop: {
          top: Number.isFinite(Number(rawTransform.crop?.top))
            ? Number(rawTransform.crop?.top)
            : 0,
          bottom: Number.isFinite(Number(rawTransform.crop?.bottom))
            ? Number(rawTransform.crop?.bottom)
            : 0,
          left: Number.isFinite(Number(rawTransform.crop?.left))
            ? Number(rawTransform.crop?.left)
            : 0,
          right: Number.isFinite(Number(rawTransform.crop?.right))
            ? Number(rawTransform.crop?.right)
            : 0,
        },
      };

      const rawFilters =
        c.filters && typeof c.filters === 'object'
          ? (c.filters as Partial<VideoFilterState>)
          : {};
      const filters: VideoFilterState = {
        ...DEFAULT_VIDEO_FILTERS,
        ...rawFilters,
      };

      validClips.push({
        id: clipId,
        trackId,
        trackType,
        assetId: typeof c.assetId === 'string' && c.assetId.trim() ? c.assetId : null,
        label:
          typeof c.label === 'string' && c.label.trim()
            ? c.label.trim()
            : `Clip ${clipId}`,
        startTime,
        duration,
        inPoint,
        outPoint,
        playbackRate,
        volume,
        muted: Boolean(c.muted),
        fadeIn,
        fadeOut,
        transitionType: (c.transitionType as TimelineClip['transitionType']) ?? 'none',
        filters,
        transform,
        textStyle: c.textStyle as TimelineClip['textStyle'],
        colorTag: typeof c.colorTag === 'string' ? c.colorTag : undefined,
      });
    }
  }

  // Validate assetsMetadata
  const validAssetsMeta: Omit<MediaAsset, 'objectUrl' | 'thumbnailUrl'>[] = [];
  if (Array.isArray(migrated.assetsMetadata)) {
    for (const rawAsset of migrated.assetsMetadata) {
      if (!rawAsset || typeof rawAsset !== 'object') continue;
      const a = rawAsset as Record<string, unknown>;
      const id = typeof a.id === 'string' ? a.id.trim() : '';
      if (!id) continue;
      validAssetsMeta.push({
        id,
        fingerprint:
          typeof a.fingerprint === 'string' ? a.fingerprint : `${id}::0::0`,
        name: typeof a.name === 'string' && a.name.trim() ? a.name : `Asset_${id}`,
        type:
          a.type === 'video' || a.type === 'audio' || a.type === 'image'
            ? a.type
            : 'video',
        mimeType:
          typeof a.mimeType === 'string' ? a.mimeType : 'application/octet-stream',
        sizeBytes: Number.isFinite(Number(a.sizeBytes)) ? Number(a.sizeBytes) : 0,
        lastModified: Number.isFinite(Number(a.lastModified))
          ? Number(a.lastModified)
          : undefined,
        duration:
          Number.isFinite(Number(a.duration)) && Number(a.duration) > 0
            ? Number(a.duration)
            : 5,
        width: Number.isFinite(Number(a.width)) ? Number(a.width) : undefined,
        height: Number.isFinite(Number(a.height)) ? Number(a.height) : undefined,
        rotationMetadata: (a.rotationMetadata as MediaAsset['rotationMetadata']) ?? 0,
        waveformPeaks: Array.isArray(a.waveformPeaks)
          ? (a.waveformPeaks as number[])
          : [0.4, 0.6, 0.5, 0.7],
        createdAt: Number.isFinite(Number(a.createdAt))
          ? Number(a.createdAt)
          : Date.now(),
        isSyntheticSample: Boolean(a.isSyntheticSample),
        persistedInIdb: Boolean(a.persistedInIdb),
        isMissingMedia: Boolean(a.isMissingMedia),
        storageWarning:
          typeof a.storageWarning === 'string' ? a.storageWarning : undefined,
      });
    }
  }

  const rawEditingSettings =
    migrated.editingSettings && typeof migrated.editingSettings === 'object'
      ? (migrated.editingSettings as Partial<ProjectEditingSettings>)
      : {};

  const editingSettings: ProjectEditingSettings = {
    ...DEFAULT_PROJECT_EDITING_SETTINGS,
    ...rawEditingSettings,
    exportSettings: {
      ...DEFAULT_PROJECT_EDITING_SETTINGS.exportSettings,
      ...(rawEditingSettings.exportSettings ?? {}),
    },
  };

  const validatedProject: SerializedProject = {
    id: rawId,
    name,
    version: CURRENT_PROJECT_SCHEMA_VERSION,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    updatedAt: Number.isFinite(Number(migrated.updatedAt))
      ? Number(migrated.updatedAt)
      : Date.now(),
    aspectRatio,
    canvasBackground,
    tracks: validTracks,
    clips: validClips,
    assetsMetadata: validAssetsMeta,
    editingSettings,
  };

  return {
    valid: true,
    project: validatedProject,
    errors,
    warnings,
    migratedFromVersion: fromVersion,
  };
}

/**
 * Persists a media Blob in IndexedDB only when appropriate (within size & available quota bounds).
 * Gracefully catches QuotaExceededError and explains why local storage was skipped.
 */
export async function saveMediaBlobToDb(
  assetId: string,
  blob: Blob,
  customDbPut?: (id: string, blob: Blob) => Promise<void>
): Promise<SaveBlobResult> {
  if (blob.size > MAX_IDB_BLOB_SIZE_BYTES) {
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    return {
      persisted: false,
      warning: `File (${sizeMb} MB) exceeds the 120 MB local IndexedDB cache threshold. It is active for this session via an in-memory Object URL, but will need to be re-selected if you reload the browser tab.`,
    };
  }

  const quota = await getStorageQuotaEstimate();
  if (quota && quota.availableBytes > 0 && blob.size * 1.15 > quota.availableBytes) {
    const availMb = (quota.availableBytes / (1024 * 1024)).toFixed(1);
    return {
      persisted: false,
      quotaExceeded: true,
      warning: `Browser local storage has only ${availMb} MB available, which is insufficient to cache this file offline. The clip remains ready for editing in memory for this session.`,
    };
  }

  try {
    if (simulatedDbError) {
      throw simulatedDbError;
    }
    if (customDbPut) {
      await customDbPut(assetId, blob);
    } else if (hasNativeIndexedDb()) {
      const db = await getDb();
      const tx = db.transaction(STORE_MEDIA_BLOBS, 'readwrite');
      await tx.store.put({
        id: assetId,
        blob,
        updatedAt: Date.now(),
      });
      await tx.done;
    } else {
      memoryMediaBlobsStore.set(assetId, {
        id: assetId,
        blob,
        updatedAt: Date.now(),
      });
    }
    return { persisted: true, savedAt: Date.now() };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return {
        persisted: false,
        quotaExceeded: true,
        warning:
          'Browser IndexedDB storage quota was exceeded while caching this media file. The file remains loaded in memory for editing, or you can remove older cached projects to free local disk space.',
      };
    }
    return {
      persisted: false,
      warning:
        'Local IndexedDB storage is unavailable in this browser context (e.g., private browsing restriction). Media is active in session memory only.',
    };
  }
}

export async function loadMediaBlobFromDb(assetId: string): Promise<Blob | null> {
  try {
    if (hasNativeIndexedDb()) {
      const db = await getDb();
      const record = await db.get(STORE_MEDIA_BLOBS, assetId);
      return record?.blob ?? null;
    }
    return memoryMediaBlobsStore.get(assetId)?.blob ?? null;
  } catch {
    return memoryMediaBlobsStore.get(assetId)?.blob ?? null;
  }
}

export async function deleteMediaBlobFromDb(assetId: string): Promise<void> {
  memoryMediaBlobsStore.delete(assetId);
  try {
    if (hasNativeIndexedDb()) {
      const db = await getDb();
      const tx = db.transaction(STORE_MEDIA_BLOBS, 'readwrite');
      await tx.store.delete(assetId);
      await tx.done;
    }
  } catch {
    // Ignore if IndexedDB is unavailable
  }
}

export async function clearAllMediaBlobsFromDb(): Promise<void> {
  memoryMediaBlobsStore.clear();
  try {
    if (hasNativeIndexedDb()) {
      const db = await getDb();
      const tx = db.transaction(STORE_MEDIA_BLOBS, 'readwrite');
      await tx.store.clear();
      await tx.done;
    }
  } catch {
    // Ignore
  }
}

/**
 * Saves a project snapshot to IndexedDB inside an explicit readwrite transaction.
 * Does NOT resolve as persisted until the storage transaction has committed.
 */
export async function saveProjectToDb(
  project: SerializedProject,
  customTransactionCommit?: (record: SerializedProject) => Promise<void>
): Promise<SaveBlobResult> {
  const validation = validateAndRecoverProjectData(project);
  if (!validation.valid || !validation.project) {
    return {
      persisted: false,
      warning:
        validation.errors[0] ||
        'Project validation failed before saving to IndexedDB.',
    };
  }

  const savedAt = Date.now();
  const recordToPersist: SerializedProject = {
    ...validation.project,
    version: CURRENT_PROJECT_SCHEMA_VERSION,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    updatedAt: savedAt,
  };

  try {
    if (simulatedDbError) {
      throw simulatedDbError;
    }
    if (customTransactionCommit) {
      await customTransactionCommit(recordToPersist);
    } else if (hasNativeIndexedDb()) {
      const db = await getDb();
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      await tx.store.put(recordToPersist);
      await tx.done;
    } else {
      memoryProjectsStore.set(
        recordToPersist.id,
        structuredClone(recordToPersist)
      );
    }

    setLastActiveProjectId(recordToPersist.id);
    return { persisted: true, savedAt };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return {
        persisted: false,
        quotaExceeded: true,
        warning:
          'Cannot save project snapshot: Browser IndexedDB storage quota is full. Delete unused saved projects or clear cached media to free space.',
      };
    }
    return {
      persisted: false,
      warning:
        err instanceof Error
          ? err.message
          : 'Storage transaction failed while saving project.',
    };
  }
}

export interface LoadedProjectBundle {
  project: SerializedProject;
  hydratedAssets: MediaAsset[];
  missingAssetIds: string[];
  warnings: string[];
  migratedFromVersion: number;
}

/**
 * Loads, migrates, validates, and hydrates a project from IndexedDB.
 * Detects any missing media blobs and flags them with isMissingMedia = true.
 */
export async function loadProjectFromDb(
  projectId: string
): Promise<LoadedProjectBundle | null> {
  let rawRecord: SerializedProject | undefined;

  if (hasNativeIndexedDb()) {
    try {
      const db = await getDb();
      rawRecord = await db.get(STORE_PROJECTS, projectId);
    } catch {
      rawRecord = memoryProjectsStore.get(projectId);
    }
  } else {
    rawRecord = memoryProjectsStore.get(projectId);
  }

  if (!rawRecord) return null;

  const validation = validateAndRecoverProjectData(rawRecord);
  if (!validation.valid || !validation.project) {
    throw new Error(
      `Failed to restore project "${projectId}": ${validation.errors.join(' ')}`
    );
  }

  const { project, warnings, migratedFromVersion } = validation;
  const hydratedAssets: MediaAsset[] = [];
  const missingAssetIds: string[] = [];
  const knownAssetIds = new Set<string>();

  for (const meta of project.assetsMetadata) {
    knownAssetIds.add(meta.id);
    const blob = await loadMediaBlobFromDb(meta.id);
    if (blob) {
      const objectUrl =
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : `blob:hydrated-${meta.id}`;
      hydratedAssets.push({
        ...meta,
        objectUrl,
        persistedInIdb: true,
        isMissingMedia: false,
      });
    } else if (meta.isSyntheticSample) {
      // Built-in procedural/synthetic samples render directly without external file blobs
      hydratedAssets.push({
        ...meta,
        objectUrl: '',
        persistedInIdb: true,
        isMissingMedia: false,
      });
    } else {
      missingAssetIds.push(meta.id);
      hydratedAssets.push({
        ...meta,
        objectUrl: '',
        persistedInIdb: false,
        isMissingMedia: true,
        storageWarning:
          'Local media file is missing from browser IndexedDB storage. Relink the file from your device to restore playback.',
      });
    }
  }

  // Also check if any clip references an assetId not listed in assetsMetadata
  for (const clip of project.clips) {
    if (clip.assetId && !knownAssetIds.has(clip.assetId)) {
      knownAssetIds.add(clip.assetId);
      missingAssetIds.push(clip.assetId);
      const inferredType =
        clip.trackType === 'audio'
          ? 'audio'
          : clip.trackType === 'overlay'
            ? 'image'
            : 'video';
      hydratedAssets.push({
        id: clip.assetId,
        fingerprint: `${clip.assetId}::missing`,
        name: `${clip.label} (Missing Source)`,
        type: inferredType,
        mimeType: inferredType === 'audio' ? 'audio/wav' : 'video/mp4',
        sizeBytes: 0,
        duration: Math.max(clip.outPoint, clip.duration),
        objectUrl: '',
        waveformPeaks: [0.2, 0.4, 0.3, 0.5],
        createdAt: project.updatedAt,
        persistedInIdb: false,
        isMissingMedia: true,
        storageWarning:
          'Clip references a media asset whose local file blob is missing. Relink file to restore.',
      });
      warnings.push(
        `Clip "${clip.label}" references missing media asset "${clip.assetId}".`
      );
    }
  }

  if (missingAssetIds.length > 0) {
    warnings.push(
      `${missingAssetIds.length} media file(s) could not be found in local browser storage and require relinking.`
    );
  }

  // If schema was migrated from an older version, persist the upgraded v2 record back
  if (migratedFromVersion < CURRENT_PROJECT_SCHEMA_VERSION) {
    await saveProjectToDb(project).catch(() => undefined);
  }

  setLastActiveProjectId(project.id);

  return {
    project,
    hydratedAssets,
    missingAssetIds,
    warnings,
    migratedFromVersion,
  };
}

export async function listProjectsFromDb(): Promise<ProjectSummary[]> {
  try {
    let all: SerializedProject[] = [];
    if (hasNativeIndexedDb()) {
      const db = await getDb();
      all = await db.getAll(STORE_PROJECTS);
    } else {
      all = Array.from(memoryProjectsStore.values());
    }

    return all
      .map((raw) => {
        const recovered = validateAndRecoverProjectData(raw);
        const p = recovered.project ?? raw;
        const missingCount = Array.isArray(p.assetsMetadata)
          ? p.assetsMetadata.filter(
              (a) => !a.isSyntheticSample && a.persistedInIdb === false
            ).length
          : 0;
        return {
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          aspectRatio: p.aspectRatio,
          duration: calculateProjectDuration(Array.isArray(p.clips) ? p.clips : []),
          clipCount: Array.isArray(p.clips) ? p.clips.length : 0,
          assetCount: Array.isArray(p.assetsMetadata) ? p.assetsMetadata.length : 0,
          schemaVersion: p.schemaVersion ?? p.version ?? 1,
          missingMediaCount: missingCount,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Transactionally renames a saved project in IndexedDB.
 */
export async function renameProjectInDb(
  projectId: string,
  newName: string
): Promise<SerializedProject | null> {
  const trimmed = newName.trim();
  if (!trimmed) return null;

  const loaded = await loadProjectFromDb(projectId);
  if (!loaded) return null;

  const updated: SerializedProject = {
    ...loaded.project,
    name: trimmed,
    updatedAt: Date.now(),
  };

  const res = await saveProjectToDb(updated);
  if (!res.persisted) {
    throw new Error(res.warning || 'Failed to rename project in IndexedDB.');
  }
  return updated;
}

/**
 * Creates an independent deep copy of a project (either from a saved project ID or a project snapshot)
 * and persists it transactionally to IndexedDB.
 */
export async function duplicateProjectInDb(
  source: string | SerializedProject,
  customName?: string
): Promise<SerializedProject | null> {
  let baseProject: SerializedProject | null = null;
  if (typeof source === 'string') {
    const loaded = await loadProjectFromDb(source);
    baseProject = loaded?.project ?? null;
  } else {
    const validated = validateAndRecoverProjectData(source);
    baseProject = validated.project;
  }

  if (!baseProject) return null;

  const now = Date.now();
  const suffix = Math.random().toString(36).slice(2, 6);
  const newId = `proj_${now.toString(36)}_${suffix}`;
  const copyName =
    customName && customName.trim().length > 0
      ? customName.trim()
      : `${baseProject.name} (Copy)`;

  const clonedTracks = structuredClone(baseProject.tracks);
  const clonedClips = structuredClone(baseProject.clips).map((clip, idx) => ({
    ...clip,
    id: `clip_${now.toString(36)}_${idx}_${suffix}`,
  }));

  const duplicated: SerializedProject = {
    ...structuredClone(baseProject),
    id: newId,
    name: copyName,
    version: CURRENT_PROJECT_SCHEMA_VERSION,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    updatedAt: now,
    tracks: clonedTracks,
    clips: clonedClips,
  };

  const saveRes = await saveProjectToDb(duplicated);
  if (!saveRes.persisted) {
    throw new Error(
      saveRes.warning || 'Failed to save duplicated project copy to IndexedDB.'
    );
  }

  return duplicated;
}

export async function deleteProjectFromDb(projectId: string): Promise<void> {
  memoryProjectsStore.delete(projectId);
  if (getLastActiveProjectId() === projectId) {
    setLastActiveProjectId(null);
  }
  if (hasNativeIndexedDb()) {
    try {
      const db = await getDb();
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      await tx.store.delete(projectId);
      await tx.done;
    } catch {
      // Ignore if DB unavailable
    }
  }
}

/**
 * Permanently deletes all local projects, cached media blobs, and active session keys from IndexedDB.
 */
export async function clearAllLocalDataFromDb(): Promise<void> {
  memoryProjectsStore.clear();
  memoryMediaBlobsStore.clear();
  setLastActiveProjectId(null);

  if (hasNativeIndexedDb()) {
    try {
      const db = await getDb();
      const tx = db.transaction([STORE_PROJECTS, STORE_MEDIA_BLOBS], 'readwrite');
      await tx.objectStore(STORE_PROJECTS).clear();
      await tx.objectStore(STORE_MEDIA_BLOBS).clear();
      await tx.done;
    } catch {
      // Ignore if DB unavailable
    }
  }
}
