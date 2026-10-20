import {
  TextAnimationPreset,
  TextOverlayStyle,
  TimelineClip,
} from '@/types/editor';
import {
  MIN_CLIP_DURATION,
  secondsToTicks,
  ticksToSeconds,
} from '@/lib/timeline/engine';
import { sanitizeUserText } from '@/lib/security/security-controls';

export interface FontFamilyOption {
  id: string;
  label: string;
  cssFamily: string;
  scriptSupport: string;
}

export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  {
    id: 'plus-jakarta',
    label: 'Plus Jakarta Sans',
    cssFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
    scriptSupport: 'Latin, Extended Latin & Symbols',
  },
  {
    id: 'inter-system',
    label: 'Inter / System UI',
    cssFamily: 'Inter, system-ui, -apple-system, sans-serif',
    scriptSupport: 'Latin, Cyrillic, Greek & Multilingual UI',
  },
  {
    id: 'noto-devanagari',
    label: 'Noto Sans Devanagari (Hindi / Unicode)',
    cssFamily:
      '"Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", system-ui, sans-serif',
    scriptSupport: 'Hindi (हिन्दी), Marathi, Sanskrit & Full Unicode',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    cssFamily: '"JetBrains Mono", monospace',
    scriptSupport: 'Timecode, Technical Captions & Monospace',
  },
  {
    id: 'georgia-serif',
    label: 'Georgia Editorial Serif',
    cssFamily: 'Georgia, Cambria, "Times New Roman", serif',
    scriptSupport: 'Cinema Titles & Documentary Lower-Thirds',
  },
  {
    id: 'impact-display',
    label: 'Impact Heavy Display',
    cssFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    scriptSupport: 'Bold Social Headlines & Memes',
  },
];

export const TEXT_ANIMATION_OPTIONS: {
  id: TextAnimationPreset;
  label: string;
  description: string;
}[] = [
  {
    id: 'none',
    label: 'Static (None)',
    description: 'Immediate crisp appearance with no motion.',
  },
  {
    id: 'fade-in-out',
    label: 'Smooth Fade',
    description: 'Gentle opacity dissolve on entry and exit.',
  },
  {
    id: 'slide-up',
    label: 'Slide Up Reveal',
    description: 'Rises smoothly into position on entry.',
  },
  {
    id: 'pop-in',
    label: 'Kinetic Pop-In',
    description: 'Elastic scale-up entrance for punchy titles.',
  },
  {
    id: 'typewriter',
    label: 'Typewriter (Grapheme-Safe)',
    description: 'Reveals text character-by-character (supports Hindi & Emoji).',
  },
];

export interface SubtitleCueEntry {
  id: string;
  index: number;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;      // supports multiline (\n) and Unicode/Hindi
}

export interface SubtitleValidationIssue {
  cueIndex: number;
  code:
    | 'INVALID_TIMESTAMP'
    | 'END_BEFORE_START'
    | 'DURATION_TOO_SHORT'
    | 'EMPTY_TEXT';
  message: string;
}

export interface SubtitleOverlapWarning {
  firstId: string;
  secondId: string;
  firstIndex: number;
  secondIndex: number;
  overlapStart: number;
  overlapEnd: number;
  overlapDuration: number;
}

export interface SrtParseResult {
  entries: SubtitleCueEntry[];
  errors: SubtitleValidationIssue[];
  overlaps: SubtitleOverlapWarning[];
}

export interface TextBoundingBoxMetrics {
  scaleFactor: number;
  scaledFontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  lines: string[];
  maxLineWidth: number;
  boxWidth: number;
  boxHeight: number;
  anchorX: number;
  anchorY: number;
  boxX: number;
  boxY: number;
  centerX: number;
  centerY: number;
  rotationDeg: number;
}

export interface EvaluatedTextAnimation {
  opacityMultiplier: number;
  offsetYNormalized: number;
  scaleMultiplier: number;
  visibleText: string;
}

/**
 * Segments a string into user-perceived grapheme clusters so Unicode surrogate pairs,
 * emojis, and Hindi Devanagari consonant+matra sequences (e.g. "नमस्ते") are never
 * split mid-character during typewriter animations or truncation.
 */
export function splitUnicodeGraphemes(text: string): string[] {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * Computes a consistent resolution scale factor so preview and export resolutions
 * (1080p, 720p, 480p) across both landscape (16:9) and portrait (9:16, 4:5, 1:1)
 * projects preserve 1:1 relative typography, outline widths, and padding.
 */
export function computeTextScaleFactor(
  canvasWidth: number,
  canvasHeight: number
): number {
  const shorterEdge = Math.max(1, Math.min(canvasWidth, canvasHeight));
  return shorterEdge / 1080;
}

/**
 * Computes exact text box layout and applies optional canvas boundary clamping
 * (`keepWithinCanvas`) so text never overflows outside the output frame.
 */
export function computeTextBoundingBox(
  style: TextOverlayStyle,
  canvasWidth: number,
  canvasHeight: number,
  measureLineWidth?: (line: string, scaledFontSize: number, fontSpec: string) => number,
  overrideText?: string
): TextBoundingBoxMetrics {
  const scaleFactor = computeTextScaleFactor(canvasWidth, canvasHeight);
  const scaledFontSize = Math.max(
    12,
    Math.round((style.fontSize || 56) * scaleFactor)
  );
  const fontWeight = style.fontWeight || 700;
  const fontFamily = style.fontFamily || 'Plus Jakarta Sans, sans-serif';
  const fontSpec = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;

  const rawText = overrideText !== undefined ? overrideText : style.text || '';
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const lineHeight = scaledFontSize * 1.28;
  const totalHeight = Math.max(lineHeight, lines.length * lineHeight);

  let maxLineWidth = 0;
  for (const line of lines) {
    let width = 0;
    if (measureLineFnAvailable(measureLineWidth)) {
      width = measureLineWidth(line, scaledFontSize, fontSpec);
    } else {
      const graphemes = splitUnicodeGraphemes(line);
      width = graphemes.length * scaledFontSize * 0.56;
    }
    if (width > maxLineWidth) {
      maxLineWidth = width;
    }
  }

  const padX = scaledFontSize * 0.55;
  const padY = scaledFontSize * 0.35;
  const boxWidth = Math.min(canvasWidth * 0.96, maxLineWidth + padX * 2);
  const boxHeight = Math.min(canvasHeight * 0.92, totalHeight + padY * 2);

  const normX = Number.isFinite(style.x) ? style.x : 0.5;
  const normY = Number.isFinite(style.y) ? style.y : 0.84;

  let anchorX = canvasWidth * normX;
  let anchorY = canvasHeight * normY;

  let boxX = anchorX - boxWidth / 2;
  if (style.textAlign === 'left') boxX = anchorX - padX;
  if (style.textAlign === 'right') boxX = anchorX - boxWidth + padX;
  let boxY = anchorY - boxHeight / 2;

  // Keep text within the output canvas when requested (default true)
  if (style.keepWithinCanvas !== false) {
    const marginX = Math.max(8, canvasWidth * 0.02);
    const marginY = Math.max(8, canvasHeight * 0.02);

    if (boxX < marginX) {
      const deltaX = marginX - boxX;
      boxX += deltaX;
      anchorX += deltaX;
    } else if (boxX + boxWidth > canvasWidth - marginX) {
      const deltaX = boxX + boxWidth - (canvasWidth - marginX);
      boxX -= deltaX;
      anchorX -= deltaX;
    }

    if (boxY < marginY) {
      const deltaY = marginY - boxY;
      boxY += deltaY;
      anchorY += deltaY;
    } else if (boxY + boxHeight > canvasHeight - marginY) {
      const deltaY = boxY + boxHeight - (canvasHeight - marginY);
      boxY -= deltaY;
      anchorY -= deltaY;
    }
  }

  return {
    scaleFactor,
    scaledFontSize,
    lineHeight,
    padX,
    padY,
    lines,
    maxLineWidth,
    boxWidth,
    boxHeight,
    anchorX,
    anchorY,
    boxX,
    boxY,
    centerX: boxX + boxWidth / 2,
    centerY: boxY + boxHeight / 2,
    rotationDeg: Number(style.rotation) || 0,
  };
}

function measureLineFnAvailable(
  fn?: (line: string, scaledFontSize: number, fontSpec: string) => number
): fn is (line: string, scaledFontSize: number, fontSpec: string) => number {
  return typeof fn === 'function';
}

/**
 * Clamps normalized (x, y) coordinates so that a text overlay stays inside the canvas bounds.
 */
export function clampNormalizedTextPosition(
  style: TextOverlayStyle,
  canvasWidth = 1920,
  canvasHeight = 1080
): { x: number; y: number } {
  const rawX = Math.max(0.02, Math.min(0.98, Number(style.x) || 0.5));
  const rawY = Math.max(0.02, Math.min(0.98, Number(style.y) || 0.84));
  if (style.keepWithinCanvas === false) {
    return {
      x: Number(rawX.toFixed(4)),
      y: Number(rawY.toFixed(4)),
    };
  }

  const metrics = computeTextBoundingBox(
    { ...style, x: rawX, y: rawY, keepWithinCanvas: true },
    canvasWidth,
    canvasHeight
  );

  return {
    x: Number(
      Math.max(0.02, Math.min(0.98, metrics.anchorX / Math.max(1, canvasWidth))).toFixed(4)
    ),
    y: Number(
      Math.max(0.02, Math.min(0.98, metrics.anchorY / Math.max(1, canvasHeight))).toFixed(4)
    ),
  };
}

/**
 * Maps a pointer event client coordinate to normalized [0..1, 0..1] canvas coordinates.
 * Guarantees consistent coordinate mapping regardless of CSS display zoom or export resolution.
 */
export function mapClientPointToNormalizedCanvas(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } {
  const safeWidth = Math.max(1, canvasRect.width);
  const safeHeight = Math.max(1, canvasRect.height);
  const normX = (clientX - canvasRect.left) / safeWidth;
  const normY = (clientY - canvasRect.top) / safeHeight;
  return {
    x: Number(Math.max(0.02, Math.min(0.98, normX)).toFixed(4)),
    y: Number(Math.max(0.02, Math.min(0.98, normY)).toFixed(4)),
  };
}

/**
 * Hit-tests whether a normalized canvas point (normX, normY) is inside a text clip's rendered box.
 * Accounts for text rotation around the box center.
 */
export function hitTestTextClipAtPoint(
  normX: number,
  normY: number,
  clip: TimelineClip,
  canvasWidth: number,
  canvasHeight: number,
  measureLineWidth?: (line: string, scaledFontSize: number, fontSpec: string) => number
): boolean {
  if (clip.trackType !== 'text' || !clip.textStyle || !clip.textStyle.text.trim()) {
    return false;
  }

  const metrics = computeTextBoundingBox(
    clip.textStyle,
    canvasWidth,
    canvasHeight,
    measureLineWidth
  );

  const px = normX * canvasWidth;
  const py = normY * canvasHeight;

  // Inverse rotate test point around box center if rotated
  const rad = (-metrics.rotationDeg * Math.PI) / 180;
  const dx = px - metrics.centerX;
  const dy = py - metrics.centerY;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad) + metrics.centerX;
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad) + metrics.centerY;

  const hitPad = 8;
  return (
    localX >= metrics.boxX - hitPad &&
    localX <= metrics.boxX + metrics.boxWidth + hitPad &&
    localY >= metrics.boxY - hitPad &&
    localY <= metrics.boxY + metrics.boxHeight + hitPad
  );
}

/**
 * Evaluates a text clip's animation preset at `timelineTime`.
 */
export function evaluateTextAnimationAtTime(
  clip: TimelineClip,
  timelineTime: number
): EvaluatedTextAnimation {
  const style = clip.textStyle;
  const fullText = style?.text ?? '';
  const preset: TextAnimationPreset = style?.animation || 'none';

  const duration = Math.max(MIN_CLIP_DURATION, clip.duration);
  const elapsed = Math.max(0, Math.min(duration, timelineTime - clip.startTime));
  const remaining = Math.max(0, duration - elapsed);
  const entranceWindow = Math.min(0.45, duration * 0.35);
  const exitWindow = Math.min(0.35, duration * 0.25);

  if (preset === 'none') {
    return {
      opacityMultiplier: 1,
      offsetYNormalized: 0,
      scaleMultiplier: 1,
      visibleText: fullText,
    };
  }

  if (preset === 'fade-in-out') {
    let opacity = 1;
    if (entranceWindow > 0 && elapsed < entranceWindow) {
      opacity = Math.min(opacity, elapsed / entranceWindow);
    }
    if (exitWindow > 0 && remaining < exitWindow) {
      opacity = Math.min(opacity, remaining / exitWindow);
    }
    return {
      opacityMultiplier: Math.max(0, Math.min(1, opacity)),
      offsetYNormalized: 0,
      scaleMultiplier: 1,
      visibleText: fullText,
    };
  }

  if (preset === 'slide-up') {
    const t = entranceWindow > 0 ? Math.min(1, elapsed / entranceWindow) : 1;
    // Cubic ease-out
    const eased = 1 - Math.pow(1 - t, 3);
    return {
      opacityMultiplier: Math.max(0, Math.min(1, eased)),
      offsetYNormalized: (1 - eased) * 0.045,
      scaleMultiplier: 1,
      visibleText: fullText,
    };
  }

  if (preset === 'pop-in') {
    const t = entranceWindow > 0 ? Math.min(1, elapsed / entranceWindow) : 1;
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 0.72 + 0.28 * eased;
    return {
      opacityMultiplier: Math.max(0, Math.min(1, eased)),
      offsetYNormalized: 0,
      scaleMultiplier: scale,
      visibleText: fullText,
    };
  }

  if (preset === 'typewriter') {
    const graphemes = splitUnicodeGraphemes(fullText);
    if (graphemes.length === 0) {
      return {
        opacityMultiplier: 1,
        offsetYNormalized: 0,
        scaleMultiplier: 1,
        visibleText: '',
      };
    }
    const revealDuration = Math.max(0.2, duration * 0.75);
    const ratio = Math.max(0, Math.min(1, elapsed / revealDuration));
    const count = Math.max(1, Math.ceil(ratio * graphemes.length));
    return {
      opacityMultiplier: 1,
      offsetYNormalized: 0,
      scaleMultiplier: 1,
      visibleText: graphemes.slice(0, count).join(''),
    };
  }

  return {
    opacityMultiplier: 1,
    offsetYNormalized: 0,
    scaleMultiplier: 1,
    visibleText: fullText,
  };
}

/**
 * Parses an SRT timestamp (`HH:MM:SS,mmm` or `HH:MM:SS.mmm`) into seconds.
 * Returns `null` if malformed.
 */
export function parseSrtTimestamp(raw: string): number | null {
  const trimmed = (raw || '').trim();
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(trimmed);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const msStr = match[4].padEnd(3, '0');
  const millis = Number(msStr);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(millis)
  ) {
    return null;
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds + millis / 1000;
  return ticksToSeconds(secondsToTicks(totalSeconds));
}

/**
 * Formats seconds into standard SRT timestamp format (`HH:MM:SS,mmm`).
 */
export function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMillis = Math.round(clamped * 1000);

  const hours = Math.floor(totalMillis / 3_600_000);
  const remAfterHours = totalMillis % 3_600_000;
  const minutes = Math.floor(remAfterHours / 60_000);
  const remAfterMinutes = remAfterHours % 60_000;
  const secs = Math.floor(remAfterMinutes / 1000);
  const millis = remAfterMinutes % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0'
  )}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * Validates start and end timestamps for a subtitle or text overlay cue.
 */
export function validateSubtitleTiming(
  startTime: number,
  endTime: number,
  cueIndex = 1
): { valid: boolean; issue?: SubtitleValidationIssue } {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0) {
    return {
      valid: false,
      issue: {
        cueIndex,
        code: 'INVALID_TIMESTAMP',
        message: `Cue #${cueIndex} has an invalid or negative timestamp.`,
      },
    };
  }

  if (endTime <= startTime) {
    return {
      valid: false,
      issue: {
        cueIndex,
        code: 'END_BEFORE_START',
        message: `Cue #${cueIndex} end time (${endTime.toFixed(
          2
        )}s) must be greater than start time (${startTime.toFixed(2)}s).`,
      },
    };
  }

  if (endTime - startTime < MIN_CLIP_DURATION - 1e-4) {
    return {
      valid: false,
      issue: {
        cueIndex,
        code: 'DURATION_TOO_SHORT',
        message: `Cue #${cueIndex} duration (${(endTime - startTime).toFixed(
          2
        )}s) is shorter than the minimum ${MIN_CLIP_DURATION.toFixed(2)}s.`,
      },
    };
  }

  return { valid: true };
}

/**
 * Deterministically sorts subtitle entries by startTime ascending, then endTime ascending,
 * and re-indexes them sequentially from 1..N.
 */
export function sortSubtitleEntries(
  entries: SubtitleCueEntry[]
): SubtitleCueEntry[] {
  return [...entries]
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
    .map((entry, idx) => ({
      ...entry,
      index: idx + 1,
    }));
}

/**
 * Detects overlapping subtitle entries in a sorted list.
 */
export function detectSubtitleOverlaps(
  entries: SubtitleCueEntry[]
): SubtitleOverlapWarning[] {
  const sorted = sortSubtitleEntries(entries);
  const overlaps: SubtitleOverlapWarning[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (next.startTime < curr.endTime - 0.001) {
      const overlapStart = next.startTime;
      const overlapEnd = Math.min(curr.endTime, next.endTime);
      overlaps.push({
        firstId: curr.id,
        secondId: next.id,
        firstIndex: curr.index,
        secondIndex: next.index,
        overlapStart: ticksToSeconds(secondsToTicks(overlapStart)),
        overlapEnd: ticksToSeconds(secondsToTicks(overlapEnd)),
        overlapDuration: ticksToSeconds(
          secondsToTicks(Math.max(0.001, curr.endTime - next.startTime))
        ),
      });
    }
  }

  return overlaps;
}

/**
 * Resolves overlapping subtitle entries by shifting subsequent cues forward on the timeline
 * while preserving each cue's duration.
 */
export function resolveSubtitleEntryOverlaps(
  entries: SubtitleCueEntry[]
): SubtitleCueEntry[] {
  const sorted = sortSubtitleEntries(entries);
  const resolved: SubtitleCueEntry[] = [];
  let cursorTicks = 0;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const durationTicks = Math.max(
      secondsToTicks(MIN_CLIP_DURATION),
      secondsToTicks(entry.endTime - entry.startTime)
    );
    const startTicks = Math.max(cursorTicks, secondsToTicks(entry.startTime));
    const endTicks = startTicks + durationTicks;
    cursorTicks = endTicks;

    resolved.push({
      ...entry,
      index: i + 1,
      startTime: ticksToSeconds(startTicks),
      endTime: ticksToSeconds(endTicks),
    });
  }

  return resolved;
}

/**
 * Parses an `.srt` subtitle file string into validated, sorted `SubtitleCueEntry` items.
 * Supports multiline subtitles, UTF-8 BOM, Unicode emojis, and Hindi Devanagari characters.
 */
export function parseSrtSubtitles(srtContent: string): SrtParseResult {
  const cleaned = (srtContent || '')
    .replace(/^\uFEFF/, '') // Strip UTF-8 BOM if present
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!cleaned) {
    return { entries: [], errors: [], overlaps: [] };
  }

  const rawBlocks = cleaned.split(/\n{2,}/);
  const entries: SubtitleCueEntry[] = [];
  const errors: SubtitleValidationIssue[] = [];

  rawBlocks.forEach((block, blockIdx) => {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l, idx) => !(idx === 0 && l.trim() === ''));

    if (lines.length === 0) return;

    // Determine whether line 0 is a numeric cue index or the timestamp line directly
    let timeLineIdx = 0;
    let cueNumber = blockIdx + 1;
    if (/^\d+$/.test(lines[0].trim()) && lines.length >= 2) {
      cueNumber = Number(lines[0].trim()) || blockIdx + 1;
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx] || '';
    const arrowParts = timeLine.split('-->');
    if (arrowParts.length !== 2) {
      errors.push({
        cueIndex: cueNumber,
        code: 'INVALID_TIMESTAMP',
        message: `Cue #${cueNumber} has a malformed timestamp line: "${timeLine}". Expected "HH:MM:SS,mmm --> HH:MM:SS,mmm".`,
      });
      return;
    }

    // Strip optional SRT position coordinates after timestamp if present
    const startRaw = arrowParts[0].trim().split(/\s+/)[0];
    const endRaw = arrowParts[1].trim().split(/\s+/)[0];

    const startTime = parseSrtTimestamp(startRaw);
    const endTime = parseSrtTimestamp(endRaw);

    if (startTime === null || endTime === null) {
      errors.push({
        cueIndex: cueNumber,
        code: 'INVALID_TIMESTAMP',
        message: `Cue #${cueNumber} contains an unparseable timestamp ("${startRaw} --> ${endRaw}").`,
      });
      return;
    }

    const timingValidation = validateSubtitleTiming(
      startTime,
      endTime,
      cueNumber
    );
    if (!timingValidation.valid && timingValidation.issue) {
      errors.push(timingValidation.issue);
      return;
    }

    // Join remaining lines to preserve multiline subtitles, stripping unsafe HTML/script tags safely
    const rawSubText = lines.slice(timeLineIdx + 1).join('\n');
    const text = sanitizeUserText(rawSubText, {
      maxLength: 1000,
      allowMultiline: true,
    }).trim();

    if (!text) {
      errors.push({
        cueIndex: cueNumber,
        code: 'EMPTY_TEXT',
        message: `Cue #${cueNumber} has no subtitle text.`,
      });
      return;
    }

    entries.push({
      id: `srt_cue_${cueNumber}_${Math.random().toString(36).slice(2, 6)}`,
      index: cueNumber,
      startTime,
      endTime,
      text,
    });
  });

  const sortedEntries = sortSubtitleEntries(entries);
  const overlaps = detectSubtitleOverlaps(sortedEntries);

  return {
    entries: sortedEntries,
    errors,
    overlaps,
  };
}

/**
 * Serializes timeline text/subtitle clips into a standard UTF-8 `.srt` subtitle file string.
 */
export function serializeSubtitlesToSrt(clips: TimelineClip[]): string {
  const textClips = clips
    .filter(
      (c) =>
        c.trackType === 'text' &&
        c.textStyle &&
        c.textStyle.text.trim().length > 0
    )
    .sort((a, b) => a.startTime - b.startTime || a.duration - b.duration);

  if (textClips.length === 0) {
    return '';
  }

  return textClips
    .map((clip, idx) => {
      const startTc = formatSrtTimestamp(clip.startTime);
      const endTc = formatSrtTimestamp(clip.startTime + clip.duration);
      const cleanText = (clip.textStyle?.text || clip.label)
        .replace(/\r\n/g, '\n')
        .trim();
      return `${idx + 1}\n${startTc} --> ${endTc}\n${cleanText}`;
    })
    .join('\n\n')
    .concat('\n');
}

/**
 * Escapes arbitrary user text or multiline subtitles for FFmpeg's `drawtext` filter.
 * Prevents filter-chain breakout, option injection, and shell metacharacter injection.
 * Preserves Unicode and Hindi Devanagari characters.
 */
export function escapeFfmpegDrawtextText(rawText: string): string {
  const sanitized = sanitizeUserText(rawText || '', {
    maxLength: 2000,
    allowMultiline: true,
  });

  // In FFmpeg drawtext filter syntax inside single quotes or filtergraphs:
  // Backslashes, colons, single quotes, percent signs, commas, semicolons, and brackets must be escaped.
  return sanitized
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, '\\n');
}

/**
 * Generates a validated, injection-safe FFmpeg `drawtext` filter string for a text/subtitle clip
 * mapped to the target export resolution (`canvasWidth` × `canvasHeight`).
 */
export function buildFfmpegDrawtextFilter(
  clip: TimelineClip,
  canvasWidth: number,
  canvasHeight: number
): string {
  if (clip.trackType !== 'text' || !clip.textStyle) {
    throw new Error('Clip does not contain a valid textStyle for drawtext.');
  }

  const style = clip.textStyle;
  const metrics = computeTextBoundingBox(style, canvasWidth, canvasHeight);
  const escapedText = escapeFfmpegDrawtextText(style.text);

  const safeColor = /^#[0-9a-fA-F]{6}$/.test(style.color || '')
    ? style.color
    : '#FFFFFF';
  const safeOutlineColor = /^#[0-9a-fA-F]{6}$/.test(style.outlineColor || '')
    ? style.outlineColor
    : '#000000';

  const startSec = Math.max(0, Number(clip.startTime) || 0).toFixed(3);
  const endSec = Math.max(
    0.2,
    (Number(clip.startTime) || 0) + (Number(clip.duration) || 0.2)
  ).toFixed(3);

  const xPx = Math.round(metrics.boxX + metrics.padX);
  const yPx = Math.round(metrics.boxY + metrics.padY);
  const borderW = Math.max(0, Math.round((style.outlineWidth || 0) * metrics.scaleFactor));

  const filterParts: string[] = [
    `text='${escapedText}'`,
    `fontsize=${metrics.scaledFontSize}`,
    `fontcolor=${safeColor}`,
    `x=${xPx}`,
    `y=${yPx}`,
  ];

  if (borderW > 0) {
    filterParts.push(`borderw=${borderW}`, `bordercolor=${safeOutlineColor}`);
  }

  if (style.backgroundColor && style.backgroundColor !== 'transparent') {
    filterParts.push(
      'box=1',
      'boxcolor=black@0.75',
      `boxborderw=${Math.round(metrics.padY)}`
    );
  }

  filterParts.push(`enable='between(t\\,${startSec}\\,${endSec})'`);

  return `drawtext=${filterParts.join(':')}`;
}

/**
 * Returns transparent documentation of browser vs. FFmpeg.wasm text & subtitle rendering capabilities.
 */
export function getTextAndSubtitleCapabilities(): {
  feature: string;
  previewSupport: string;
  exportSupport: string;
  limitationNote: string;
}[] {
  return [
    {
      feature: 'Unicode & Hindi (Devanagari) Shaping',
      previewSupport: 'Native Browser HarfBuzz / DirectWrite Canvas 2D shaping',
      exportSupport:
        '100% WYSIWYG via Canvas-composited frame stream into FFmpeg.wasm',
      limitationNote:
        'Standalone FFmpeg.wasm drawtext lacks bundled Devanagari .ttf fonts in MEMFS unless uploaded; FrameForge composites text via the browser Canvas pipeline before WASM encoding so Hindi matras and ligatures match preview 1:1.',
    },
    {
      feature: 'Custom Web Fonts & Weights',
      previewSupport: 'Any loaded CSS / Google Font or system font',
      exportSupport: 'Preserved identically via Canvas frame rasterization',
      limitationNote:
        'If a selected font is not installed on the client OS, the browser falls back to the next font in the CSS font stack.',
    },
    {
      feature: 'SRT Subtitle Import & Export',
      previewSupport: 'Full .srt parser with multiline, timestamp & overlap checks',
      exportSupport: 'Burned-in video captions + standalone .srt file download',
      limitationNote:
        'Advanced ASS/SSA karaoke styling tags are stripped during SRT import to maintain clean cross-player compatibility.',
    },
  ];
}
