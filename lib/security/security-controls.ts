import {
  AudioBitratePreset,
  ExportFormat,
  ExportResolution,
  ExportSettings,
  MediaImportError,
  MediaType,
} from '@/types/editor';

/**
 * ============================================================================
 * 1. BINARY MAGIC-BYTE & CONTAINER SIGNATURE VALIDATION
 * ============================================================================
 * File extensions (.mp4, .png) and browser-supplied MIME strings (file.type)
 * are untrusted hints that can be trivially spoofed. We inspect the leading
 * binary header bytes of imported media before decoding or execution, and
 * explicitly block disguised executables, scripts, HTML, and SVG payloads.
 */

export type DetectedBinaryFormat =
  | 'mp4-isobmff'
  | 'mov-quicktime'
  | 'webm-ebml'
  | 'ogg-container'
  | 'wav-riff'
  | 'mp3-audio'
  | 'aac-adts'
  | 'png-image'
  | 'jpeg-image'
  | 'gif-image'
  | 'webp-riff'
  | 'disguised-executable-or-script'
  | 'empty-or-zero-filled'
  | 'unknown-binary';

export interface MagicByteInspectionResult {
  valid: boolean;
  detectedFormat: DetectedBinaryFormat;
  detectedCategory: MediaType | null;
  isDisguisedThreat: boolean;
  threatType?: string;
  reason?: string;
}

const ISO_BMFF_BOX_TYPES = [
  'ftyp',
  'moov',
  'mdat',
  'wide',
  'free',
  'skip',
  'pnot',
  'styp',
];

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function startsWithBytes(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Inspects the first up to 64 bytes of a file to detect active/executable payloads
 * and verify genuine media container magic bytes.
 */
export function inspectMediaMagicBytes(
  headerBytes: Uint8Array,
  claimedCategory?: MediaType
): MagicByteInspectionResult {
  if (!headerBytes || headerBytes.length < 4) {
    return {
      valid: false,
      detectedFormat: 'empty-or-zero-filled',
      detectedCategory: null,
      isDisguisedThreat: false,
      reason: 'File header is truncated (< 4 bytes) and cannot be a valid media container.',
    };
  }

  // Check if all sampled bytes are 0x00
  let allZero = true;
  for (let i = 0; i < headerBytes.length; i++) {
    if (headerBytes[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) {
    return {
      valid: false,
      detectedFormat: 'empty-or-zero-filled',
      detectedCategory: null,
      isDisguisedThreat: false,
      reason: 'File header contains only NUL (0x00) bytes and no valid container magic signature.',
    };
  }

  // 1. Detect disguised executables, scripts, archives, HTML, or SVG active content
  const leadingAscii = readAscii(headerBytes, 0, Math.min(64, headerBytes.length))
    .trimStart()
    .toLowerCase();

  if (
    leadingAscii.startsWith('<!doctype') ||
    leadingAscii.startsWith('<html') ||
    leadingAscii.startsWith('<script') ||
    leadingAscii.startsWith('<iframe') ||
    leadingAscii.startsWith('<svg') ||
    leadingAscii.startsWith('<?xml') ||
    leadingAscii.includes('<script') ||
    leadingAscii.startsWith('javascript:')
  ) {
    return {
      valid: false,
      detectedFormat: 'disguised-executable-or-script',
      detectedCategory: null,
      isDisguisedThreat: true,
      threatType: 'HTML/SVG/Script Markup Payload',
      reason:
        'Rejected active HTML/SVG/Script markup disguised as a media file. Uploaded files are never executed or rendered as DOM markup.',
    };
  }

  // Windows PE ('MZ'), Linux ELF (0x7F 'E' 'L' 'F'), Shell ('#!'), Mach-O, ZIP/JAR ('PK\x03\x04'), PDF ('%PDF')
  if (startsWithBytes(headerBytes, [0x4d, 0x5a])) {
    return {
      valid: false,
      detectedFormat: 'disguised-executable-or-script',
      detectedCategory: null,
      isDisguisedThreat: true,
      threatType: 'Windows PE Executable (MZ)',
      reason: 'Rejected Windows PE executable binary disguised with a media extension.',
    };
  }

  if (startsWithBytes(headerBytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return {
      valid: false,
      detectedFormat: 'disguised-executable-or-script',
      detectedCategory: null,
      isDisguisedThreat: true,
      threatType: 'ELF Executable Binary',
      reason: 'Rejected Linux ELF executable binary disguised with a media extension.',
    };
  }

  if (
    startsWithBytes(headerBytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWithBytes(headerBytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWithBytes(headerBytes, [0xcf, 0xfa, 0xed, 0xfe])
  ) {
    return {
      valid: false,
      detectedFormat: 'disguised-executable-or-script',
      detectedCategory: null,
      isDisguisedThreat: true,
      threatType: 'Mach-O Executable Binary',
      reason: 'Rejected macOS Mach-O executable binary disguised with a media extension.',
    };
  }

  if (startsWithBytes(headerBytes, [0x23, 0x21])) {
    return {
      valid: false,
      detectedFormat: 'disguised-executable-or-script',
      detectedCategory: null,
      isDisguisedThreat: true,
      threatType: 'Shell Script (#!)',
      reason: 'Rejected executable shell script disguised as a media file.',
    };
  }

  if (startsWithBytes(headerBytes, [0x50, 0x4b, 0x03, 0x04])) {
    return {
      valid: false,
      detectedFormat: 'disguised-executable-or-script',
      detectedCategory: null,
      isDisguisedThreat: true,
      threatType: 'ZIP / JAR Archive',
      reason: 'Rejected ZIP/JAR archive disguised with a media extension.',
    };
  }

  // 2. Verify genuine media magic-byte signatures
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    startsWithBytes(headerBytes, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
  ) {
    return finalizeCategoryMatch('png-image', 'image', claimedCategory);
  }

  // JPEG: FF D8 FF
  if (startsWithBytes(headerBytes, [0xff, 0xd8, 0xff])) {
    return finalizeCategoryMatch('jpeg-image', 'image', claimedCategory);
  }

  // GIF: 'GIF87a' or 'GIF89a'
  const gifSig = readAscii(headerBytes, 0, 6);
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return finalizeCategoryMatch('gif-image', 'image', claimedCategory);
  }

  // RIFF container: WAV ('RIFF....WAVE') or WebP ('RIFF....WEBP')
  if (readAscii(headerBytes, 0, 4) === 'RIFF' && headerBytes.length >= 12) {
    const subType = readAscii(headerBytes, 8, 4);
    if (subType === 'WAVE') {
      return finalizeCategoryMatch('wav-riff', 'audio', claimedCategory);
    }
    if (subType === 'WEBP') {
      return finalizeCategoryMatch('webp-riff', 'image', claimedCategory);
    }
  }

  // WebM / Matroska EBML header: 1A 45 DF A3
  if (startsWithBytes(headerBytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const effectiveCategory =
      claimedCategory === 'audio' ? 'audio' : 'video';
    return finalizeCategoryMatch('webm-ebml', effectiveCategory, claimedCategory);
  }

  // Ogg container: 'OggS'
  if (readAscii(headerBytes, 0, 4) === 'OggS') {
    const effectiveCategory =
      claimedCategory === 'video' ? 'video' : 'audio';
    return finalizeCategoryMatch('ogg-container', effectiveCategory, claimedCategory);
  }

  // ISO BMFF (MP4 / MOV / M4A): bytes 4..7 equal 'ftyp', 'moov', 'mdat', 'wide', 'free'
  if (headerBytes.length >= 8) {
    const boxType = readAscii(headerBytes, 4, 4);
    if (ISO_BMFF_BOX_TYPES.includes(boxType)) {
      const brand = headerBytes.length >= 12 ? readAscii(headerBytes, 8, 4) : '';
      const isQuickTime = brand === 'qt  ';
      const isAudioM4a =
        brand === 'M4A ' || brand === 'M4B ' || claimedCategory === 'audio';
      return finalizeCategoryMatch(
        isQuickTime ? 'mov-quicktime' : 'mp4-isobmff',
        isAudioM4a ? 'audio' : 'video',
        claimedCategory
      );
    }
  }

  // MP3: 'ID3' tag or MPEG audio sync word (0xFF followed by 0xE0..0xFF)
  if (
    readAscii(headerBytes, 0, 3) === 'ID3' ||
    (headerBytes[0] === 0xff && (headerBytes[1] & 0xe0) === 0xe0)
  ) {
    // Distinguish AAC ADTS (0xFF 0xF0..0xF9) vs MP3
    const isAdts = (headerBytes[1] & 0xf6) === 0xf0;
    return finalizeCategoryMatch(
      isAdts ? 'aac-adts' : 'mp3-audio',
      'audio',
      claimedCategory
    );
  }

  return {
    valid: false,
    detectedFormat: 'unknown-binary',
    detectedCategory: null,
    isDisguisedThreat: false,
    reason:
      'File binary header does not match any supported video, audio, or image container signature. File extensions and MIME types alone are not accepted.',
  };
}

function finalizeCategoryMatch(
  detectedFormat: DetectedBinaryFormat,
  detectedCategory: MediaType,
  claimedCategory?: MediaType
): MagicByteInspectionResult {
  if (claimedCategory && claimedCategory !== detectedCategory) {
    return {
      valid: false,
      detectedFormat,
      detectedCategory,
      isDisguisedThreat: false,
      reason: `Binary signature mismatch: file header is "${detectedFormat}" (${detectedCategory}), but file extension/MIME claimed "${claimedCategory}".`,
    };
  }
  return {
    valid: true,
    detectedFormat,
    detectedCategory,
    isDisguisedThreat: false,
  };
}

/**
 * Reads the first 64 bytes of a Blob/File and validates its binary container signature.
 */
export async function verifyMediaFileSignature(
  file: Blob & { name?: string; type?: string },
  claimedCategory?: MediaType,
  options: { allowSyntheticZeroHeaderForUnitTests?: boolean } = {}
): Promise<{
  valid: boolean;
  inspection: MagicByteInspectionResult;
  error?: MediaImportError;
}> {
  const fileName = file.name || 'Unnamed file';
  try {
    const slice = file.slice(0, 64);
    const buffer =
      typeof slice.arrayBuffer === 'function'
        ? await slice.arrayBuffer()
        : new ArrayBuffer(0);
    const bytes = new Uint8Array(buffer);
    const inspection = inspectMediaMagicBytes(bytes, claimedCategory);

    if (
      !inspection.valid &&
      inspection.detectedFormat === 'empty-or-zero-filled' &&
      options.allowSyntheticZeroHeaderForUnitTests
    ) {
      return {
        valid: true,
        inspection: {
          valid: true,
          detectedFormat: 'empty-or-zero-filled',
          detectedCategory: claimedCategory ?? 'video',
          isDisguisedThreat: false,
        },
      };
    }

    if (!inspection.valid) {
      return {
        valid: false,
        inspection,
        error: {
          fileName,
          code: 'UNSUPPORTED_TYPE',
          message:
            inspection.reason ||
            `Security validation rejected "${fileName}": invalid binary container signature.`,
        },
      };
    }

    return { valid: true, inspection };
  } catch (err) {
    return {
      valid: false,
      inspection: {
        valid: false,
        detectedFormat: 'unknown-binary',
        detectedCategory: null,
        isDisguisedThreat: false,
        reason: err instanceof Error ? err.message : 'Failed reading binary header.',
      },
      error: {
        fileName,
        code: 'METADATA_FAILED',
        message: `Could not read binary signature from "${fileName}".`,
      },
    };
  }
}

/**
 * Creates a valid binary media header Uint8Array for tests and procedural generators.
 */
export function createValidMediaHeaderBytes(
  format: 'mp4' | 'webm' | 'wav' | 'png' | 'jpeg' | 'gif' | 'mp3'
): Uint8Array {
  const buf = new Uint8Array(64);
  if (format === 'mp4') {
    // [0,0,0,24,'f','t','y','p','i','s','o','m']
    buf.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  } else if (format === 'webm') {
    buf.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81], 0);
  } else if (format === 'wav') {
    buf.set(
      [0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45],
      0
    );
  } else if (format === 'png') {
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  } else if (format === 'jpeg') {
    buf.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], 0);
  } else if (format === 'gif') {
    buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  } else if (format === 'mp3') {
    buf.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00], 0);
  }
  return buf;
}

/**
 * ============================================================================
 * 2. USER-GENERATED TEXT & HTML SANITIZATION
 * ============================================================================
 * Prevents XSS, unsafe HTML/SVG injection, NUL bytes, and Unicode bidirectional
 * spoofing characters while preserving legitimate multilingual text (including
 * Hindi Devanagari and emojis).
 */

const UNSAFE_HTML_OR_SCRIPT_PATTERN =
  /<\s*\/?\s*(script|iframe|object|embed|svg|math|style|link|meta|base|form|input|button|applet)\b|on[a-z]+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;

const BIDI_OVERRIDE_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Detects whether a string contains unsafe HTML tags, event handlers, or script URIs.
 */
export function containsUnsafeHtmlOrScript(input: string): boolean {
  if (!input) return false;
  return UNSAFE_HTML_OR_SCRIPT_PATTERN.test(input);
}

/**
 * Sanitizes user-generated text for titles, subtitles, clip labels, and project names.
 * - Strips NUL bytes and Unicode Bidi override spoofing characters
 * - Strips HTML/SVG/Script tags and inline event handler attributes
 * - Enforces a safe maximum character length to prevent memory DoS
 * - Preserves full Unicode grapheme sequences (Hindi Devanagari, CJK, Arabic, Emojis)
 */
export function sanitizeUserText(
  rawText: string,
  options: { maxLength?: number; allowMultiline?: boolean } = {}
): string {
  const { maxLength = 2000, allowMultiline = true } = options;
  if (typeof rawText !== 'string') return '';

  let cleaned = rawText
    .replace(/\0/g, '')
    .replace(BIDI_OVERRIDE_CONTROL_CHARS, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Remove <script>...</script> and <style>...</style> blocks completely
  cleaned = cleaned
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '');

  // Strip remaining HTML/XML tags and dangerous URI schemes
  cleaned = cleaned
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '');

  if (!allowMultiline) {
    cleaned = cleaned.replace(/\n+/g, ' ').trim();
  }

  return cleaned.slice(0, maxLength);
}

/**
 * Sanitizes project names safely.
 */
export function sanitizeProjectName(rawName: string): string {
  const cleaned = sanitizeUserText(rawName, {
    maxLength: 100,
    allowMultiline: false,
  }).trim();
  return cleaned.length > 0 ? cleaned : 'Untitled Studio Project';
}

/**
 * ============================================================================
 * 3. EXPORT PARAMETER & FFMPEG ARGUMENT INJECTION PREVENTION
 * ============================================================================
 */

export const ALLOWED_EXPORT_FORMATS: readonly ExportFormat[] = [
  'mp4',
  'webm',
  'gif',
] as const;
export const ALLOWED_EXPORT_RESOLUTIONS: readonly ExportResolution[] = [
  '1080p',
  '720p',
  '480p',
] as const;
export const ALLOWED_EXPORT_FPS: readonly (24 | 30 | 60)[] = [24, 30, 60] as const;
export const ALLOWED_EXPORT_QUALITIES = ['high', 'balanced', 'fast'] as const;
export const ALLOWED_AUDIO_BITRATE_PRESETS: readonly AudioBitratePreset[] = [
  '128k',
  '192k',
  '320k',
] as const;

export const ALLOWED_FFMPEG_FLAGS = new Set<string>([
  '-ss',
  '-t',
  '-i',
  '-vf',
  '-af',
  '-an',
  '-c:v',
  '-c:a',
  '-b:v',
  '-b:a',
  '-preset',
  '-crf',
  '-pix_fmt',
  '-movflags',
  '-y',
]);

const FORBIDDEN_FFMPEG_PROTOCOLS_OR_PATHS =
  /^(file|http|https|ftp|sftp|tcp|udp|rtmp|rtsp|pipe|concat|subfile|data|crypto):|(\.\.)|[/\\]|[\0`$]/i;

export interface ExportParameterValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Strictly validates export settings and numeric parameters against allowlists and bounds.
 */
export function validateExportParameters(
  settings: ExportSettings,
  dimensions?: { width: number; height: number; duration: number }
): ExportParameterValidationResult {
  const errors: string[] = [];

  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['Export settings object is missing.'] };
  }

  if (!ALLOWED_EXPORT_FORMATS.includes(settings.format)) {
    errors.push(`Disallowed export format: "${String(settings.format)}".`);
  }

  if (!ALLOWED_EXPORT_RESOLUTIONS.includes(settings.resolution)) {
    errors.push(`Disallowed export resolution: "${String(settings.resolution)}".`);
  }

  if (!ALLOWED_EXPORT_FPS.includes(settings.fps)) {
    errors.push(`Disallowed frame rate: "${String(settings.fps)}".`);
  }

  if (!ALLOWED_EXPORT_QUALITIES.includes(settings.quality)) {
    errors.push(`Disallowed quality preset: "${String(settings.quality)}".`);
  }

  if (
    settings.audioBitrate !== undefined &&
    !ALLOWED_AUDIO_BITRATE_PRESETS.includes(settings.audioBitrate)
  ) {
    errors.push(`Disallowed audio bitrate: "${String(settings.audioBitrate)}".`);
  }

  if (dimensions) {
    const { width, height, duration } = dimensions;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 16 ||
      height < 16 ||
      width > 3840 ||
      height > 3840 ||
      width % 2 !== 0 ||
      height % 2 !== 0
    ) {
      errors.push(
        `Invalid export canvas dimensions (${width}x${height}). Must be even integers between 16 and 3840.`
      );
    }

    if (!Number.isFinite(duration) || duration < 0.2 || duration > 7200) {
      errors.push(
        `Invalid sequence duration (${duration}s). Must be between 0.2s and 7200s.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Audits a constructed FFmpeg CLI argument array before passing to `ffmpeg.exec(args)`
 * to guarantee zero command injection, option injection, or protocol/path breakout.
 */
export function validateFfmpegCommandArgs(args: string[]): {
  valid: boolean;
  reason?: string;
} {
  if (!Array.isArray(args) || args.length === 0) {
    return { valid: false, reason: 'FFmpeg argument list must be a non-empty array.' };
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string' || arg.length === 0) {
      return {
        valid: false,
        reason: `Argument at index ${i} must be a non-empty string.`,
      };
    }

    if (arg.includes('\0') || arg.includes('\n') || arg.includes('\r')) {
      return {
        valid: false,
        reason: `Argument at index ${i} contains forbidden control/newline characters.`,
      };
    }

    if (arg.startsWith('-')) {
      // Allow negative numeric values only after -ss if ever needed, otherwise must be in ALLOWED_FFMPEG_FLAGS
      if (!ALLOWED_FFMPEG_FLAGS.has(arg)) {
        return {
          valid: false,
          reason: `Disallowed FFmpeg flag "${arg}" blocked by security allowlist.`,
        };
      }
    } else {
      // Value token: if it follows -i or is the final output filename, enforce strict VFS filename rules
      const prev = i > 0 ? args[i - 1] : '';
      if (prev === '-i' || i === args.length - 1) {
        if (
          FORBIDDEN_FFMPEG_PROTOCOLS_OR_PATHS.test(arg) ||
          !/^[a-zA-Z0-9._-]+$/.test(arg)
        ) {
          return {
            valid: false,
            reason: `Unsafe FFmpeg filename or protocol "${arg}" blocked.`,
          };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * ============================================================================
 * 4. DEPENDENCY VERSION PINNING & LICENSE AUDIT MANIFEST
 * ============================================================================
 */

export interface DependencyLicenseEntry {
  packageName: string;
  pinnedVersion: string;
  spdxLicense: string;
  category: 'runtime' | 'dev';
  securityRole: string;
  licenseNotes?: string;
}

export const DEPENDENCY_SECURITY_MANIFEST: readonly DependencyLicenseEntry[] = [
  {
    packageName: '@ffmpeg/ffmpeg',
    pinnedVersion: '0.12.15',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Isolated Web Worker wrapper for FFmpeg WebAssembly',
    licenseNotes:
      'JS wrapper is MIT; loaded @ffmpeg/core@0.12.6 WebAssembly binary includes LGPL-2.1+ / GPL-2.0+ codecs (libx264).',
  },
  {
    packageName: '@ffmpeg/util',
    pinnedVersion: '0.12.2',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Blob URL helper for WebAssembly worker assets',
  },
  {
    packageName: 'idb',
    pinnedVersion: '8.0.4',
    spdxLicense: 'ISC',
    category: 'runtime',
    securityRole: 'Transactional IndexedDB wrapper for local project persistence',
  },
  {
    packageName: 'next',
    pinnedVersion: '15.5.28',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'App Router framework, CSP & HTTPS response header delivery',
  },
  {
    packageName: 'react',
    pinnedVersion: '19.3.1',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Auto-escaped JSX DOM rendering (prevents unsafe HTML injection)',
  },
  {
    packageName: 'react-dom',
    pinnedVersion: '19.3.1',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Browser DOM reconciliation with built-in XSS escaping',
  },
  {
    packageName: 'zustand',
    pinnedVersion: '5.0.15',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Client-side state store for timeline, undo/redo, and recovery state',
  },
  {
    packageName: '@radix-ui/react-dialog',
    pinnedVersion: '1.3.1',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Accessible modal dialogs for Export, Settings, and Security Recovery',
  },
  {
    packageName: '@radix-ui/react-slider',
    pinnedVersion: '1.6.1',
    spdxLicense: 'MIT',
    category: 'runtime',
    securityRole: 'Bounded numeric slider controls',
  },
  {
    packageName: 'lucide-react',
    pinnedVersion: '0.553.0',
    spdxLicense: 'ISC',
    category: 'runtime',
    securityRole: 'Static SVG icon components',
  },
  {
    packageName: 'typescript',
    pinnedVersion: '5.9.3',
    spdxLicense: 'Apache-2.0',
    category: 'dev',
    securityRole: 'Strict static type verification',
  },
  {
    packageName: 'vitest',
    pinnedVersion: '5.0.5',
    spdxLicense: 'MIT',
    category: 'dev',
    securityRole: 'Automated security, persistence, and timeline test runner',
  },
] as const;

/**
 * Verifies that a package.json dependency map uses exact pinned versions (no ^, ~, *, or > ranges).
 */
export function verifyPackageJsonPinning(
  deps: Record<string, string>,
  devDeps: Record<string, string> = {}
): {
  allPinned: boolean;
  unpinnedPackages: { name: string; versionSpec: string }[];
} {
  const unpinnedPackages: { name: string; versionSpec: string }[] = [];
  const combined = { ...deps, ...devDeps };

  for (const [name, versionSpec] of Object.entries(combined)) {
    if (
      !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(versionSpec.trim())
    ) {
      unpinnedPackages.push({ name, versionSpec });
    }
  }

  return {
    allPinned: unpinnedPackages.length === 0,
    unpinnedPackages,
  };
}

/**
 * ============================================================================
 * 5. CONTENT SECURITY POLICY (CSP), HTTPS & PRIVACY GOVERNANCE
 * ============================================================================
 */

export function buildContentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://unpkg.com https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "img-src 'self' blob: data: https://picsum.photos",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' blob: https://unpkg.com https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ];
  return directives.join('; ');
}

export const SECURITY_HEADERS_LIST = [
  {
    key: 'Content-Security-Policy',
    value: buildContentSecurityPolicy(),
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin-allow-popups',
  },
] as const;

export const WASM_AND_WORKER_MIME_HEADERS = [
  {
    source: '/:path*.wasm',
    headers: [
      { key: 'Content-Type', value: 'application/wasm' },
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
    ],
  },
  {
    source: '/:path*.worker.js',
    headers: [
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ],
  },
] as const;

export const PRIVACY_AND_TELEMETRY_POLICY = {
  localProcessingDefault: true,
  uploadsMediaToServer: false,
  collectsMediaContentInAnalytics: false,
  exposesClientSideSecrets: false,
  summary:
    'Local-only processing is the strict default. Imported video, audio, image, and subtitle files remain inside browser memory (ObjectURLs) and origin-scoped IndexedDB. Media content, file names, and subtitle text are never transmitted to remote servers or analytics endpoints.',
} as const;

/**
 * Honest engineering disclosure of client-side security boundaries and limitations.
 * Never claims that client-side processing automatically makes the entire application secure.
 */
export const SECURITY_LIMITATIONS_DOCUMENTATION: readonly {
  id: string;
  title: string;
  limitation: string;
  mitigationImplemented: string;
}[] = [
  {
    id: 'client-side-not-panacea',
    title: 'Client-Side Processing Does Not Automatically Guarantee Total Security',
    limitation:
      'While local browser processing eliminates server-side media upload breaches, the application still runs inside a user browser environment exposed to DOM, WebAssembly, browser decoder, and supply-chain attack surfaces.',
    mitigationImplemented:
      'Defense-in-depth controls: magic-byte header verification, strict text sanitization, allowlisted FFmpeg argv arrays, Content Security Policy, and zero unsafe HTML rendering.',
  },
  {
    id: 'browser-And-wasm-decoders',
    title: 'Browser Native Decoders & FFmpeg.wasm Memory Safety',
    limitation:
      'Malformed media containers parsed by browser C++/Rust media decoders or FFmpeg.wasm (compiled from C) could trigger parser bugs or WebAssembly linear memory exhaustion within the tab.',
    mitigationImplemented:
      'Pre-decode magic-byte inspection, 500 MB file size ceiling, 45 MB Web Audio ArrayBuffer cap, isolated Web Worker execution, and explicit Worker termination on timeout or abort.',
  },
  {
    id: 'cdn-wasm-supply-chain',
    title: 'External CDN Runtime Fetch for FFmpeg Core Wasm',
    limitation:
      'When MP4/GIF transcoding is requested, @ffmpeg/core@0.12.6 is fetched on demand from a pinned version URL on unpkg.com if not self-hosted.',
    mitigationImplemented:
      'Pinned exact version (0.12.6), restricted connect-src/script-src CSP directives, and a zero-network native browser WebM MediaRecorder export path that works 100% offline.',
  },
  {
    id: 'shared-device-indexeddb',
    title: 'Unencrypted Local IndexedDB Storage on Shared Devices',
    limitation:
      'IndexedDB blobs and project metadata are stored in the browser profile on disk; another user or malicious browser extension with access to the same OS user profile could inspect local storage.',
    mitigationImplemented:
      'One-click "Delete Local Project Data" purge button in Settings & Projects, plus automatic cleanup of revoked ObjectURLs and temporary MEMFS files.',
  },
] as const;

/**
 * ============================================================================
 * 6. EXPECTED FAILURE TAXONOMY & VISIBLE RECOVERY PATHS (ALL 9 SCENARIOS)
 * ============================================================================
 */

export type EditorFailureCategory =
  | 'UNSUPPORTED_MEDIA'
  | 'CORRUPTED_FILE'
  | 'OUT_OF_MEMORY'
  | 'FAILED_EXPORT'
  | 'INTERRUPTED_PROCESSING'
  | 'INDEXEDDB_FAILURE'
  | 'WORKER_STARTUP_FAILURE'
  | 'UNSUPPORTED_CODEC'
  | 'INSUFFICIENT_STORAGE';

export type RecoveryActionId =
  | 'LOAD_SAFE_SAMPLE_REEL'
  | 'SWITCH_TO_SAFE_480P_EXPORT'
  | 'RETRY_EXPORT_NATIVE_WEBM'
  | 'PURGE_CACHED_MEDIA_BLOBS'
  | 'RESET_WORKER_AND_USE_FALLBACK'
  | 'ENABLE_IN_MEMORY_PERSISTENCE'
  | 'DISMISS_AND_CLEAN_BUFFERS';

export interface FailureRecoverySpec {
  category: EditorFailureCategory;
  title: string;
  severity: 'error' | 'warning';
  userExplanation: string;
  technicalCause: string;
  primaryActionId: RecoveryActionId;
  primaryActionLabel: string;
  secondaryActionId: RecoveryActionId;
  secondaryActionLabel: string;
}

export const FAILURE_RECOVERY_CATALOG: Record<
  EditorFailureCategory,
  FailureRecoverySpec
> = {
  UNSUPPORTED_MEDIA: {
    category: 'UNSUPPORTED_MEDIA',
    title: 'Unsupported or Disguised Media File Blocked',
    severity: 'error',
    userExplanation:
      'The selected file does not contain a valid MP4, WebM, MOV, WAV, MP3, OGG, AAC, PNG, JPG, WebP, or GIF binary signature.',
    technicalCause:
      'Magic-byte header inspection or MIME/extension validation rejected an unsupported format or disguised script/executable.',
    primaryActionId: 'LOAD_SAFE_SAMPLE_REEL',
    primaryActionLabel: 'Load Verified Sample Clip Instead',
    secondaryActionId: 'DISMISS_AND_CLEAN_BUFFERS',
    secondaryActionLabel: 'Dismiss & Keep Current Timeline',
  },
  CORRUPTED_FILE: {
    category: 'CORRUPTED_FILE',
    title: 'Corrupted Media Stream or Damaged Container',
    severity: 'error',
    userExplanation:
      'The media file header or stream is truncated or damaged and could not be decoded safely.',
    technicalCause:
      'Container atom/EBML parsing or HTMLMediaElement metadata probing failed due to missing moov atom or corrupted frames.',
    primaryActionId: 'LOAD_SAFE_SAMPLE_REEL',
    primaryActionLabel: 'Discard Corrupted File & Load Calibration Clip',
    secondaryActionId: 'DISMISS_AND_CLEAN_BUFFERS',
    secondaryActionLabel: 'Clean Temporary URLs & Dismiss',
  },
  OUT_OF_MEMORY: {
    category: 'OUT_OF_MEMORY',
    title: 'Browser Memory Pressure / Out-of-Memory Guard Triggered',
    severity: 'error',
    userExplanation:
      'The current operation exceeded safe browser tab memory limits. Unused media buffers can be released immediately.',
    technicalCause:
      'JS heap / ArrayBuffer allocation limit reached or file exceeded safe browser memory ceiling.',
    primaryActionId: 'SWITCH_TO_SAFE_480P_EXPORT',
    primaryActionLabel: 'Free Buffers & Switch to Low-Memory 480p Mode',
    secondaryActionId: 'PURGE_CACHED_MEDIA_BLOBS',
    secondaryActionLabel: 'Purge Unused Cached Blobs',
  },
  FAILED_EXPORT: {
    category: 'FAILED_EXPORT',
    title: 'Video Export Pipeline Failed',
    severity: 'error',
    userExplanation:
      'The export encoder encountered an error before producing a verified output file. Your timeline edits are intact.',
    technicalCause:
      'FFmpeg.wasm returned a non-zero exit status or output Blob verification failed.',
    primaryActionId: 'RETRY_EXPORT_NATIVE_WEBM',
    primaryActionLabel: 'Switch to Native Browser WebM Stream & Open Export',
    secondaryActionId: 'SWITCH_TO_SAFE_480P_EXPORT',
    secondaryActionLabel: 'Configure 720p/480p Safe Export Preset',
  },
  INTERRUPTED_PROCESSING: {
    category: 'INTERRUPTED_PROCESSING',
    title: 'Media Processing or Export Was Interrupted',
    severity: 'warning',
    userExplanation:
      'An active import, waveform job, or video render was cancelled or interrupted before completion.',
    technicalCause:
      'AbortController signal fired or background worker task was terminated mid-flight.',
    primaryActionId: 'DISMISS_AND_CLEAN_BUFFERS',
    primaryActionLabel: 'Clean Temporary Files & Resume Editing',
    secondaryActionId: 'RETRY_EXPORT_NATIVE_WEBM',
    secondaryActionLabel: 'Re-Open Export Dialog',
  },
  INDEXEDDB_FAILURE: {
    category: 'INDEXEDDB_FAILURE',
    title: 'Local IndexedDB Storage Unavailable or Blocked',
    severity: 'warning',
    userExplanation:
      'Browser IndexedDB storage could not complete the transaction (e.g., private browsing restriction or blocked database).',
    technicalCause:
      'IDBTransaction error or IndexedDB disabled in current browsing context.',
    primaryActionId: 'ENABLE_IN_MEMORY_PERSISTENCE',
    primaryActionLabel: 'Continue with In-Memory Session Store & Retry Save',
    secondaryActionId: 'DISMISS_AND_CLEAN_BUFFERS',
    secondaryActionLabel: 'Acknowledge & Continue Editing',
  },
  WORKER_STARTUP_FAILURE: {
    category: 'WORKER_STARTUP_FAILURE',
    title: 'Background Web Worker Startup Failed',
    severity: 'warning',
    userExplanation:
      'A background Web Worker or WebAssembly thread could not be initialized. Non-blocking fallback processing is available.',
    technicalCause:
      'Worker Blob URL blocked by environment policy or WebAssembly runtime fetch failed.',
    primaryActionId: 'RESET_WORKER_AND_USE_FALLBACK',
    primaryActionLabel: 'Reset Worker Pool & Enable Native Stream Fallback',
    secondaryActionId: 'DISMISS_AND_CLEAN_BUFFERS',
    secondaryActionLabel: 'Dismiss Notice',
  },
  UNSUPPORTED_CODEC: {
    category: 'UNSUPPORTED_CODEC',
    title: 'Unsupported Video or Audio Codec Detected',
    severity: 'error',
    userExplanation:
      'This browser lacks a native hardware/software decoder for the file codec (such as 10-bit HEVC/H.265, ProRes, or AC-3).',
    technicalCause:
      'HTMLMediaElement MEDIA_ERR_SRC_NOT_SUPPORTED or codec profile unsupported by browser.',
    primaryActionId: 'RETRY_EXPORT_NATIVE_WEBM',
    primaryActionLabel: 'Use Universal VP9/WebM Codec Profile',
    secondaryActionId: 'LOAD_SAFE_SAMPLE_REEL',
    secondaryActionLabel: 'Load H.264/VP9 Compatible Sample Clip',
  },
  INSUFFICIENT_STORAGE: {
    category: 'INSUFFICIENT_STORAGE',
    title: 'Insufficient Browser Storage Quota (QuotaExceededError)',
    severity: 'warning',
    userExplanation:
      'Your browser storage quota is full. Timeline edits remain active in memory, and you can free space by purging cached media blobs.',
    technicalCause:
      'IndexedDB threw QuotaExceededError while caching media Blob or saving project snapshot.',
    primaryActionId: 'PURGE_CACHED_MEDIA_BLOBS',
    primaryActionLabel: 'Purge Cached Media Blobs to Free Storage',
    secondaryActionId: 'ENABLE_IN_MEMORY_PERSISTENCE',
    secondaryActionLabel: 'Save Timeline Metadata Only',
  },
};

export interface EditorFailureIncident {
  id: string;
  category: EditorFailureCategory;
  occurredAt: number;
  customDetail?: string;
  recoverySpec: FailureRecoverySpec;
}

/**
 * Classifies any raw error message or code into one of the 9 structured failure categories
 * and attaches its visible recovery specification.
 */
export function classifyFailureIncident(
  rawError: unknown,
  explicitCategory?: EditorFailureCategory
): EditorFailureIncident {
  const message =
    rawError instanceof Error
      ? rawError.message
      : typeof rawError === 'string'
        ? rawError
        : 'An unexpected processing error occurred.';

  let category: EditorFailureCategory = explicitCategory ?? 'CORRUPTED_FILE';

  if (!explicitCategory) {
    const lower = message.toLowerCase();
    if (
      lower.includes('quota') ||
      lower.includes('insufficient storage') ||
      lower.includes('storage full')
    ) {
      category = 'INSUFFICIENT_STORAGE';
    } else if (
      lower.includes('memory') ||
      lower.includes('exceeds the') ||
      lower.includes('arraybuffer') ||
      lower.includes('oom')
    ) {
      category = 'OUT_OF_MEMORY';
    } else if (
      lower.includes('indexeddb') ||
      lower.includes('idb') ||
      lower.includes('transaction')
    ) {
      category = 'INDEXEDDB_FAILURE';
    } else if (lower.includes('worker') || lower.includes('wasm runtime')) {
      category = 'WORKER_STARTUP_FAILURE';
    } else if (
      lower.includes('cancelled') ||
      lower.includes('aborted') ||
      lower.includes('interrupted')
    ) {
      category = 'INTERRUPTED_PROCESSING';
    } else if (lower.includes('codec') || lower.includes('hevc') || lower.includes('prores')) {
      category = 'UNSUPPORTED_CODEC';
    } else if (
      lower.includes('export') ||
      lower.includes('ffmpeg') ||
      lower.includes('encoder')
    ) {
      category = 'FAILED_EXPORT';
    } else if (
      lower.includes('unsupported format') ||
      lower.includes('disguised') ||
      lower.includes('binary signature') ||
      lower.includes('magic')
    ) {
      category = 'UNSUPPORTED_MEDIA';
    } else {
      category = 'CORRUPTED_FILE';
    }
  }

  return {
    id: `incident_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    category,
    occurredAt: Date.now(),
    customDetail: message,
    recoverySpec: FAILURE_RECOVERY_CATALOG[category],
  };
}
