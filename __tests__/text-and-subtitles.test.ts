import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildFfmpegDrawtextFilter,
  clampNormalizedTextPosition,
  computeTextBoundingBox,
  computeTextScaleFactor,
  detectSubtitleOverlaps,
  escapeFfmpegDrawtextText,
  evaluateTextAnimationAtTime,
  formatSrtTimestamp,
  getTextAndSubtitleCapabilities,
  hitTestTextClipAtPoint,
  mapClientPointToNormalizedCanvas,
  parseSrtSubtitles,
  parseSrtTimestamp,
  resolveSubtitleEntryOverlaps,
  serializeSubtitlesToSrt,
  splitUnicodeGraphemes,
  validateSubtitleTiming,
} from '@/lib/subtitles/text-and-subtitles';
import { useEditorStore } from '@/store/use-editor-store';

describe('Text & Subtitle Editing Module Suite', () => {
  beforeEach(() => {
    useEditorStore.getState().resetToDemoProject();
  });

  it('1. Parses and formats SRT timestamps and validates subtitle start/end times', () => {
    expect(parseSrtTimestamp('00:01:05,250')).toBeCloseTo(65.25, 3);
    expect(parseSrtTimestamp('01:00:00.500')).toBeCloseTo(3600.5, 3);
    expect(parseSrtTimestamp('invalid')).toBeNull();
    expect(formatSrtTimestamp(65.25)).toBe('00:01:05,250');

    expect(validateSubtitleTiming(1.0, 3.5).valid).toBe(true);
    expect(validateSubtitleTiming(-1, 2.0).valid).toBe(false);
    expect(validateSubtitleTiming(4.0, 2.0).issue?.code).toBe('END_BEFORE_START');
    expect(validateSubtitleTiming(2.0, 2.05).issue?.code).toBe(
      'DURATION_TOO_SHORT'
    );
  });

  it('2. Parses SRT files with out-of-order entries, multiline cues, and Unicode/Hindi characters, and exports valid SRT', () => {
    const sampleSrt = `\uFEFF2
00:00:04,000 --> 00:00:07,200
नमस्ते दुनिया!
फ़्रेमफ़ोर्ज स्टूडियो में आपका स्वागत है।

1
00:00:00,500 --> 00:00:03,000
Welcome to <b>FrameForge Studio</b>
Line two of multiline English subtitle.

3
00:00:09,000 --> 00:00:08,000
Invalid cue where end is before start
`;

    const result = parseSrtSubtitles(sampleSrt);
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('END_BEFORE_START');

    // Sorted by startTime ascending
    expect(result.entries[0].startTime).toBeCloseTo(0.5, 3);
    expect(result.entries[0].text).toBe(
      'Welcome to FrameForge Studio\nLine two of multiline English subtitle.'
    );
    expect(result.entries[1].startTime).toBeCloseTo(4.0, 3);
    expect(result.entries[1].text).toContain('नमस्ते दुनिया!');
    expect(result.entries[1].text).toContain('फ़्रेमफ़ोर्ज स्टूडियो');

    // Import into store and serialize back to SRT
    const store = useEditorStore.getState();
    store.createNewBlankProject();
    useEditorStore.getState().importSubtitlesBatch(
      result.entries.map((e) => ({
        startTime: e.startTime,
        duration: e.endTime - e.startTime,
        text: e.text,
      }))
    );

    const exportedSrt = serializeSubtitlesToSrt(useEditorStore.getState().clips);
    expect(exportedSrt).toContain('00:00:00,500 --> 00:00:03,000');
    expect(exportedSrt).toContain('नमस्ते दुनिया!');
    expect(exportedSrt).toContain('Line two of multiline English subtitle.');
  });

  it('3. Detects and resolves overlapping subtitle cues', () => {
    const overlappingSrt = `1
00:00:01,000 --> 00:00:04,500
First subtitle cue

2
00:00:03,000 --> 00:00:06,000
Overlapping second cue
`;

    const parsed = parseSrtSubtitles(overlappingSrt);
    expect(parsed.overlaps).toHaveLength(1);
    expect(parsed.overlaps[0].overlapDuration).toBeCloseTo(1.5, 2);

    const resolved = resolveSubtitleEntryOverlaps(parsed.entries);
    expect(detectSubtitleOverlaps(resolved)).toHaveLength(0);
    expect(resolved[0].startTime).toBeCloseTo(1.0, 2);
    expect(resolved[0].endTime).toBeCloseTo(4.5, 2);
    expect(resolved[1].startTime).toBeCloseTo(4.5, 2);
    expect(resolved[1].endTime).toBeCloseTo(7.5, 2);
  });

  it('4. Escapes FFmpeg drawtext filter text safely against command/filter injection while preserving Unicode & Hindi', () => {
    const maliciousText = `Hello: 'world'; [in]rm -rf /\\test%100\nनमस्ते`;
    const escaped = escapeFfmpegDrawtextText(maliciousText);

    expect(escaped).toContain('\\:');
    expect(escaped).toContain("\\'");
    expect(escaped).toContain('\\;');
    expect(escaped).toContain('\\[');
    expect(escaped).toContain('\\%');
    expect(escaped).toContain('\\nनमस्ते');

    const state = useEditorStore.getState();
    const textClip = state.clips.find((c) => c.trackType === 'text')!;
    state.updateClipTextStyle(textClip.id, {
      text: `Chapter 1: Intro, 'Hindi: नमस्ते'`,
      outlineWidth: 3,
      outlineColor: '#000000',
    });

    const updatedClip = useEditorStore
      .getState()
      .clips.find((c) => c.id === textClip.id)!;
    const filterStr = buildFfmpegDrawtextFilter(updatedClip, 1920, 1080);

    expect(filterStr).toContain('drawtext=text=');
    expect(filterStr).toContain('Chapter 1\\: Intro\\,');
    expect(filterStr).toContain('नमस्ते');
    expect(filterStr).toContain("enable='between(t\\,");
  });

  it('5. Maintains consistent coordinate mapping across preview/export resolutions and portrait/landscape aspect ratios, and clamps text within canvas', () => {
    // 1080p vs 720p vs 480p scale factors are strictly proportional
    expect(computeTextScaleFactor(1920, 1080)).toBeCloseTo(1.0, 4);
    expect(computeTextScaleFactor(1280, 720)).toBeCloseTo(2 / 3, 4);
    expect(computeTextScaleFactor(1080, 1920)).toBeCloseTo(1.0, 4); // 9:16 portrait 1080p

    // Pointer client coordinates map consistently to normalized [0..1]
    const norm = mapClientPointToNormalizedCanvas(150, 300, {
      left: 50,
      top: 100,
      width: 200,
      height: 400,
    });
    expect(norm.x).toBeCloseTo(0.5, 3);
    expect(norm.y).toBeCloseTo(0.5, 3);

    // Clamping keeps extreme x/y positions inside canvas margins when keepWithinCanvas is true
    const clamped = clampNormalizedTextPosition(
      {
        text: 'Long headline text that should stay inside the output canvas bounds',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 64,
        fontWeight: 700,
        color: '#FFFFFF',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        textAlign: 'center',
        x: 0.99,
        y: 0.99,
        outlineColor: '#000000',
        outlineWidth: 2,
        keepWithinCanvas: true,
      },
      1080,
      1920
    );
    expect(clamped.x).toBeLessThan(0.95);
    expect(clamped.y).toBeLessThan(0.96);

    // Hit-testing works for rotated and unrotated text clips
    const state = useEditorStore.getState();
    const textClip = state.clips.find((c) => c.trackType === 'text')!;
    const box = computeTextBoundingBox(textClip.textStyle!, 1920, 1080);
    expect(box.boxX).toBeGreaterThanOrEqual(0);
    expect(box.boxX + box.boxWidth).toBeLessThanOrEqual(1920);

    const hitCenter = hitTestTextClipAtPoint(
      textClip.textStyle!.x,
      textClip.textStyle!.y,
      textClip,
      1920,
      1080
    );
    expect(hitCenter).toBe(true);
    const missCorner = hitTestTextClipAtPoint(0.05, 0.05, textClip, 1920, 1080);
    expect(missCorner).toBe(false);
  });

  it('6. Evaluates text animation presets and grapheme-safe typewriter for Hindi Devanagari & Unicode', () => {
    const hindiWord = 'नमस्ते';
    const graphemes = splitUnicodeGraphemes(hindiWord);
    // In Devanagari, "न", "म", "स्ते" (or constituent aksharas) are preserved without breaking surrogate pairs
    expect(graphemes.join('')).toBe(hindiWord);

    const state = useEditorStore.getState();
    const textClip = state.clips.find((c) => c.trackType === 'text')!;
    state.updateClipTextStyle(textClip.id, {
      text: 'नमस्ते दुनिया',
      animation: 'typewriter',
      rotation: -15,
    });
    state.setClipTiming(textClip.id, 1.0, 5.0);

    const updated = useEditorStore
      .getState()
      .clips.find((c) => c.id === textClip.id)!;
    expect(updated.startTime).toBe(1.0);
    expect(updated.duration).toBe(4.0);
    expect(updated.textStyle?.rotation).toBe(-15);

    const earlyAnim = evaluateTextAnimationAtTime(updated, 1.2);
    const fullAnim = evaluateTextAnimationAtTime(updated, 4.8);
    expect(earlyAnim.visibleText.length).toBeLessThan(
      fullAnim.visibleText.length
    );
    expect(fullAnim.visibleText).toBe('नमस्ते दुनिया');

    const capabilities = getTextAndSubtitleCapabilities();
    expect(capabilities.length).toBeGreaterThanOrEqual(3);
  });
});
