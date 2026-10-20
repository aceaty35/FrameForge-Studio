import { describe, it, expect, beforeEach } from 'vitest';
import pkgJson from '../package.json';
import {
  buildContentSecurityPolicy,
  classifyFailureIncident,
  containsUnsafeHtmlOrScript,
  createValidMediaHeaderBytes,
  DEPENDENCY_SECURITY_MANIFEST,
  EditorFailureCategory,
  FAILURE_RECOVERY_CATALOG,
  inspectMediaMagicBytes,
  PRIVACY_AND_TELEMETRY_POLICY,
  sanitizeProjectName,
  sanitizeUserText,
  SECURITY_HEADERS_LIST,
  SECURITY_LIMITATIONS_DOCUMENTATION,
  validateExportParameters,
  validateFfmpegCommandArgs,
  verifyMediaFileSignature,
  verifyPackageJsonPinning,
} from '@/lib/security/security-controls';
import { MediaManager } from '@/lib/media/manager';
import { buildFfmpegExportArgs } from '@/lib/export/exporter';
import {
  escapeFfmpegDrawtextText,
  parseSrtSubtitles,
} from '@/lib/subtitles/text-and-subtitles';
import { useEditorStore } from '@/store/use-editor-store';

function createBinaryFile(
  name: string,
  mimeType: string,
  headerBytes: Uint8Array,
  reportedSize?: number
): File {
  const blob = new Blob([headerBytes], { type: mimeType });
  Object.defineProperty(blob, 'name', { value: name });
  if (reportedSize !== undefined) {
    Object.defineProperty(blob, 'size', { value: reportedSize });
  }
  return blob as unknown as File;
}

describe('Application Security Controls, Dependency Pinning & Failure Recovery Audit', () => {
  beforeEach(() => {
    useEditorStore.getState().resetToDemoProject();
    useEditorStore.getState().dismissFailureIncident();
  });

  it('1. validates genuine media container magic bytes and treats extensions/MIME types as insufficient proof', async () => {
    // Valid MP4 ISO BMFF ftyp signature
    const mp4Bytes = createValidMediaHeaderBytes('mp4');
    const mp4Res = inspectMediaMagicBytes(mp4Bytes, 'video');
    expect(mp4Res.valid).toBe(true);
    expect(mp4Res.detectedFormat).toBe('mp4-isobmff');

    // Valid WebM EBML signature
    const webmBytes = createValidMediaHeaderBytes('webm');
    expect(inspectMediaMagicBytes(webmBytes, 'video').valid).toBe(true);

    // Valid WAV RIFF/WAVE signature
    const wavBytes = createValidMediaHeaderBytes('wav');
    expect(inspectMediaMagicBytes(wavBytes, 'audio').valid).toBe(true);

    // Valid PNG signature
    const pngBytes = createValidMediaHeaderBytes('png');
    expect(inspectMediaMagicBytes(pngBytes, 'image').valid).toBe(true);

    // Spoofed extension/MIME: a PNG binary header renamed to "spoofed.mp4" with video/mp4 MIME
    const spoofedFile = createBinaryFile('spoofed.mp4', 'video/mp4', pngBytes);
    const sigCheck = await verifyMediaFileSignature(spoofedFile, 'video');
    expect(sigCheck.valid).toBe(false);
    expect(sigCheck.error?.message).toContain('Binary signature mismatch');

    // Arbitrary random bytes renamed to "fake.mp4" with video/mp4 MIME must be rejected
    const randomBytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
    const fakeMp4 = createBinaryFile('fake.mp4', 'video/mp4', randomBytes);
    const fakeCheck = await verifyMediaFileSignature(fakeMp4, 'video');
    expect(fakeCheck.valid).toBe(false);
    expect(fakeCheck.inspection.detectedFormat).toBe('unknown-binary');
  });

  it('2. blocks disguised executables, shell scripts, archives, and HTML/SVG/Script payloads during media import', async () => {
    const encoder = new TextEncoder();

    // Disguised HTML/XSS payload named "innocent.mp4"
    const htmlPayload = encoder.encode('<!DOCTYPE html><script>alert(1)</script>');
    const htmlFile = createBinaryFile('innocent.mp4', 'video/mp4', htmlPayload);
    const htmlCheck = await verifyMediaFileSignature(htmlFile, 'video');
    expect(htmlCheck.valid).toBe(false);
    expect(htmlCheck.inspection.isDisguisedThreat).toBe(true);

    // Disguised SVG with onload handler named "avatar.png"
    const svgPayload = encoder.encode('<svg onload="alert(document.domain)"></svg>');
    const svgFile = createBinaryFile('avatar.png', 'image/png', svgPayload);
    const svgCheck = await verifyMediaFileSignature(svgFile, 'image');
    expect(svgCheck.valid).toBe(false);
    expect(svgCheck.inspection.isDisguisedThreat).toBe(true);

    // Disguised Windows PE executable ('MZ') named "clip.webm"
    const peBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const peFile = createBinaryFile('clip.webm', 'video/webm', peBytes);
    const peCheck = await verifyMediaFileSignature(peFile, 'video');
    expect(peCheck.valid).toBe(false);
    expect(peCheck.inspection.threatType).toContain('Windows PE');

    // Verify MediaManager.importFiles rejects disguised script payload even if mock probe is present
    const manager = new MediaManager(2, {
      probeMetadata: async () => ({ duration: 5, width: 1280, height: 720 }),
      extractWaveform: async () => [0.5],
      persistBlob: async () => ({ persisted: true }),
      deleteBlob: async () => undefined,
    });
    const batch = await manager.importFiles([htmlFile, svgFile, peFile]);
    expect(batch.imported).toHaveLength(0);
    expect(batch.errors).toHaveLength(3);
  });

  it('3. sanitizes user-generated text, subtitles, and project names against XSS and Bidi spoofing while preserving Unicode/Hindi', () => {
    const maliciousInput =
      'नमस्ते Title <script>fetch("https://evil.example")</script><img src=x onerror=alert(1)>\u202Egpj.exe\0';
    expect(containsUnsafeHtmlOrScript(maliciousInput)).toBe(true);

    const sanitized = sanitizeUserText(maliciousInput);
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('<img');
    expect(sanitized).not.toContain('\u202E');
    expect(sanitized).not.toContain('\0');
    expect(sanitized).toContain('नमस्ते Title');

    // Verify SRT parser strips embedded <script> and event handlers
    const maliciousSrt = [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      'Hello <script>evil()</script><svg onload=alert(1)>World — स्वागत है',
    ].join('\n');
    const parsedSrt = parseSrtSubtitles(maliciousSrt);
    expect(parsedSrt.entries).toHaveLength(1);
    expect(parsedSrt.entries[0].text).toBe('Hello World — स्वागत है');

    // Verify store sanitizes project name and text overlay clips automatically
    const store = useEditorStore.getState();
    store.setProjectName('My Project <script>alert(1)</script>');
    expect(useEditorStore.getState().projectName).toBe('My Project');
    expect(sanitizeProjectName('   <script>bad()</script>   ')).toBe(
      'Untitled Studio Project'
    );
  });

  it('4. validates export parameters and prevents command/flag/protocol injection in FFmpeg arguments', () => {
    const badSettingsCheck = validateExportParameters(
      {
        format: 'avi' as unknown as 'mp4',
        resolution: '1080p',
        fps: 999 as unknown as 30,
        quality: 'high',
        engine: 'auto',
        filename: 'output',
      },
      { width: 1921, height: 1080, duration: -5 }
    );
    expect(badSettingsCheck.valid).toBe(false);
    expect(badSettingsCheck.errors.length).toBeGreaterThanOrEqual(3);

    // Valid FFmpeg args generated by buildFfmpegExportArgs pass strict validation
    const safeArgs = buildFfmpegExportArgs({
      inputFilename: 'job_123_input.webm',
      outputFilename: 'job_123_output.mp4',
      inPoint: 0,
      duration: 5,
      width: 1280,
      height: 720,
      fps: 30,
      format: 'mp4',
      quality: 'high',
    });
    expect(validateFfmpegCommandArgs(safeArgs).valid).toBe(true);

    // Injected unallowlisted flag (-protocol_whitelist or -f) is blocked
    expect(
      validateFfmpegCommandArgs([
        '-i',
        'job_123_input.webm',
        '-protocol_whitelist',
        'file,http,https,tcp',
        '-y',
        'out.mp4',
      ]).valid
    ).toBe(false);

    // Protocol or path traversal breakout in input/output filename is blocked
    expect(
      validateFfmpegCommandArgs(['-i', 'file:///etc/passwd', '-y', 'out.mp4']).valid
    ).toBe(false);
    expect(
      validateFfmpegCommandArgs(['-i', '../secret.webm', '-y', 'out.mp4']).valid
    ).toBe(false);

    // Drawtext escaping neutralizes filtergraph breakout characters (; , : ' [ ])
    const escaped = escapeFfmpegDrawtextText(
      "Title':x=0[out];[0:v]system('id')<script>alert(1)</script>"
    );
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain("\\'");
    expect(escaped).toContain('\\:');
    expect(escaped).toContain('\\;');
  });

  it('5. pins 100% of dependency and devDependency versions in package.json and documents SPDX licenses', () => {
    const pinAudit = verifyPackageJsonPinning(
      pkgJson.dependencies,
      pkgJson.devDependencies
    );
    expect(pinAudit.unpinnedPackages).toEqual([]);
    expect(pinAudit.allPinned).toBe(true);

    expect(DEPENDENCY_SECURITY_MANIFEST.length).toBeGreaterThanOrEqual(10);
    const ffmpegEntry = DEPENDENCY_SECURITY_MANIFEST.find(
      (d) => d.packageName === '@ffmpeg/ffmpeg'
    );
    expect(ffmpegEntry?.pinnedVersion).toBe('0.12.15');
    expect(ffmpegEntry?.licenseNotes).toContain('LGPL');
  });

  it('6. configures Content Security Policy, HTTPS headers, local-only privacy default, and honest security limitations', () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain('upgrade-insecure-requests');

    const headerKeys = SECURITY_HEADERS_LIST.map((h) => h.key);
    expect(headerKeys).toContain('Content-Security-Policy');
    expect(headerKeys).toContain('Strict-Transport-Security');
    expect(headerKeys).toContain('X-Content-Type-Options');

    expect(PRIVACY_AND_TELEMETRY_POLICY.localProcessingDefault).toBe(true);
    expect(PRIVACY_AND_TELEMETRY_POLICY.uploadsMediaToServer).toBe(false);
    expect(PRIVACY_AND_TELEMETRY_POLICY.collectsMediaContentInAnalytics).toBe(
      false
    );

    // Must not claim client-side processing automatically makes the entire app secure
    const clientLimitation = SECURITY_LIMITATIONS_DOCUMENTATION.find(
      (item) => item.id === 'client-side-not-panacea'
    );
    expect(clientLimitation).toBeDefined();
    expect(clientLimitation?.title).toContain(
      'Does Not Automatically Guarantee Total Security'
    );
  });

  it('7. provides deterministic classification and visible recovery paths for all 9 expected failure scenarios', async () => {
    const expectedCategories: EditorFailureCategory[] = [
      'UNSUPPORTED_MEDIA',
      'CORRUPTED_FILE',
      'OUT_OF_MEMORY',
      'FAILED_EXPORT',
      'INTERRUPTED_PROCESSING',
      'INDEXEDDB_FAILURE',
      'WORKER_STARTUP_FAILURE',
      'UNSUPPORTED_CODEC',
      'INSUFFICIENT_STORAGE',
    ];

    for (const category of expectedCategories) {
      const spec = FAILURE_RECOVERY_CATALOG[category];
      expect(spec).toBeDefined();
      expect(spec.primaryActionLabel.length).toBeGreaterThan(5);
      expect(spec.secondaryActionLabel.length).toBeGreaterThan(5);

      // Report incident to store and verify visible recovery state is populated
      useEditorStore.getState().reportFailureIncident(`Simulated ${category}`, category);
      const active = useEditorStore.getState().activeFailureIncident;
      expect(active?.category).toBe(category);
      expect(active?.recoverySpec.primaryActionId).toBe(spec.primaryActionId);
    }

    // Execute recovery action for FAILED_EXPORT -> switches export engine to native-stream WebM
    await useEditorStore
      .getState()
      .executeRecoveryAction('RETRY_EXPORT_NATIVE_WEBM');
    expect(useEditorStore.getState().activeFailureIncident).toBeNull();
    expect(useEditorStore.getState().exportSettings.engine).toBe('native-stream');
    expect(useEditorStore.getState().exportSettings.format).toBe('webm');

    // Execute recovery action for OUT_OF_MEMORY -> switches to 480p @ 24fps fast preset
    await useEditorStore
      .getState()
      .executeRecoveryAction('SWITCH_TO_SAFE_480P_EXPORT');
    expect(useEditorStore.getState().exportSettings.resolution).toBe('480p');
    expect(useEditorStore.getState().exportSettings.fps).toBe(24);

    // Verify automatic classification from raw error messages
    expect(
      classifyFailureIncident(new Error('QuotaExceededError: storage full')).category
    ).toBe('INSUFFICIENT_STORAGE');
    expect(
      classifyFailureIncident(new Error('ArrayBuffer out of memory')).category
    ).toBe('OUT_OF_MEMORY');
    expect(
      classifyFailureIncident(new Error('HEVC codec profile unsupported')).category
    ).toBe('UNSUPPORTED_CODEC');
  });
});
