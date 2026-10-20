import { beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  loadProjectFromDb,
  migrateProjectSchema,
  resetInMemoryDbForTests,
  saveMediaBlobToDb,
  saveProjectToDb,
  setSimulatedDbErrorForTests,
  validateAndRecoverProjectData,
} from '@/lib/persistence/db';
import { useEditorStore } from '@/store/use-editor-store';
import { SerializedProject } from '@/types/editor';

describe('Local Project Persistence, Schema Migration & Recovery Engine', () => {
  beforeEach(() => {
    resetInMemoryDbForTests();
    useEditorStore.getState().resetToDemoProject();
  });

  it('persists all project metadata, canvas settings, tracks, clip in/out points, transforms, and text/audio settings, and restores after page refresh', async () => {
    const store = useEditorStore.getState();

    // Customize project name, canvas settings, timeline settings, clip transforms, and audio/text settings
    store.setProjectName('Director Cut — Commercial V2');
    store.setAspectRatio('9:16');
    store.setCanvasBackground('#111827');
    store.setTimelineZoom(92);
    store.updateClipTransform('clip_demo_v1', {
      scale: 1.35,
      rotation: 90,
      flipH: true,
      x: 0.15,
      y: -0.1,
    });
    store.updateClipCrop('clip_demo_v1', { top: 10, bottom: 5, left: 8, right: 8 });
    store.setClipAudioFades('clip_demo_v1', { fadeIn: 0.8, fadeOut: 1.1 });
    store.updateClip('clip_demo_v1', { volume: 75, inPoint: 0.5, outPoint: 4.0, duration: 3.5 });
    store.updateClipTextStyle('clip_demo_title_1', {
      text: 'PERSISTED UNICODE CAPTION · नमस्ते',
      fontSize: 64,
      color: '#38BDF8',
    });

    const savedOk = await useEditorStore.getState().saveCurrentProject();
    expect(savedOk).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe('saved');
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(false);

    const savedProjectId = useEditorStore.getState().projectId;

    // Simulate browser tab refresh by resetting to a blank project first
    useEditorStore.getState().createNewBlankProject();
    expect(useEditorStore.getState().clips.length).toBe(0);
    expect(useEditorStore.getState().projectName).toBe('Untitled Video Project');

    // Restore last session project
    const restoredOk = await useEditorStore.getState().restoreLastSessionProject();
    expect(restoredOk).toBe(true);

    const restored = useEditorStore.getState();
    expect(restored.projectId).toBe(savedProjectId);
    expect(restored.projectName).toBe('Director Cut — Commercial V2');
    expect(restored.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(restored.aspectRatio).toBe('9:16');
    expect(restored.canvasBackground).toBe('#111827');
    expect(restored.timelineZoom).toBe(92);
    expect(restored.tracks.length).toBe(4);

    const restoredV1 = restored.clips.find((c) => c.id === 'clip_demo_v1');
    expect(restoredV1).toBeDefined();
    expect(restoredV1?.inPoint).toBe(0.5);
    expect(restoredV1?.outPoint).toBe(4.0);
    expect(restoredV1?.duration).toBe(3.5);
    expect(restoredV1?.volume).toBe(75);
    expect(restoredV1?.fadeIn).toBe(0.8);
    expect(restoredV1?.fadeOut).toBe(1.1);
    expect(restoredV1?.transform.scale).toBe(1.35);
    expect(restoredV1?.transform.rotation).toBe(90);
    expect(restoredV1?.transform.flipH).toBe(true);
    expect(restoredV1?.transform.crop).toEqual({
      top: 10,
      bottom: 5,
      left: 8,
      right: 8,
    });

    const restoredTitle = restored.clips.find((c) => c.id === 'clip_demo_title_1');
    expect(restoredTitle?.textStyle?.text).toBe('PERSISTED UNICODE CAPTION · नमस्ते');
    expect(restoredTitle?.textStyle?.fontSize).toBe(64);
    expect(restoredTitle?.textStyle?.color).toBe('#38BDF8');
  });

  it('does NOT mark a project as saved until the storage transaction has completed successfully', async () => {
    const store = useEditorStore.getState();
    store.setProjectName('Deferred Transaction Test');
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(true);

    let resolveTransaction!: () => void;
    const pendingTransaction = new Promise<void>((resolve) => {
      resolveTransaction = resolve;
    });

    const savePromise = useEditorStore
      .getState()
      .saveCurrentProject(async () => {
        await pendingTransaction;
      });

    // While the storage transaction is in flight, saveStatus MUST be 'saving' and hasUnsavedChanges MUST remain true
    expect(useEditorStore.getState().saveStatus).toBe('saving');
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(true);
    expect(useEditorStore.getState().lastSavedAt).toBeNull();

    // Now complete the storage transaction
    resolveTransaction();
    const completed = await savePromise;

    expect(completed).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe('saved');
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(false);
    expect(useEditorStore.getState().lastSavedAt).not.toBeNull();
  });

  it('handles IndexedDB quota failures gracefully and transitions to failed state without marking saved', async () => {
    const store = useEditorStore.getState();
    store.setProjectName('Quota Exhaustion Sequence');

    const quotaErr = new Error('The quota has been exceeded.');
    quotaErr.name = 'QuotaExceededError';
    setSimulatedDbErrorForTests(quotaErr);

    const savedOk = await useEditorStore.getState().saveCurrentProject();
    expect(savedOk).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe('failed');
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(true);
    expect(useEditorStore.getState().saveError).toMatch(/quota/i);

    setSimulatedDbErrorForTests(null);
  });

  it('migrates legacy v1 / unversioned project schemas to v2 without losing clips or tracks', () => {
    const legacyV1Project = {
      id: 'proj_legacy_v1',
      name: 'Legacy v1 Project',
      version: 1,
      updatedAt: 1700000000000,
      aspectRatio: '16:9',
      canvasBackground: '#000000',
      tracks: [
        {
          id: 'track_video_1',
          name: 'Video 1',
          type: 'video',
          muted: false,
          hidden: false,
          locked: false,
        },
      ],
      clips: [
        {
          id: 'clip_legacy_1',
          trackId: 'track_video_1',
          trackType: 'video',
          assetId: 'asset_legacy_1',
          label: 'Legacy Clip',
          startTime: 1.5,
          duration: 4.0,
          // Missing inPoint, outPoint, playbackRate, volume, fadeIn, fadeOut, transform.crop, filters
        },
      ],
      assetsMetadata: [],
    };

    const migration = migrateProjectSchema(legacyV1Project);
    expect(migration.fromVersion).toBe(1);
    expect(migration.toVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migration.migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migration.migrated.editingSettings).toBeDefined();

    const migratedClips = migration.migrated.clips as Record<string, unknown>[];
    expect(migratedClips[0].inPoint).toBe(0);
    expect(migratedClips[0].outPoint).toBe(4.0);
    expect(migratedClips[0].playbackRate).toBe(1);
    expect(migratedClips[0].volume).toBe(100);
  });

  it('validates and recovers corrupted project data (orphaned tracks, negative times, invalid aspect ratio)', () => {
    // Completely invalid input is rejected
    expect(validateAndRecoverProjectData(null).valid).toBe(false);
    expect(validateAndRecoverProjectData({ name: 'Missing ID' }).valid).toBe(false);

    // Recoverable corruptions are repaired with warnings
    const corruptedPayload = {
      id: 'proj_corrupted_99',
      name: '   ', // empty name
      schemaVersion: 2,
      aspectRatio: '99:1', // invalid aspect ratio
      canvasBackground: '',
      tracks: [], // empty tracks array
      clips: [
        null, // corrupted entry
        {
          id: 'clip_orphan_1',
          trackId: 'non_existent_track_id',
          trackType: 'video',
          assetId: null,
          label: 'Recovered Clip',
          startTime: -5.5, // negative start time
          duration: -2.0, // negative duration
          inPoint: -1,
          outPoint: -3,
          playbackRate: 99, // invalid speed
          volume: 250, // > 100
        },
      ],
      assetsMetadata: [],
    };

    const recovery = validateAndRecoverProjectData(corruptedPayload);
    expect(recovery.valid).toBe(true);
    expect(recovery.project).not.toBeNull();
    expect(recovery.warnings.length).toBeGreaterThan(0);

    const proj = recovery.project!;
    expect(proj.name).toBe('Recovered Video Project');
    expect(proj.aspectRatio).toBe('16:9');
    expect(proj.tracks.length).toBeGreaterThan(0);
    expect(proj.clips.length).toBe(1);

    const recoveredClip = proj.clips[0];
    expect(recoveredClip.startTime).toBe(0);
    expect(recoveredClip.duration).toBeGreaterThan(0);
    expect(recoveredClip.inPoint).toBe(0);
    expect(recoveredClip.outPoint).toBeGreaterThan(0);
    expect(recoveredClip.playbackRate).toBe(1);
    expect(recoveredClip.volume).toBe(100);
    // Reattached to valid video track
    expect(proj.tracks.some((t) => t.id === recoveredClip.trackId)).toBe(true);
  });

  it('detects missing media blobs on project restore and supports relinking the file', async () => {
    const projectWithMissingBlob: SerializedProject = {
      id: 'proj_missing_media_test',
      name: 'Missing Media Project',
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      updatedAt: Date.now(),
      aspectRatio: '16:9',
      canvasBackground: '#090D16',
      tracks: useEditorStore.getState().tracks,
      clips: [
        {
          ...useEditorStore.getState().clips[0],
          id: 'clip_user_video',
          assetId: 'asset_user_cam_01',
          label: 'Camera_Roll_01.mp4',
        },
      ],
      assetsMetadata: [
        {
          id: 'asset_user_cam_01',
          fingerprint: 'camera_roll_01.mp4::42000::1',
          name: 'Camera_Roll_01.mp4',
          type: 'video',
          mimeType: 'video/mp4',
          sizeBytes: 42000,
          duration: 6.0,
          width: 1920,
          height: 1080,
          waveformPeaks: [0.3, 0.7, 0.5],
          createdAt: Date.now(),
          isSyntheticSample: false,
          persistedInIdb: false,
        },
      ],
    };

    await saveProjectToDb(projectWithMissingBlob);

    // Load project when 'asset_user_cam_01' has no blob in media_blobs store
    const loadedOk = await useEditorStore
      .getState()
      .loadSavedProject('proj_missing_media_test');
    expect(loadedOk).toBe(true);

    const stateAfterLoad = useEditorStore.getState();
    expect(stateAfterLoad.missingMediaAssetIds).toContain('asset_user_cam_01');
    const missingAsset = stateAfterLoad.assets.find(
      (a) => a.id === 'asset_user_cam_01'
    );
    expect(missingAsset?.isMissingMedia).toBe(true);

    // Now relink the missing media asset with a File
    const relinkedFile = new File(
      [new Uint8Array([0, 1, 2, 3, 4, 5])],
      'Camera_Roll_01_Relinked.mp4',
      { type: 'video/mp4' }
    );
    const relinkOk = await useEditorStore
      .getState()
      .relinkMissingMediaAsset('asset_user_cam_01', relinkedFile);
    expect(relinkOk).toBe(true);

    const stateAfterRelink = useEditorStore.getState();
    expect(stateAfterRelink.missingMediaAssetIds).not.toContain(
      'asset_user_cam_01'
    );
    const relinkedAsset = stateAfterRelink.assets.find(
      (a) => a.id === 'asset_user_cam_01'
    );
    expect(relinkedAsset?.isMissingMedia).toBe(false);
    expect(relinkedAsset?.name).toBe('Camera_Roll_01_Relinked.mp4');

    // Reloading the project now hydrates the relinked blob without missing media warnings
    const bundle = await loadProjectFromDb('proj_missing_media_test');
    expect(bundle?.missingAssetIds.length).toBe(0);
    expect(bundle?.hydratedAssets[0].isMissingMedia).toBe(false);
  });

  it('supports project renaming (with undo/redo), project copying, project deletion, and clearing all local data', async () => {
    const store = useEditorStore.getState();
    await store.saveCurrentProject();
    const originalId = useEditorStore.getState().projectId;

    // 1. Rename active project and test undo/redo
    await useEditorStore.getState().renameProject(originalId, 'Renamed Master Reel');
    expect(useEditorStore.getState().projectName).toBe('Renamed Master Reel');

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().projectName).toBe(
      'Studio Reel 01 — Product Sequence'
    );

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().projectName).toBe('Renamed Master Reel');
    await useEditorStore.getState().saveCurrentProject();

    // 2. Create a project copy
    const copy = await useEditorStore
      .getState()
      .duplicateProject(originalId, 'Renamed Master Reel (Copy)');
    expect(copy).not.toBeNull();
    expect(copy?.id).not.toBe(originalId);
    expect(copy?.name).toBe('Renamed Master Reel (Copy)');
    expect(copy?.clips.length).toBe(3);
    expect(useEditorStore.getState().savedProjects.length).toBe(2);

    // 3. Delete the copied project
    await useEditorStore.getState().deleteSavedProject(copy!.id);
    expect(useEditorStore.getState().savedProjects.length).toBe(1);
    expect(useEditorStore.getState().savedProjects[0].id).toBe(originalId);

    // 4. Clear all local project data and media blobs
    await saveMediaBlobToDb(
      'temp_blob_1',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' })
    );
    await useEditorStore.getState().clearAllLocalData();
    expect(useEditorStore.getState().savedProjects.length).toBe(0);
    expect(useEditorStore.getState().clips.length).toBe(0);
  });
});
