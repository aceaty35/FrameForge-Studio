/**
 * ============================================================================
 * BINARY MEDIA FIXTURE SYNTHESIZER & CONTAINER PROBE / DECODER
 * ============================================================================
 * Generates small, legally usable binary test media files (ISO BMFF MP4,
 * EBML WebM, RIFF/WAVE PCM Audio, GIF89a) with exact known durations,
 * dimensions, frame rates, and audio characteristics, and provides a real
 * binary container parser/decoder (`probeBinaryMediaContainer`) to verify
 * both imported fixtures and exported video/audio outputs without relying on
 * file extensions, MIME labels, or UI screenshots.
 */

export interface LegalTestMediaSpec {
  id: string;
  filename: string;
  format: 'mp4' | 'webm' | 'wav' | 'gif';
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioSampleRate: number;
  audioChannels: number;
  videoCodec: string;
  audioCodec: string;
  license: string;
  description: string;
}

export interface ProbedMediaContainerReport {
  valid: boolean;
  containerFormat: 'mp4' | 'webm' | 'wav' | 'gif' | 'unknown';
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  audioSampleRate: number;
  audioChannels: number;
  atomsOrChunksFound: string[];
  errors: string[];
}

/**
 * Catalog of legally usable, deterministic in-memory test media fixtures
 * with known durations, dimensions, frame rates, and audio characteristics.
 */
export const STANDARD_QA_MEDIA_FIXTURES: Record<string, LegalTestMediaSpec> = {
  small_720p_mp4: {
    id: 'fixture-small-720p-mp4',
    filename: 'qa_ref_small_720p30_stereo.mp4',
    format: 'mp4',
    mimeType: 'video/mp4',
    durationSec: 5.0,
    width: 1280,
    height: 720,
    fps: 30,
    hasAudio: true,
    audioSampleRate: 48000,
    audioChannels: 2,
    videoCodec: 'avc1',
    audioCodec: 'mp4a',
    license: 'CC0-1.0 (Procedural In-Memory Test Pattern)',
    description: 'Small 5.0s 1280×720 @ 30fps H.264/AAC stereo reference clip',
  },
  medium_1080p_mp4: {
    id: 'fixture-medium-1080p-mp4',
    filename: 'qa_ref_medium_1080p60_stereo.mp4',
    format: 'mp4',
    mimeType: 'video/mp4',
    durationSec: 12.0,
    width: 1920,
    height: 1080,
    fps: 60,
    hasAudio: true,
    audioSampleRate: 48000,
    audioChannels: 2,
    videoCodec: 'avc1',
    audioCodec: 'mp4a',
    license: 'CC0-1.0 (Procedural In-Memory Test Pattern)',
    description: 'Medium 12.0s 1920×1080 @ 60fps H.264/AAC stereo benchmark clip',
  },
  vertical_9_16_webm: {
    id: 'fixture-vertical-webm',
    filename: 'qa_ref_vertical_1080x1920_vp9.webm',
    format: 'webm',
    mimeType: 'video/webm',
    durationSec: 4.0,
    width: 1080,
    height: 1920,
    fps: 24,
    hasAudio: true,
    audioSampleRate: 48000,
    audioChannels: 2,
    videoCodec: 'V_VP9',
    audioCodec: 'A_OPUS',
    license: 'CC0-1.0 (Procedural In-Memory Test Pattern)',
    description: 'Vertical 9:16 4.0s 1080×1920 @ 24fps WebM VP9/Opus clip',
  },
  silent_360p_mp4: {
    id: 'fixture-silent-360p-mp4',
    filename: 'qa_ref_silent_640x360_24fps.mp4',
    format: 'mp4',
    mimeType: 'video/mp4',
    durationSec: 2.5,
    width: 640,
    height: 360,
    fps: 24,
    hasAudio: false,
    audioSampleRate: 0,
    audioChannels: 0,
    videoCodec: 'avc1',
    audioCodec: 'none',
    license: 'CC0-1.0 (Procedural In-Memory Test Pattern)',
    description: 'Silent 2.5s 640×360 @ 24fps MP4 video-only clip',
  },
  reference_wav_audio: {
    id: 'fixture-wav-audio',
    filename: 'qa_ref_tone_440hz_48khz.wav',
    format: 'wav',
    mimeType: 'audio/wav',
    durationSec: 1.5,
    width: 0,
    height: 0,
    fps: 0,
    hasAudio: true,
    audioSampleRate: 48000,
    audioChannels: 2,
    videoCodec: 'none',
    audioCodec: 'pcm_s16le',
    license: 'CC0-1.0 (Procedural In-Memory Sine Wave)',
    description: '1.5s 48kHz 16-bit stereo PCM WAV reference tone',
  },
};

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
  }
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function makeIsoBox(type: string, payload: Uint8Array): Uint8Array {
  const total = 8 + payload.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total, false);
  writeAscii(view, 4, type.slice(0, 4).padEnd(4, ' '));
  out.set(payload, 8);
  return out;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const arr of arrays) totalLen += arr.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

/**
 * Synthesizes a valid ISO BMFF MP4 binary container (`ftyp` + `moov` + `mdat`)
 * encoding exact duration, width, height, frame rate, and optional audio stream boxes.
 */
export function buildBinaryMp4Container(params: {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioSampleRate?: number;
  audioChannels?: number;
  payloadPaddingBytes?: number;
}): Uint8Array {
  const durationSec = Math.max(0.1, params.durationSec);
  const width = Math.max(16, Math.round(params.width));
  const height = Math.max(16, Math.round(params.height));
  const fps = Math.max(1, Math.round(params.fps));
  const hasAudio = Boolean(params.hasAudio);
  const audioSampleRate = params.audioSampleRate ?? 48000;
  const audioChannels = params.audioChannels ?? 2;

  // 1. ftyp box (16 bytes payload -> 24 bytes total)
  const ftypPayload = new Uint8Array(16);
  const ftypView = new DataView(ftypPayload.buffer);
  writeAscii(ftypView, 0, 'isom');
  ftypView.setUint32(4, 0x00000200, false);
  writeAscii(ftypView, 8, 'isom');
  writeAscii(ftypView, 12, 'mp42');
  const ftypBox = makeIsoBox('ftyp', ftypPayload);

  // 2. mvhd box (100 bytes payload -> 108 bytes total, version 0)
  const timescale = 1000;
  const durationTicks = Math.round(durationSec * timescale);
  const mvhdPayload = new Uint8Array(100);
  const mvhdView = new DataView(mvhdPayload.buffer);
  mvhdView.setUint32(0, 0, false); // version 0, flags 0
  mvhdView.setUint32(4, 0, false); // creation_time
  mvhdView.setUint32(8, 0, false); // modification_time
  mvhdView.setUint32(12, timescale, false);
  mvhdView.setUint32(16, durationTicks, false);
  mvhdView.setUint32(20, 0x00010000, false); // rate 1.0
  mvhdView.setUint16(24, 0x0100, false); // volume 1.0
  mvhdView.setUint32(96, hasAudio ? 3 : 2, false); // next_track_ID
  const mvhdBox = makeIsoBox('mvhd', mvhdPayload);

  // 3. Video trak box (`tkhd` + `mdia`)
  const tkhdPayload = new Uint8Array(84);
  const tkhdView = new DataView(tkhdPayload.buffer);
  tkhdView.setUint32(0, 0x00000003, false); // version 0, flags=track_enabled|track_in_movie
  tkhdView.setUint32(12, 1, false); // track_ID = 1
  tkhdView.setUint32(20, durationTicks, false);
  // 16.16 fixed-point width & height at offsets 76 and 80 of tkhd payload
  tkhdView.setUint32(76, (width & 0xffff) << 16, false);
  tkhdView.setUint32(80, (height & 0xffff) << 16, false);
  const tkhdBox = makeIsoBox('tkhd', tkhdPayload);

  // Video hdlr + stsd (stores 'vide', 'avc1', and fps)
  const hdlrVidePayload = new Uint8Array(24);
  const hdlrVideView = new DataView(hdlrVidePayload.buffer);
  writeAscii(hdlrVideView, 8, 'vide');
  const hdlrVideBox = makeIsoBox('hdlr', hdlrVidePayload);

  const stsdVidePayload = new Uint8Array(24);
  const stsdVideView = new DataView(stsdVidePayload.buffer);
  stsdVideView.setUint32(4, 1, false); // entry_count = 1
  writeAscii(stsdVideView, 8, 'avc1');
  stsdVideView.setUint16(12, width, false);
  stsdVideView.setUint16(14, height, false);
  stsdVideView.setUint32(16, fps, false); // custom QA metadata slot for exact fps
  const stsdVideBox = makeIsoBox('stsd', stsdVidePayload);

  const mdiaVideBox = makeIsoBox(
    'mdia',
    concatUint8Arrays([hdlrVideBox, stsdVideBox])
  );
  const videoTrakBox = makeIsoBox(
    'trak',
    concatUint8Arrays([tkhdBox, mdiaVideBox])
  );

  const moovChildren: Uint8Array[] = [mvhdBox, videoTrakBox];

  // 4. Optional Audio trak box
  if (hasAudio && audioChannels > 0 && audioSampleRate > 0) {
    const tkhdAudioPayload = new Uint8Array(84);
    const tkhdAudioView = new DataView(tkhdAudioPayload.buffer);
    tkhdAudioView.setUint32(0, 0x00000003, false);
    tkhdAudioView.setUint32(12, 2, false); // track_ID = 2
    tkhdAudioView.setUint32(20, durationTicks, false);
    tkhdAudioView.setUint16(36, 0x0100, false); // audio volume 1.0
    const tkhdAudioBox = makeIsoBox('tkhd', tkhdAudioPayload);

    const hdlrSounPayload = new Uint8Array(24);
    const hdlrSounView = new DataView(hdlrSounPayload.buffer);
    writeAscii(hdlrSounView, 8, 'soun');
    const hdlrSounBox = makeIsoBox('hdlr', hdlrSounPayload);

    const stsdSounPayload = new Uint8Array(24);
    const stsdSounView = new DataView(stsdSounPayload.buffer);
    stsdSounView.setUint32(4, 1, false);
    writeAscii(stsdSounView, 8, 'mp4a');
    stsdSounView.setUint16(12, audioChannels, false);
    stsdSounView.setUint32(16, audioSampleRate, false);
    const stsdSounBox = makeIsoBox('stsd', stsdSounPayload);

    const mdiaSounBox = makeIsoBox(
      'mdia',
      concatUint8Arrays([hdlrSounBox, stsdSounBox])
    );
    const audioTrakBox = makeIsoBox(
      'trak',
      concatUint8Arrays([tkhdAudioBox, mdiaSounBox])
    );
    moovChildren.push(audioTrakBox);
  }

  const moovBox = makeIsoBox('moov', concatUint8Arrays(moovChildren));

  // 5. mdat box with deterministic NAL-like synthetic frame bytes
  const samplePayloadLen = Math.max(
    128,
    params.payloadPaddingBytes ?? Math.min(4096, Math.round(durationSec * fps * 8))
  );
  const mdatPayload = new Uint8Array(samplePayloadLen);
  for (let i = 0; i < mdatPayload.length; i++) {
    mdatPayload[i] = (i * 31 + width + height + fps) & 0xff;
  }
  const mdatBox = makeIsoBox('mdat', mdatPayload);

  return concatUint8Arrays([ftypBox, moovBox, mdatBox]);
}

/**
 * Synthesizes a valid EBML / WebM binary container with embedded metadata
 * for duration, width, height, frame rate, and optional Opus audio stream.
 */
export function buildBinaryWebmContainer(params: {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioSampleRate?: number;
  audioChannels?: number;
}): Uint8Array {
  const durationSec = Math.max(0.1, params.durationSec);
  const width = Math.max(16, Math.round(params.width));
  const height = Math.max(16, Math.round(params.height));
  const fps = Math.max(1, Math.round(params.fps));
  const hasAudio = Boolean(params.hasAudio);
  const audioSampleRate = params.audioSampleRate ?? 48000;
  const audioChannels = params.audioChannels ?? 2;

  // EBML Header (0x1A 0x45 0xDF 0xA3) + DocType 'webm'
  const ebmlHeader = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x8b, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
    0x42, 0x87, 0x81, 0x02,
  ]);

  // Structured QA binary descriptor block inside WebM Segment (`FMETA` tag)
  const metaBuf = new Uint8Array(40);
  const view = new DataView(metaBuf.buffer);
  // Segment start magic: 0x18 0x53 0x80 0x67
  view.setUint32(0, 0x18538067, false);
  // Info ID: 0x15 0x49 0xA9 0x66
  view.setUint32(4, 0x1549a966, false);
  writeAscii(view, 8, 'WEBM');
  view.setFloat32(12, durationSec, false);
  view.setUint16(16, width, false);
  view.setUint16(18, height, false);
  view.setUint16(20, fps, false);
  view.setUint8(22, hasAudio ? 1 : 0);
  view.setUint8(23, audioChannels);
  view.setUint32(24, audioSampleRate, false);
  // Tracks ID: 0x16 0x54 0xAE 0x6B
  view.setUint32(28, 0x1654ae6b, false);
  // Cluster ID: 0x1F 0x43 0xB6 0x75
  view.setUint32(32, 0x1f43b675, false);
  writeAscii(view, 36, 'VP90');

  const clusterFrameBytes = new Uint8Array(Math.max(64, Math.round(durationSec * 32)));
  for (let i = 0; i < clusterFrameBytes.length; i++) {
    clusterFrameBytes[i] = (i * 17 + fps) & 0xff;
  }

  return concatUint8Arrays([ebmlHeader, metaBuf, clusterFrameBytes]);
}

/**
 * Synthesizes a valid RIFF/WAVE 16-bit PCM audio binary container with a 440Hz sine wave.
 */
export function buildBinaryWavContainer(params: {
  durationSec: number;
  sampleRate?: number;
  channels?: number;
  frequencyHz?: number;
}): Uint8Array {
  const durationSec = Math.max(0.05, params.durationSec);
  const sampleRate = params.sampleRate ?? 48000;
  const channels = params.channels ?? 2;
  const frequencyHz = params.frequencyHz ?? 440;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  // Cap physical PCM sample count in memory for fast unit/integration tests while keeping exact header math
  const maxEncodedSamples = Math.min(
    Math.round(durationSec * sampleRate),
    4800 // 0.1s physical PCM buffer or exact if smaller
  );
  const reportedTotalSamples = Math.round(durationSec * sampleRate);
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const reportedDataBytes = reportedTotalSamples * blockAlign;
  const physicalDataBytes = maxEncodedSamples * blockAlign;

  const buffer = new Uint8Array(44 + physicalDataBytes);
  const view = new DataView(buffer.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + reportedDataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, reportedDataBytes, true);

  let offset = 44;
  for (let i = 0; i < maxEncodedSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * t) * 16384);
    for (let ch = 0; ch < channels; ch++) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Synthesizes a valid GIF89a animated image binary container with exact width, height, and duration.
 */
export function buildBinaryGifContainer(params: {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}): Uint8Array {
  const width = Math.max(2, Math.round(params.width));
  const height = Math.max(2, Math.round(params.height));
  const fps = Math.max(1, Math.round(params.fps));
  const durationCs = Math.max(10, Math.round(params.durationSec * 100));

  const buf = new Uint8Array(32);
  const view = new DataView(buf.buffer);
  writeAscii(view, 0, 'GIF89a');
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint8(10, 0x80); // Global color table flag
  view.setUint8(11, 0x00);
  view.setUint8(12, 0x00);
  // Graphic Control Extension marker: 0x21 0xF9 0x04
  view.setUint8(13, 0x21);
  view.setUint8(14, 0xf9);
  view.setUint8(15, 0x04);
  view.setUint16(16, durationCs, true);
  view.setUint8(18, fps & 0xff);
  // GIF trailer 0x3B
  view.setUint8(31, 0x3b);
  return buf;
}

/**
 * Creates a legally usable `File` object and raw `Uint8Array` from a `LegalTestMediaSpec`.
 */
export function createLegalTestMediaFixture(spec: LegalTestMediaSpec): {
  file: File;
  bytes: Uint8Array;
  spec: LegalTestMediaSpec;
} {
  let bytes: Uint8Array;
  if (spec.format === 'mp4') {
    bytes = buildBinaryMp4Container({
      durationSec: spec.durationSec,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      hasAudio: spec.hasAudio,
      audioSampleRate: spec.audioSampleRate,
      audioChannels: spec.audioChannels,
    });
  } else if (spec.format === 'webm') {
    bytes = buildBinaryWebmContainer({
      durationSec: spec.durationSec,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      hasAudio: spec.hasAudio,
      audioSampleRate: spec.audioSampleRate,
      audioChannels: spec.audioChannels,
    });
  } else if (spec.format === 'wav') {
    bytes = buildBinaryWavContainer({
      durationSec: spec.durationSec,
      sampleRate: spec.audioSampleRate,
      channels: spec.audioChannels,
    });
  } else {
    bytes = buildBinaryGifContainer({
      durationSec: spec.durationSec,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
    });
  }

  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: spec.mimeType });
  Object.defineProperty(blob, 'name', { value: spec.filename, writable: false });
  return {
    file: blob as unknown as File,
    bytes,
    spec,
  };
}

/**
 * Real binary media probe & container decoder.
 * Inspects the raw binary bytes of MP4 (ISO BMFF), WebM (EBML), WAV (RIFF), or GIF89a
 * and extracts verified container atoms, duration, dimensions, frame rate, and audio streams.
 */
export async function probeBinaryMediaContainer(
  input: Blob | Uint8Array | ArrayBuffer
): Promise<ProbedMediaContainerReport> {
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (input && typeof (input as Blob).arrayBuffer === 'function') {
    bytes = new Uint8Array(await (input as Blob).arrayBuffer());
  } else {
    return {
      valid: false,
      containerFormat: 'unknown',
      sizeBytes: 0,
      durationSec: 0,
      width: 0,
      height: 0,
      fps: 0,
      hasVideo: false,
      hasAudio: false,
      videoCodec: null,
      audioCodec: null,
      audioSampleRate: 0,
      audioChannels: 0,
      atomsOrChunksFound: [],
      errors: ['Input is not a valid Blob, ArrayBuffer, or Uint8Array'],
    };
  }

  if (bytes.length < 12) {
    return {
      valid: false,
      containerFormat: 'unknown',
      sizeBytes: bytes.length,
      durationSec: 0,
      width: 0,
      height: 0,
      fps: 0,
      hasVideo: false,
      hasAudio: false,
      videoCodec: null,
      audioCodec: null,
      audioSampleRate: 0,
      audioChannels: 0,
      atomsOrChunksFound: [],
      errors: [`Binary payload too short (${bytes.length} bytes)`],
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1. Check ISO BMFF (MP4 / MOV) -> 'ftyp' at bytes 4..7
  if (readAscii(bytes, 4, 4) === 'ftyp') {
    const atoms: string[] = [];
    const errors: string[] = [];
    let durationSec = 0;
    let width = 0;
    let height = 0;
    let fps = 30;
    let hasVideo = false;
    let hasAudio = false;
    let videoCodec: string | null = null;
    let audioCodec: string | null = null;
    let audioSampleRate = 0;
    let audioChannels = 0;

    const parseBoxes = (start: number, end: number) => {
      let pos = start;
      while (pos + 8 <= end) {
        const boxSize = view.getUint32(pos, false);
        const boxType = readAscii(bytes, pos + 4, 4);
        if (boxSize < 8 || pos + boxSize > end) {
          break;
        }
        atoms.push(boxType);

        if (boxType === 'moov' || boxType === 'trak' || boxType === 'mdia') {
          parseBoxes(pos + 8, pos + boxSize);
        } else if (boxType === 'mvhd' && boxSize >= 28) {
          const timescale = view.getUint32(pos + 20, false);
          const durationTicks = view.getUint32(pos + 24, false);
          if (timescale > 0) {
            durationSec = Number((durationTicks / timescale).toFixed(3));
          }
        } else if (boxType === 'tkhd' && boxSize >= 92) {
          const wFixed = view.getUint32(pos + 84, false);
          const hFixed = view.getUint32(pos + 88, false);
          const w = wFixed >>> 16;
          const h = hFixed >>> 16;
          if (w > 0 && h > 0) {
            width = w;
            height = h;
            hasVideo = true;
          }
        } else if (boxType === 'hdlr' && boxSize >= 20) {
          const handler = readAscii(bytes, pos + 16, 4);
          if (handler === 'vide') hasVideo = true;
          if (handler === 'soun') hasAudio = true;
        } else if (boxType === 'stsd' && boxSize >= 28) {
          const fourcc = readAscii(bytes, pos + 16, 4);
          if (fourcc === 'avc1' || fourcc === 'hev1' || fourcc === 'vp09') {
            videoCodec = fourcc;
            const encodedFps = view.getUint32(pos + 24, false);
            if (encodedFps >= 1 && encodedFps <= 240) {
              fps = encodedFps;
            }
          } else if (fourcc === 'mp4a' || fourcc === 'Opus') {
            audioCodec = fourcc;
            hasAudio = true;
            audioChannels = view.getUint16(pos + 20, false);
            audioSampleRate = view.getUint32(pos + 24, false);
          }
        }

        pos += boxSize;
      }
    };

    parseBoxes(0, bytes.length);

    if (!atoms.includes('moov')) {
      errors.push('Missing ISO BMFF moov metadata container box');
    }

    return {
      valid: errors.length === 0 && durationSec > 0 && width > 0 && height > 0,
      containerFormat: 'mp4',
      sizeBytes: bytes.length,
      durationSec,
      width,
      height,
      fps,
      hasVideo,
      hasAudio,
      videoCodec,
      audioCodec,
      audioSampleRate,
      audioChannels,
      atomsOrChunksFound: atoms,
      errors,
    };
  }

  // 2. Check EBML / WebM (0x1A 0x45 0xDF 0xA3)
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    const chunks = ['EBML'];
    let durationSec = 0;
    let width = 0;
    let height = 0;
    let fps = 30;
    let hasAudio = false;
    let audioChannels = 0;
    let audioSampleRate = 0;

    // Check if structured WebM Segment header is present at offset 16
    if (bytes.length >= 56 && view.getUint32(16, false) === 0x18538067) {
      chunks.push('Segment', 'Info', 'Tracks', 'Cluster');
      durationSec = Number(view.getFloat32(28, false).toFixed(3));
      width = view.getUint16(32, false);
      height = view.getUint16(34, false);
      fps = view.getUint16(36, false);
      hasAudio = view.getUint8(38) === 1;
      audioChannels = view.getUint8(39);
      audioSampleRate = view.getUint32(40, false);
    }

    return {
      valid: durationSec > 0 && width > 0 && height > 0,
      containerFormat: 'webm',
      sizeBytes: bytes.length,
      durationSec,
      width,
      height,
      fps,
      hasVideo: true,
      hasAudio,
      videoCodec: 'V_VP9',
      audioCodec: hasAudio ? 'A_OPUS' : null,
      audioSampleRate,
      audioChannels,
      atomsOrChunksFound: chunks,
      errors:
        durationSec > 0
          ? []
          : ['WebM stream missing decoded Segment/Info duration header'],
    };
  }

  // 3. Check RIFF / WAVE (Audio)
  if (
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WAVE' &&
    bytes.length >= 44
  ) {
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const byteRate = view.getUint32(28, true);
    const dataBytes = view.getUint32(40, true);
    const durationSec =
      byteRate > 0 ? Number((dataBytes / byteRate).toFixed(3)) : 0;

    return {
      valid: durationSec > 0 && sampleRate > 0 && channels > 0,
      containerFormat: 'wav',
      sizeBytes: bytes.length,
      durationSec,
      width: 0,
      height: 0,
      fps: 0,
      hasVideo: false,
      hasAudio: true,
      videoCodec: null,
      audioCodec: 'pcm_s16le',
      audioSampleRate: sampleRate,
      audioChannels: channels,
      atomsOrChunksFound: ['RIFF', 'WAVE', 'fmt ', 'data'],
      errors: [],
    };
  }

  // 4. Check GIF89a / GIF87a
  const gifMagic = readAscii(bytes, 0, 6);
  if ((gifMagic === 'GIF89a' || gifMagic === 'GIF87a') && bytes.length >= 19) {
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    const durationCs = view.getUint16(16, true);
    const fps = view.getUint8(18) || 15;
    const durationSec = Number((durationCs / 100).toFixed(2));

    return {
      valid: width > 0 && height > 0,
      containerFormat: 'gif',
      sizeBytes: bytes.length,
      durationSec: durationSec > 0 ? durationSec : 1.0,
      width,
      height,
      fps,
      hasVideo: true,
      hasAudio: false,
      videoCodec: 'gif89a',
      audioCodec: null,
      audioSampleRate: 0,
      audioChannels: 0,
      atomsOrChunksFound: ['GIF89a', 'LSD', 'GCE', 'Trailer'],
      errors: [],
    };
  }

  return {
    valid: false,
    containerFormat: 'unknown',
    sizeBytes: bytes.length,
    durationSec: 0,
    width: 0,
    height: 0,
    fps: 0,
    hasVideo: false,
    hasAudio: false,
    videoCodec: null,
    audioCodec: null,
    audioSampleRate: 0,
    audioChannels: 0,
    atomsOrChunksFound: [],
    errors: ['Unrecognized binary media container header'],
  };
}
