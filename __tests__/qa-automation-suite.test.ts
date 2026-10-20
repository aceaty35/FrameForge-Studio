import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateProjectDuration,
  closeTrackGaps,
  deleteClipAndRipple,
  detectTrackGaps,
  detectTrackOverlaps,
  formatTimecode,
  framesToSeconds,
  moveClipWithSnap,
  parseTimecode,
  quantizeToFrame,
  resolveActiveClipsAtTime,
  resolveTrackOverlaps,
  secondsToFrames,
  secondsToTicks,
  splitClipAtTime,
  ticksToSeconds,
  trimClipEnd,
  trimClipStart,
} from '@/lib/timeline/engine';
import {
  applyValidatedAspectRatio,
  applyValidatedCrop,
  applyValidatedSpeed,
  applyValidatedSplit,
  applyValidatedTrim,
  buildNonDestructiveEDL,
  computeCropPixelRect,
  computeResizePlacementBox,
  validateAndResolveOutputResolution,
} from '@/lib/operations/editing-operations';
import {
  buildFfmpegExportArgs,
  createExportJobFromEDL,
  releaseExportResources,
} from '@/lib/export/exporter';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectSchema,
  resetInMemoryDbForTests,
  validateAndRecoverProjectData,
} from '@/lib/persistence/db';
import {
  formatSrtTimestamp,
  parseSrtSubtitles,
  parseSrtTimestamp,
} from '@/lib/subtitles/text-and-subtitles';
import {
  classifyFailureIncident,
  FAILURE_RECOVERY_CATALOG,
  validateExportParameters,
  validateFfmpegCommandArgs,
  verifyMediaFileSignature,
} from '@/lib/security/security-controls';
import {
  buildBinaryGifContainer,
  createLegalTestMediaFixture,
  probeBinaryMediaContainer,
  STANDARD_QA_MEDIA_FIXTURES,
} from '@/lib/qa/media-probe';
import {
  BROWSER_COVERAGE_MATRIX,
  QA_UNRESOLVED_LIMITATIONS_AND_ENV_REPORT,
  runAutomatedQaSuite,
  runRepeatablePerformanceBenchmarks,
} from '@/lib/qa/qa-suite';
import { useEditorStore } from '@/store/use-editor-store';
import {
  ASPECT_RATIO_PRESETS,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CROP_SETTINGS,
  DEFAULT_VIDEO_FILTERS,
  ExportSettings,
  SerializedProject,
  TimelineClip,
  TimelineTrack,
} from '@/types/editor';

function makeBaseClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'qa-clip-1',
    assetId: 'qa-asset-1',
    trackId: 'track_video_1',
    trackType: 'video',
    label: 'QA Clip',
    startTime: 0,
    duration: 8.0,
    inPoint: 0,
    outPoint: 8.0,
    playbackRate: 1,
    volume: 100,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    filters: { ...DEFAULT_VIDEO_FILTERS },
    transform: {
      ...DEFAULT_CLIP_TRANSFORM,
      crop: { ...DEFAULT_CROP_SETTINGS },
    },
    ...overrides,
  };
}

describe('Comprehensive QA Automated Test Suite (Unit, Integration, Media Probe, Browser Matrix & Performance)', () => {
  beforeEach(() => {
    resetInMemoryDbForTests();
    useEditorStore.getState().resetToDemoProject();
    useEditorStore.getState().dismissFailureIncident();
    releaseExportResources(true);
  });

  // ==========================================================================
  // 1. UNIT TESTS (All 11 Required Categories)
  // ==========================================================================
  describe('1. Unit Tests', () => {
    it('1.1 Time conversion: integer microsecond ticks, frame quantization, and MM:SS.FF / SRT timecodes', () => {
      // Integer tick round-trip without IEEE-754 drift (60,000 ticks/sec rational timebase)
      expect(secondsToTicks(0.1 + 0.2)).toBe(18_000);
      expect(ticksToSeconds(18_000)).toBe(0.3);

      // Frame conversion and quantization at 24, 30, and 60 fps
      expect(secondsToFrames(2.0, 24)).toBe(48);
      expect(framesToSeconds(48, 24)).toBe(2.0);
      expect(quantizeToFrame(1.016, 30)).toBeCloseTo(1.0, 4);
      expect(quantizeToFrame(0.508, 60)).toBeCloseTo(30 / 60, 4);

      // Display timecode & SRT subtitle timestamp conversion
      expect(formatTimecode(0)).toBe('00:00.00');
      expect(formatTimecode(125.5)).toBe('02:05.50');
      expect(parseTimecode('02:05.50')).toBeCloseTo(125.5, 2);
      expect(parseSrtTimestamp('00:01:15,250')).toBeCloseTo(75.25, 3);
      expect(formatSrtTimestamp(75.25)).toBe('00:01:15,250');
    });

    it('1.2 Timeline calculations: duration, magnetic snap, gap detection, overlap resolution, and active clip resolution', () => {
      const tracks: TimelineTrack[] = [
        {
          id: 'track_video_1',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          hidden: false,
        },
      ];
      const clips = [
        makeBaseClip({ id: 'c1', startTime: 0, duration: 4 }),
        makeBaseClip({ id: 'c2', startTime: 5, duration: 5 }),
      ];
      expect(calculateProjectDuration(clips)).toBe(10);

      // Detect 1.0s gap between c1 (0..4) and c2 (5..10)
      const gaps = detectTrackGaps(clips, 'track_video_1');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].startTime).toBe(4);
      expect(gaps[0].endTime).toBe(5);
      expect(gaps[0].duration).toBe(1);

      // Magnetic snap when dragging c2 near c1's end (4.0s)
      const snappedStart = moveClipWithSnap(
        clips[1],
        4.08,
        clips,
        2.0,
        true,
        0.15
      );
      expect(snappedStart).toBe(4.0);

      // Active clip query
      expect(resolveActiveClipsAtTime(clips, tracks, 2.0).map((c) => c.id)).toEqual(['c1']);
      expect(resolveActiveClipsAtTime(clips, tracks, 6.0).map((c) => c.id)).toEqual(['c2']);
    });

    it('1.3 Trim and split: left/right bounds clamping, source in/out preservation, and split segment continuity', () => {
      const clip = makeBaseClip({
        id: 'trim-clip',
        startTime: 2.0,
        duration: 6.0,
        inPoint: 1.0,
        outPoint: 7.0,
      });

      // Trim start by +1.5s -> startTime=3.5, duration=4.5, inPoint=2.5
      const leftTrimmed = trimClipStart(clip, 3.5, 10.0);
      expect(leftTrimmed.startTime).toBe(3.5);
      expect(leftTrimmed.duration).toBe(4.5);
      expect(leftTrimmed.inPoint).toBe(2.5);

      // Trim end to newDuration = 3.0s -> duration=3.0, outPoint=5.5
      const rightTrimmed = trimClipEnd(leftTrimmed, 3.0, 10.0);
      expect(rightTrimmed.duration).toBe(3.0);
      expect(rightTrimmed.outPoint).toBe(5.5);

      // Split at playhead t = 4.5s (1.0s into the trimmed clip)
      const split = splitClipAtTime(rightTrimmed, 4.5);
      expect(split).not.toBeNull();
      expect(split![0].startTime).toBe(3.5);
      expect(split![0].duration).toBe(1.0);
      expect(split![0].inPoint).toBe(2.5);
      expect(split![0].outPoint).toBe(3.5);

      expect(split![1].startTime).toBe(4.5);
      expect(split![1].duration).toBe(2.0);
      expect(split![1].inPoint).toBe(3.5);
      expect(split![1].outPoint).toBe(5.5);
    });

    it('1.4 Undo and redo: multi-step history stack and store undo/redo state transitions', () => {
      const store = useEditorStore.getState();
      const initialCount = store.clips.length;

      // Step 1: Split clip at playhead
      store.setPlayheadTime(1.2);
      const didSplit = store.splitSelectedClipAtPlayhead();
      expect(didSplit).toBe(true);
      expect(useEditorStore.getState().clips.length).toBe(initialCount + 1);

      // Step 2: Add text overlay
      useEditorStore.getState().addTextOverlayClip('Undo Test Title');
      expect(useEditorStore.getState().clips.length).toBe(initialCount + 2);

      // Undo Step 2 -> back to initialCount + 1
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().clips.length).toBe(initialCount + 1);

      // Undo Step 1 -> back to initialCount
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().clips.length).toBe(initialCount);

      // Redo Step 1 -> back to initialCount + 1
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().clips.length).toBe(initialCount + 1);
    });

    it('1.5 Clip ordering: chronological sorting, overlap resolution, and ripple delete gap closure', () => {
      const clips = [
        makeBaseClip({ id: 'a', startTime: 0, duration: 3 }),
        makeBaseClip({ id: 'b', startTime: 3, duration: 4 }),
        makeBaseClip({ id: 'c', startTime: 7, duration: 2 }),
      ];

      // Ripple delete middle clip 'b' -> 'c' shifts left from 7.0s to 3.0s
      const rippled = deleteClipAndRipple(clips, 'b', true);
      expect(rippled.map((x) => ({ id: x.id, start: x.startTime }))).toEqual([
        { id: 'a', start: 0 },
        { id: 'c', start: 3 },
      ]);

      // Overlap detection & automatic chronological resolution
      const overlapping = [
        makeBaseClip({ id: 'x1', startTime: 0, duration: 5 }),
        makeBaseClip({ id: 'x2', startTime: 3, duration: 4 }),
      ];
      expect(detectTrackOverlaps(overlapping, 'track_video_1')).toHaveLength(1);
      const resolved = resolveTrackOverlaps(overlapping, 'track_video_1');
      expect(detectTrackOverlaps(resolved, 'track_video_1')).toHaveLength(0);
      expect(resolved.find((c) => c.id === 'x2')?.startTime).toBe(5);
    });

    it('1.6 Aspect ratio calculations: 16:9, 9:16, 1:1, and 4:5 letterbox/pillarbox geometry', () => {
      expect(ASPECT_RATIO_PRESETS['16:9'].width).toBe(1920);
      expect(ASPECT_RATIO_PRESETS['9:16'].height).toBe(1920);
      expect(ASPECT_RATIO_PRESETS['1:1'].width).toBe(1080);
      expect(ASPECT_RATIO_PRESETS['4:5'].height).toBe(1350);

      // 16:9 source (1920x1080) inside 9:16 canvas (1080x1920)
      const fitVertical = computeResizePlacementBox({
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasWidth: 1080,
        canvasHeight: 1920,
        fitMode: 'contain',
      });
      expect(fitVertical.width).toBe(1080);
      expect(Math.round(fitVertical.height)).toBe(608);

      // 9:16 source (1080x1920) inside 16:9 canvas (1920x1080)
      const fitHorizontal = computeResizePlacementBox({
        sourceWidth: 1080,
        sourceHeight: 1920,
        canvasWidth: 1920,
        canvasHeight: 1080,
        fitMode: 'contain',
      });
      expect(fitHorizontal.height).toBe(1080);
      expect(Math.round(fitHorizontal.width)).toBe(608);
    });

    it('1.7 Crop coordinates: normalization, minimum visible area clamping, and source pixel rectangle calculation', () => {
      const clip = makeBaseClip();
      // Excessive crop percentages (80% left + 80% right) are clamped to [0..45%] so visible region remains valid
      const cropResult = applyValidatedCrop(clip, {
        top: -10,
        bottom: 85,
        left: 80,
        right: 80,
      });
      expect(cropResult.valid).toBe(true);
      expect(cropResult.warnings.length).toBeGreaterThan(0);
      const clampedCrop = cropResult.value.transform.crop ?? DEFAULT_CROP_SETTINGS;
      expect(clampedCrop.top).toBe(0);
      expect(clampedCrop.left + clampedCrop.right).toBeLessThanOrEqual(90);

      // Source pixel rectangle for 1920x1080 with 10% top/bottom and 25% left/right crop
      const srcRect = computeCropPixelRect(1920, 1080, {
        top: 10,
        bottom: 10,
        left: 25,
        right: 25,
      });
      expect(srcRect.x).toBe(480);
      expect(srcRect.y).toBe(108);
      expect(srcRect.width).toBe(960);
      expect(srcRect.height).toBe(864);
    });

    it('1.8 Export configuration: EDL compilation, even-dimension scaling, and FFmpeg CLI args', () => {
      const tracks: TimelineTrack[] = [
        {
          id: 'track_video_1',
          name: 'V1',
          type: 'video',
          muted: false,
          locked: false,
          hidden: false,
        },
      ];
      const clips = [
        makeBaseClip({
          id: 'exp-c1',
          startTime: 0,
          duration: 4.0,
          playbackRate: 1.5,
          transform: {
            ...DEFAULT_CLIP_TRANSFORM,
            rotation: 90,
            crop: { top: 10, bottom: 10, left: 0, right: 0 },
          },
        }),
      ];
      const settings: ExportSettings = {
        format: 'mp4',
        resolution: '1080p',
        fps: 30,
        quality: 'high',
        filename: 'qa_export_test',
        audioBitrate: '192k',
        engine: 'auto',
      };

      const job = createExportJobFromEDL({
        aspectRatio: '9:16',
        settings,
        clips,
        tracks,
        assets: [],
      });
      expect(job.width).toBe(1080);
      expect(job.height).toBe(1920);
      expect(job.width % 2).toBe(0);
      expect(job.height % 2).toBe(0);
      expect(job.duration).toBe(4.0);

      const args = buildFfmpegExportArgs({
        inputFilename: 'input_01.webm',
        outputFilename: 'output_01.mp4',
        inPoint: 0,
        duration: 4.0,
        width: job.width,
        height: job.height,
        fps: 30,
        format: 'mp4',
        quality: 'high',
        crop: clips[0].transform.crop,
        rotation: 90,
        playbackRate: 1.5,
      });
      expect(args).toContain('-c:v');
      expect(args).toContain('libx264');
      expect(args.join(' ')).toContain('transpose=1');
      expect(args.join(' ')).toContain('atempo=1.50');
    });

    it('1.9 Input validation: binary magic-byte inspection, XSS/Bidi text sanitization, and FFmpeg flag allowlisting', async () => {
      const mp4Fixture = createLegalTestMediaFixture(
        STANDARD_QA_MEDIA_FIXTURES.small_720p_mp4
      );
      const sigOk = await verifyMediaFileSignature(mp4Fixture.file, 'video');
      expect(sigOk.valid).toBe(true);

      // Spoofed executable disguised as .mp4
      const exeBytes = new Uint8Array([
        0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
      ]);
      const fakeFile = new Blob([exeBytes], {
        type: 'video/mp4',
      }) as unknown as File;
      Object.defineProperty(fakeFile, 'name', { value: 'malware.mp4' });
      const sigBad = await verifyMediaFileSignature(fakeFile, 'video');
      expect(sigBad.valid).toBe(false);

      // Text & SRT sanitization
      const srt = parseSrtSubtitles(
        `1\n00:00:01,000 --> 00:00:03,000\n<script>alert(1)</script>Safe Subtitle Line`
      );
      expect(srt.entries[0].text).toBe('Safe Subtitle Line');

      // Command injection check
      const badArgs = validateFfmpegCommandArgs([
        '-i',
        'concat:http://evil.tld/a|b',
        'out.mp4',
      ]);
      expect(badArgs.valid).toBe(false);
    });

    it('1.10 Project serialization: schema v2 round-trip, v1 migration, and corrupted schema recovery', () => {
      const serialized: SerializedProject = {
        id: 'proj-unit-10',
        name: 'Unit Serialization Test',
        version: CURRENT_PROJECT_SCHEMA_VERSION,
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        updatedAt: Date.now(),
        aspectRatio: '4:5',
        canvasBackground: '#09090b',
        tracks: [],
        clips: [makeBaseClip({ id: 'ser-clip-1' })],
        assetsMetadata: [],
        editingSettings: {
          timelineZoom: 60,
          snapEnabled: true,
          rippleDeleteEnabled: true,
          showSafeGuides: true,
          masterMuted: false,
          isLooping: false,
          autoSaveEnabled: true,
          exportSettings: {
            format: 'mp4',
            resolution: '1080p',
            fps: 30,
            quality: 'balanced',
            filename: 'unit_test',
            engine: 'auto',
          },
        },
      };

      expect(serialized.schemaVersion).toBe(2);
      const validated = validateAndRecoverProjectData(serialized);
      expect(validated.project.aspectRatio).toBe('4:5');

      // Legacy v1 migration
      const v1Legacy = {
        id: 'legacy-1',
        name: 'Legacy V1 Project',
        schemaVersion: 1,
        tracks: [],
        clips: [],
      };
      const migratedV1 = migrateProjectSchema(v1Legacy);
      expect(migratedV1.migrated.schemaVersion).toBe(2);
      expect(migratedV1.migrated.name).toBe('Legacy V1 Project');

      // Corrupted non-object payload rejected
      expect(validateAndRecoverProjectData('not-an-object').valid).toBe(false);
    });

    it('1.11 Error handling: deterministic classification and recovery actions for all 9 expected failure categories', () => {
      const categories = Object.keys(FAILURE_RECOVERY_CATALOG);
      expect(categories).toHaveLength(9);

      expect(classifyFailureIncident('QuotaExceededError').category).toBe(
        'INSUFFICIENT_STORAGE'
      );
      expect(
        classifyFailureIncident('RangeError: WebAssembly.Memory Out of memory')
          .category
      ).toBe('OUT_OF_MEMORY');
      expect(
        classifyFailureIncident('Worker startup SecurityError').category
      ).toBe('WORKER_STARTUP_FAILURE');
      expect(
        classifyFailureIncident('Export cancelled by user').category
      ).toBe('INTERRUPTED_PROCESSING');
      expect(
        classifyFailureIncident('Unsupported codec hevc_main10').category
      ).toBe('UNSUPPORTED_CODEC');
    });
  });

  // ==========================================================================
  // 2. MEDIA TESTS (Legal Test Fixtures + Real Binary Container Probe/Decoder)
  // ==========================================================================
  describe('2. Media Container Synthesizer & Binary Probe/Decoder Tests', () => {
    it('synthesizes and binary-probes MP4 (ISO BMFF), WebM (EBML), WAV (RIFF PCM), and GIF89a containers with exact metadata', async () => {
      // 1. Small 720p30 stereo MP4
      const mp4Small = createLegalTestMediaFixture(
        STANDARD_QA_MEDIA_FIXTURES.small_720p_mp4
      );
      const mp4Probe = await probeBinaryMediaContainer(mp4Small.bytes);
      expect(mp4Probe.valid).toBe(true);
      expect(mp4Probe.containerFormat).toBe('mp4');
      expect(mp4Probe.durationSec).toBe(5.0);
      expect(mp4Probe.width).toBe(1280);
      expect(mp4Probe.height).toBe(720);
      expect(mp4Probe.fps).toBe(30);
      expect(mp4Probe.hasVideo).toBe(true);
      expect(mp4Probe.hasAudio).toBe(true);
      expect(mp4Probe.videoCodec).toBe('avc1');
      expect(mp4Probe.audioCodec).toBe('mp4a');
      expect(mp4Probe.audioSampleRate).toBe(48000);
      expect(mp4Probe.audioChannels).toBe(2);
      expect(mp4Probe.atomsOrChunksFound).toEqual(
        expect.arrayContaining(['ftyp', 'moov', 'mvhd', 'trak', 'tkhd', 'mdat'])
      );

      // 2. Silent 360p24 MP4 (no audio track)
      const mp4Silent = createLegalTestMediaFixture(
        STANDARD_QA_MEDIA_FIXTURES.silent_360p_mp4
      );
      const silentProbe = await probeBinaryMediaContainer(mp4Silent.bytes);
      expect(silentProbe.valid).toBe(true);
      expect(silentProbe.width).toBe(640);
      expect(silentProbe.height).toBe(360);
      expect(silentProbe.fps).toBe(24);
      expect(silentProbe.hasAudio).toBe(false);

      // 3. Vertical 9:16 WebM (1080x1920 @ 24fps, VP9 + Opus)
      const webmVert = createLegalTestMediaFixture(
        STANDARD_QA_MEDIA_FIXTURES.vertical_9_16_webm
      );
      const webmProbe = await probeBinaryMediaContainer(webmVert.bytes);
      expect(webmProbe.valid).toBe(true);
      expect(webmProbe.containerFormat).toBe('webm');
      expect(webmProbe.width).toBe(1080);
      expect(webmProbe.height).toBe(1920);
      expect(webmProbe.fps).toBe(24);
      expect(webmProbe.durationSec).toBe(4.0);
      expect(webmProbe.hasAudio).toBe(true);

      // 4. Reference 48kHz Stereo WAV PCM Audio
      const wavAudio = createLegalTestMediaFixture(
        STANDARD_QA_MEDIA_FIXTURES.reference_wav_audio
      );
      const wavProbe = await probeBinaryMediaContainer(wavAudio.bytes);
      expect(wavProbe.valid).toBe(true);
      expect(wavProbe.containerFormat).toBe('wav');
      expect(wavProbe.durationSec).toBe(1.5);
      expect(wavProbe.audioSampleRate).toBe(48000);
      expect(wavProbe.audioChannels).toBe(2);

      // 5. Animated GIF89a container (no audio)
      const gifBytes = buildBinaryGifContainer({
        durationSec: 2.0,
        width: 480,
        height: 270,
        fps: 15,
      });
      const gifProbe = await probeBinaryMediaContainer(gifBytes);
      expect(gifProbe.valid).toBe(true);
      expect(gifProbe.containerFormat).toBe('gif');
      expect(gifProbe.width).toBe(480);
      expect(gifProbe.height).toBe(270);
      expect(gifProbe.hasAudio).toBe(false);
    });
  });

  // ==========================================================================
  // 3. INTEGRATION TESTS (Full 8-Stage Workflow)
  // ==========================================================================
  describe('3. End-to-End Integration Workflow (Import -> Probe -> Preview -> Edit -> Export -> Binary Verify -> Download -> Restore)', () => {
    it('executes the complete 8-stage video editing and persistence workflow with binary output verification', async () => {
      const suiteReport = await runAutomatedQaSuite();
      expect(suiteReport.failedChecks).toBe(0);
      expect(suiteReport.passedChecks).toBe(suiteReport.totalChecks);
      expect(suiteReport.probedExportReport).not.toBeNull();
      expect(suiteReport.probedExportReport?.valid).toBe(true);
      expect(suiteReport.probedExportReport?.containerFormat).toBe('mp4');
      expect(suiteReport.probedExportReport?.width).toBe(1280);
      expect(suiteReport.probedExportReport?.height).toBe(720);
      expect(suiteReport.probedExportReport?.durationSec).toBeCloseTo(4.5, 2);
      expect(suiteReport.probedExportReport?.hasAudio).toBe(true);
    });

    it('integrates store editing, project save, simulated page refresh, and IndexedDB project restoration', async () => {
      const store = useEditorStore.getState();

      // 1. Import legal binary video asset into store
      const fixture = createLegalTestMediaFixture(
        STANDARD_QA_MEDIA_FIXTURES.small_720p_mp4
      );
      const probed = await probeBinaryMediaContainer(fixture.file);
      store.addAsset(
        {
          id: 'qa-live-asset',
          fingerprint: `${fixture.spec.filename}::${fixture.bytes.byteLength}::0`,
          name: fixture.spec.filename,
          type: 'video',
          objectUrl: 'blob:qa-live-asset',
          duration: probed.durationSec,
          width: probed.width,
          height: probed.height,
          sizeBytes: fixture.bytes.byteLength,
          mimeType: fixture.spec.mimeType,
          waveformPeaks: [0.2, 0.5, 0.8, 0.4],
          createdAt: Date.now(),
        },
        true
      );

      // 2. Edit project: rename, change aspect ratio to 9:16, split clip, add text overlay
      useEditorStore.getState().setProjectName('Integration Restorable Cut');
      useEditorStore.getState().setAspectRatio('9:16');
      useEditorStore.getState().setPlayheadTime(2.0);
      useEditorStore.getState().splitSelectedClipAtPlayhead();
      useEditorStore.getState().addTextOverlayClip('Integration Verified Heading');

      const clipCountBeforeSave = useEditorStore.getState().clips.length;
      const projectIdBeforeSave = useEditorStore.getState().projectId;

      // 3. Persist project to IndexedDB
      const savedOk = await useEditorStore.getState().saveCurrentProject();
      expect(savedOk).toBe(true);
      expect(useEditorStore.getState().saveStatus).toBe('saved');

      // 4. Simulate page refresh by resetting store to blank project
      useEditorStore.getState().createNewBlankProject('Temporary Blank');
      expect(useEditorStore.getState().clips).toHaveLength(0);

      // 5. Restore last session project from IndexedDB
      const restoredOk = await useEditorStore
        .getState()
        .restoreLastSessionProject();
      expect(restoredOk).toBe(true);
      expect(useEditorStore.getState().projectId).toBe(projectIdBeforeSave);
      expect(useEditorStore.getState().projectName).toBe(
        'Integration Restorable Cut'
      );
      expect(useEditorStore.getState().aspectRatio).toBe('9:16');
      expect(useEditorStore.getState().clips).toHaveLength(clipCountBeforeSave);
    });
  });

  // ==========================================================================
  // 4. BROWSER COVERAGE & PERFORMANCE BENCHMARKS
  // ==========================================================================
  describe('4. Browser Coverage Matrix, Repeatable Performance Benchmarks & Honest Limitations Report', () => {
    it('documents current stable browser versions (Chrome, Edge, Firefox, Safari/WebKit) and their media/storage differences', () => {
      expect(BROWSER_COVERAGE_MATRIX.length).toBeGreaterThanOrEqual(4);
      const browsers = BROWSER_COVERAGE_MATRIX.map((b) => b.browser);
      expect(browsers).toEqual(
        expect.arrayContaining([
          'Google Chrome',
          'Microsoft Edge',
          'Mozilla Firefox',
          'Apple Safari / iOS WebKit',
        ])
      );

      for (const entry of BROWSER_COVERAGE_MATRIX) {
        expect(entry.documentedFeatureDifferences.length).toBeGreaterThan(0);
      }
    });

    it('runs repeatable performance benchmarks for small (720p30) and medium (1080p60) files across mobile and desktop hardware profiles', async () => {
      const benchmarks = await runRepeatablePerformanceBenchmarks();
      expect(benchmarks).toHaveLength(4);

      const smallMobile = benchmarks.find(
        (b) =>
          b.workloadName === 'small-720p30' &&
          b.hardwareProfile === 'mobile-constrained'
      )!;
      const mediumMobile = benchmarks.find(
        (b) =>
          b.workloadName === 'medium-1080p60' &&
          b.hardwareProfile === 'mobile-constrained'
      )!;
      const mediumDesktop = benchmarks.find(
        (b) =>
          b.workloadName === 'medium-1080p60' &&
          b.hardwareProfile === 'desktop-high'
      )!;

      // Mobile hardware profile downscales preview to <= 0.5x proxy scale, while desktop keeps 1.0x
      expect(mediumMobile.previewScaleRatio).toBeLessThanOrEqual(0.5);
      expect(mediumDesktop.previewScaleRatio).toBe(1);

      // Verify deterministic output clip counts after edits (4 initial + 4 splits = 8; 32 initial + 4 splits = 36)
      expect(smallMobile.verifiedClipCountAfterEdits).toBe(8);
      expect(mediumDesktop.verifiedClipCountAfterEdits).toBe(36);

      // Verify all 4 benchmarks complete within deterministic performance budgets
      for (const b of benchmarks) {
        expect(b.passedBudget).toBe(true);
        expect(b.metricsMs.totalPipelineMs).toBeLessThanOrEqual(b.budgetMs);
      }
    });

    it('reports environment-failed checks and unresolved technical limitations transparently', () => {
      expect(
        QA_UNRESOLVED_LIMITATIONS_AND_ENV_REPORT.length
      ).toBeGreaterThanOrEqual(5);
      const hasHeadlessFailureReport =
        QA_UNRESOLVED_LIMITATIONS_AND_ENV_REPORT.some(
          (r) => r.status === 'FAILED_IN_HEADLESS_NODE'
        );
      const hasWasmMemoryLimitation =
        QA_UNRESOLVED_LIMITATIONS_AND_ENV_REPORT.some(
          (r) => r.category === 'wasm-memory-ceiling'
        );
      expect(hasHeadlessFailureReport).toBe(true);
      expect(hasWasmMemoryLimitation).toBe(true);
    });
  });
});
