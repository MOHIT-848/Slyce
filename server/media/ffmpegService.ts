import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  DEFAULT_CLIP_ADJUSTMENTS,
  DEFAULT_CLIP_AUDIO,
  DEFAULT_CLIP_EFFECTS,
  DEFAULT_CLIP_TRANSFORM,
  getDimensionsForResolution,
  type ClipEffects,
  type ExportResolution,
  type FramingMode,
  type SubtitleCue,
  type SubtitleSettings,
  type VideoMetadata,
} from '../../src/types/clipforge.ts';
import { generateAssContent, generateSrtContent } from '../utils/subtitles.ts';

const execFileAsync = promisify(execFile);

export interface FfmpegCapabilities {
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  libx264Available: boolean;
  subtitlesFilterAvailable: boolean;
}

let cachedCaps: FfmpegCapabilities | null = null;

export async function checkFfmpegCapabilities(): Promise<FfmpegCapabilities> {
  if (cachedCaps) return cachedCaps;

  const caps: FfmpegCapabilities = {
    ffmpegAvailable: false,
    ffprobeAvailable: false,
    libx264Available: false,
    subtitlesFilterAvailable: false,
  };

  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    caps.ffmpegAvailable = true;
  } catch {
    return caps;
  }

  try {
    await execFileAsync('ffprobe', ['-version'], { timeout: 5000 });
    caps.ffprobeAvailable = true;
  } catch {
    caps.ffprobeAvailable = false;
  }

  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-encoders'], { timeout: 5000 });
    caps.libx264Available = stdout.includes('libx264');
  } catch {
    caps.libx264Available = false;
  }

  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-filters'], { timeout: 5000 });
    caps.subtitlesFilterAvailable = stdout.includes('ass') || stdout.includes('subtitles');
  } catch {
    caps.subtitlesFilterAvailable = false;
  }

  cachedCaps = caps;
  return caps;
}

function parseFrameRate(raw?: string): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num)) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function inspectVideo(videoPath: string): Promise<VideoMetadata> {
  if (!fs.existsSync(videoPath)) {
    throw new Error('Uploaded video file not found on disk.');
  }
  const stat = fs.statSync(videoPath);

  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath],
    { timeout: 30000 }
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('No readable video stream found. Ensure the file is a valid MP4 or MOV video.');
  }

  let rawDuration =
    Number(parsed.format?.duration) ||
    Number(videoStream.duration) ||
    0;

  // Some streaming MKV/WebM files omit container duration headers; scan quickly via ffmpeg null muxer
  if (!Number.isFinite(rawDuration) || rawDuration <= 0.5) {
    try {
      const scan = await execFileAsync(
        'ffmpeg',
        ['-v', 'error', '-stats', '-i', videoPath, '-f', 'null', '-'],
        { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }
      );
      const text = `${scan.stdout ?? ''}\n${scan.stderr ?? ''}`;
      const timeMatches = [...text.matchAll(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
      const last = timeMatches[timeMatches.length - 1];
      if (last) {
        rawDuration = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
      }
    } catch {
      // fall through to validation check
    }
  }

  if (!Number.isFinite(rawDuration) || rawDuration <= 0.5) {
    throw new Error('Video duration is invalid or too short (< 0.5 seconds).');
  }

  return {
    duration: Number(rawDuration.toFixed(2)),
    width: videoStream.width,
    height: videoStream.height,
    fps: parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate),
    hasAudio: Boolean(audioStream),
    format: parsed.format?.format_name ?? 'mp4',
    codec: videoStream.codec_name ?? 'h264',
    fileSizeBytes: stat.size,
  };
}

export async function generateThumbnail(
  videoPath: string,
  outJpgPath: string,
  seekSeconds: number
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      Math.max(0, seekSeconds).toFixed(2),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '3',
      outJpgPath,
    ],
    { timeout: 30000 }
  );
}

export async function extractAudioForTranscription(
  videoPath: string,
  outWavPath: string
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      outWavPath,
    ],
    { timeout: 0 }
  );
}

export async function extractAudioChunkMp3(
  sourceAudioPath: string,
  startSeconds: number,
  durationSeconds: number,
  outMp3Path: string
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      startSeconds.toFixed(2),
      '-t',
      durationSeconds.toFixed(2),
      '-i',
      sourceAudioPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '24k',
      outMp3Path,
    ],
    { timeout: 0 }
  );
}

/**
 * Extracts a compressed 24 kbps 16kHz mono MP3 audio chunk directly from a source
 * video using fast keyframe input seeking—avoiding slow full-file PCM WAV dumps.
 */
export async function extractAudioChunkDirectMp3(
  sourceVideoPath: string,
  startSeconds: number,
  durationSeconds: number,
  outMp3Path: string
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-err_detect',
      'ignore_err',
      '-ss',
      Math.max(0, startSeconds).toFixed(2),
      '-t',
      Math.max(0.5, durationSeconds).toFixed(2),
      '-i',
      sourceVideoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '24k',
      '-threads',
      '0',
      outMp3Path,
    ],
    { timeout: 0 }
  );
}

/**
 * Fast FFmpeg visual scene-cut detector (used cleanly for AMVs, music edits, gaming,
 * muted B-roll, or whenever AI transcription returns zero speech).
 */
export async function detectSceneChanges(
  videoPath: string,
  durationSeconds: number,
  threshold = 0.3
): Promise<number[]> {
  if (!fs.existsSync(videoPath) || durationSeconds < 4) return [];
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-v',
        'info',
        '-i',
        videoPath,
        '-vf',
        `fps=4,scale=320:-2,select='gt(scene,${threshold})',showinfo`,
        '-an',
        '-f',
        'null',
        '-',
      ],
      { timeout: 30000, maxBuffer: 12 * 1024 * 1024 }
    );
    const times: number[] = [];
    for (const m of (stderr ?? '').matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
      const t = Number(m[1]);
      if (Number.isFinite(t) && t > 1 && t < durationSeconds - 1) {
        times.push(Number(t.toFixed(2)));
      }
    }
    // Deduplicate scene cuts closer than 3 seconds
    const unique: number[] = [];
    for (const t of times.sort((a, b) => a - b)) {
      if (unique.length === 0 || t - unique[unique.length - 1] >= 3) {
        unique.push(t);
      }
    }
    return unique;
  } catch {
    return [];
  }
}

function escapeAssFilterPath(filePath: string): string {
  // Escape characters special to FFmpeg filtergraph arguments
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export interface RenderClipOptions {
  sourceVideoPath: string;
  hasAudio: boolean;
  startSeconds: number;
  endSeconds: number;
  framingMode: FramingMode;
  resolution: ExportResolution;
  subtitleCues: SubtitleCue[];
  subtitleSettings: SubtitleSettings;
  effects?: ClipEffects;
  outMp4Path: string;
  outSrtPath: string;
  tempAssPath: string;
}

function buildVisualEffectsChain(
  effects: ClipEffects,
  targetW: number,
  targetH: number,
  outputDuration: number,
  speed: number
): { preFilters: string; postFilters: string; audioFilters: string } {
  const preFilters: string[] = [];
  const filters: string[] = [];
  const audioFilters: string[] = [];

  const tr = { ...DEFAULT_CLIP_TRANSFORM, ...(effects.transform ?? {}) };
  const adj = { ...DEFAULT_CLIP_ADJUSTMENTS, ...(effects.adjustments ?? {}) };
  const aud = { ...DEFAULT_CLIP_AUDIO, ...(effects.audio ?? {}) };

  // Pre-framing orientation transforms (Flip H + Rotate 90/180/270)
  if (tr.rotateDeg === 90) {
    preFilters.push('transpose=1');
  } else if (tr.rotateDeg === 180) {
    preFilters.push('hflip,vflip');
  } else if (tr.rotateDeg === 270) {
    preFilters.push('transpose=2');
  }
  if (tr.flipH) {
    preFilters.push('hflip');
  }

  if (Math.abs(speed - 1) > 0.01) {
    filters.push(`setpts=PTS/${speed.toFixed(4)}`);
    audioFilters.push(`atempo=${speed.toFixed(3)}`);
  }

  // Audio volume mixer
  if (!aud.muted && Math.abs(aud.volume - 1) > 0.02) {
    const safeVol = Math.max(0, Math.min(2, Number(aud.volume) || 1));
    audioFilters.push(`volume=${safeVol.toFixed(2)}`);
  }

  // Manual Zoom + Pan offset on framed output
  const z = Math.max(0.85, Math.min(1.8, Number(tr.zoom) || 1));
  const panX = Math.max(-50, Math.min(50, Number(tr.panX) || 0));
  const panY = Math.max(-50, Math.min(50, Number(tr.panY) || 0));
  if (z >= 1.01) {
    const zw = Math.round((targetW * z) / 2) * 2;
    const zh = Math.round((targetH * z) / 2) * 2;
    const fx = Math.max(0, Math.min(1, 0.5 + panX / 100)).toFixed(3);
    const fy = Math.max(0, Math.min(1, 0.5 + panY / 100)).toFixed(3);
    filters.push(`scale=${zw}:${zh},crop=w=${targetW}:h=${targetH}:x='(iw-ow)*${fx}':y='(ih-oh)*${fy}'`);
  } else if (z <= 0.99) {
    const zw = Math.round((targetW * z) / 2) * 2;
    const zh = Math.round((targetH * z) / 2) * 2;
    const bgHex = tr.canvasBg === 'slate' ? '#1E293B' : tr.canvasBg === 'gradient' ? '#1B1538' : '#080B14';
    filters.push(`scale=${zw}:${zh},pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:${bgHex}`);
  }

  // 1. Color / Visual Look + Manual Color Grading Adjustments
  let presetContrast = 1;
  let presetSaturation = 1;
  let presetBrightness = 0;
  let presetGammaR = 1;
  let presetGammaB = 1;
  let forceMonochrome = false;

  if (effects.visualPreset === 'cinematic_contrast') {
    presetContrast = 1.12;
    presetSaturation = 0.90;
    presetBrightness = -0.02;
  } else if (effects.visualPreset === 'vivid_social') {
    presetContrast = 1.08;
    presetSaturation = 1.28;
    presetBrightness = 0.02;
  } else if (effects.visualPreset === 'warm_film') {
    presetContrast = 1.05;
    presetSaturation = 1.10;
    presetGammaR = 1.08;
    presetGammaB = 0.92;
  } else if (effects.visualPreset === 'monochrome') {
    forceMonochrome = true;
    presetContrast = 1.12;
  }

  if (forceMonochrome) {
    filters.push('hue=s=0');
  }

  const finalContrast = Math.max(0.5, Math.min(1.8, presetContrast * (Number(adj.contrast) || 1)));
  const finalSaturation = forceMonochrome
    ? 0
    : Math.max(0, Math.min(2.5, presetSaturation * (Number(adj.saturation) || 1)));
  const finalBrightness = Math.max(-0.4, Math.min(0.4, presetBrightness + (Number(adj.brightness) || 0)));

  if (
    Math.abs(finalContrast - 1) > 0.01 ||
    (!forceMonochrome && Math.abs(finalSaturation - 1) > 0.01) ||
    Math.abs(finalBrightness) > 0.005 ||
    Math.abs(presetGammaR - 1) > 0.01
  ) {
    const eqParts = [
      `contrast=${finalContrast.toFixed(2)}`,
      `brightness=${finalBrightness.toFixed(3)}`,
    ];
    if (!forceMonochrome) eqParts.push(`saturation=${finalSaturation.toFixed(2)}`);
    if (Math.abs(presetGammaR - 1) > 0.01) {
      eqParts.push(`gamma_r=${presetGammaR.toFixed(2)}`, `gamma_b=${presetGammaB.toFixed(2)}`);
    }
    filters.push(`eq=${eqParts.join(':')}`);
  }

  const warmth = Math.max(-1, Math.min(1, Number(adj.warmth) || 0));
  if (Math.abs(warmth) > 0.03) {
    filters.push(
      `colorbalance=rs=${(warmth * 0.22).toFixed(2)}:bs=${(-warmth * 0.22).toFixed(2)}`
    );
  }

  const sharpness = Math.max(0, Math.min(1.5, Number(adj.sharpness) || 0));
  if (sharpness > 0.05) {
    filters.push(`unsharp=5:5:${sharpness.toFixed(2)}:5:5:0.0`);
  }

  const vignette = Math.max(0, Math.min(1, Number(adj.vignette) || 0));
  if (vignette > 0.05) {
    filters.push(`vignette=angle=${(0.42 + vignette * 0.68).toFixed(2)}`);
  }

  // 2. Motion Animation across the clip (normalize to 24fps first so 60fps videos don't 2.5x zoompan cost)
  const estFrames = Math.max(24, Math.round(outputDuration * 24));
  if (effects.motionAnimation === 'subtle_zoom') {
    filters.push(
      `fps=24,zoompan=z='1.0+0.05*in/${estFrames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
    );
  } else if (effects.motionAnimation === 'viral_dynamic') {
    filters.push(
      `fps=24,zoompan=z='1.0+0.08*in/${estFrames}':x='iw/2-(iw/zoom/2)+sin(in*0.04)*6':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
    );
  } else if (effects.motionAnimation === 'ken_burns_zoom_in') {
    filters.push(
      `fps=24,zoompan=z='1.0+0.12*in/${estFrames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
    );
  } else if (effects.motionAnimation === 'ken_burns_zoom_out') {
    filters.push(
      `fps=24,zoompan=z='1.12-0.12*in/${estFrames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
    );
  } else if (effects.motionAnimation === 'subtle_pan') {
    const padW = Math.round((targetW * 1.12) / 2) * 2;
    const padH = Math.round((targetH * 1.12) / 2) * 2;
    filters.push(
      `fps=24,scale=${padW}:${padH},crop=w=${targetW}:h=${targetH}:x='(iw-ow)*0.5+(iw-ow)*0.42*sin(t*0.75)':y='(ih-oh)*0.5'`
    );
  } else if (effects.motionAnimation === 'pulse_zoom') {
    filters.push(
      `fps=24,zoompan=z='1.04+0.04*sin(in*0.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
    );
  }

  // 3. Intro Transition
  const introDur = Math.max(0.2, Math.min(outputDuration * 0.4, Number(effects.introDuration) || 0.5));
  const introFrames = Math.max(5, Math.round(introDur * 24));
  let hasAudioFadeIn = false;
  if (effects.introTransition === 'flash_cut') {
    filters.push(`eq=brightness='if(lt(t,0.24),0.28*(1-t/0.24),0)'`);
    audioFilters.push(`afade=t=in:st=0:d=0.12`);
    hasAudioFadeIn = true;
  } else if (effects.introTransition === 'fade_in') {
    filters.push(`fade=t=in:st=0:d=${introDur.toFixed(2)}`);
    audioFilters.push(`afade=t=in:st=0:d=${introDur.toFixed(2)}`);
    hasAudioFadeIn = true;
  } else if (effects.introTransition === 'blur_reveal') {
    const half = (introDur * 0.5).toFixed(2);
    filters.push(
      `boxblur=10:2:enable='lt(t,${half})',boxblur=4:2:enable='between(t,${half},${introDur.toFixed(2)})',fade=t=in:st=0:d=${(introDur * 0.7).toFixed(2)}`
    );
    audioFilters.push(`afade=t=in:st=0:d=${(introDur * 0.7).toFixed(2)}`);
    hasAudioFadeIn = true;
  } else if (effects.introTransition === 'zoom_in') {
    if (effects.motionAnimation === 'none') {
      filters.push(
        `fps=24,zoompan=z='if(lt(in,${introFrames}),1.16-0.16*in/${introFrames},1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
      );
    }
    filters.push(`fade=t=in:st=0:d=${Math.min(0.35, introDur).toFixed(2)}`);
    audioFilters.push(`afade=t=in:st=0:d=${Math.min(0.35, introDur).toFixed(2)}`);
    hasAudioFadeIn = true;
  } else if (effects.introTransition === 'slide_up') {
    const slideH = Math.round((targetH * 0.14) / 2) * 2;
    filters.push(
      `scale=${targetW}:${targetH + slideH},crop=w=${targetW}:h=${targetH}:x=0:y='if(lt(t,${introDur.toFixed(2)}),${slideH}*(1-t/${introDur.toFixed(2)}),0)',fade=t=in:st=0:d=${Math.min(0.25, introDur).toFixed(2)}`
    );
  }

  if (aud.fadeIn && !hasAudioFadeIn) {
    audioFilters.push(`afade=t=in:st=0:d=0.45`);
  }

  // 4. Outro Transition
  const outroDur = Math.max(0.2, Math.min(outputDuration * 0.4, Number(effects.outroDuration) || 0.5));
  const outStart = Math.max(0.1, outputDuration - outroDur);
  const outStartFrame = Math.max(0, Math.round(outStart * 24));
  const outFrames = Math.max(5, Math.round(outroDur * 24));
  let hasAudioFadeOut = false;
  if (effects.outroTransition === 'fade_out') {
    filters.push(`fade=t=out:st=${outStart.toFixed(2)}:d=${outroDur.toFixed(2)}`);
    audioFilters.push(`afade=t=out:st=${outStart.toFixed(2)}:d=${outroDur.toFixed(2)}`);
    hasAudioFadeOut = true;
  } else if (effects.outroTransition === 'blur_out') {
    const mid = (outStart + outroDur * 0.45).toFixed(2);
    filters.push(
      `boxblur=5:2:enable='between(t,${outStart.toFixed(2)},${mid})',boxblur=11:2:enable='gte(t,${mid})',fade=t=out:st=${(outStart + outroDur * 0.25).toFixed(2)}:d=${(outroDur * 0.75).toFixed(2)}`
    );
    audioFilters.push(`afade=t=out:st=${outStart.toFixed(2)}:d=${outroDur.toFixed(2)}`);
    hasAudioFadeOut = true;
  } else if (effects.outroTransition === 'zoom_out') {
    if (effects.motionAnimation === 'none' && effects.introTransition !== 'zoom_in') {
      filters.push(
        `zoompan=z='if(gte(in,${outStartFrame}),1.0+0.12*min(1,(in-${outStartFrame})/${outFrames}),1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetW}x${targetH}:fps=24`
      );
    }
    filters.push(`fade=t=out:st=${outStart.toFixed(2)}:d=${outroDur.toFixed(2)}`);
    audioFilters.push(`afade=t=out:st=${outStart.toFixed(2)}:d=${outroDur.toFixed(2)}`);
    hasAudioFadeOut = true;
  }

  if (aud.fadeOut && !hasAudioFadeOut) {
    audioFilters.push(`afade=t=out:st=${Math.max(0.1, outputDuration - 0.45).toFixed(2)}:d=0.45`);
  }

  return {
    preFilters: preFilters.length > 0 ? `${preFilters.join(',')},` : '',
    postFilters: filters.length > 0 ? `,${filters.join(',')}` : '',
    audioFilters: aud.muted ? '' : audioFilters.join(','),
  };
}

export async function renderVerticalClip(options: RenderClipOptions): Promise<{
  mp4SizeBytes: number;
  srtSizeBytes: number;
  duration: number;
}> {
  const {
    sourceVideoPath,
    hasAudio,
    startSeconds,
    endSeconds,
    framingMode,
    resolution,
    subtitleCues,
    subtitleSettings,
    effects = DEFAULT_CLIP_EFFECTS,
    outMp4Path,
    outSrtPath,
    tempAssPath,
  } = options;

  const clipDuration = Math.max(1, Number((endSeconds - startSeconds).toFixed(2)));
  const speed = Math.max(0.5, Math.min(2.0, Number(effects.playbackSpeed) || 1));
  const outputDuration = Math.max(0.5, Number((clipDuration / speed).toFixed(2)));
  const [rawW, rawH] = getDimensionsForResolution(resolution);
  const targetW = Math.floor(rawW / 2) * 2;
  const targetH = Math.floor(rawH / 2) * 2;

  // 1. Write real SRT file (time-scaled for playback speed & smart-cut cleaned if enabled)
  const srtContent = generateSrtContent(subtitleCues, speed, Boolean(effects.smartCut));
  fs.writeFileSync(outSrtPath, srtContent, 'utf-8');

  // 2. Write calibrated ASS file for burn-in (captions, Auto Hook overlay, and/or watermark)
  const hasCues = subtitleCues.some((c) => c.text.trim().length > 0 && c.end_seconds > c.start_seconds);
  const hasAutoHook = Boolean(effects.autoHookEnabled && effects.autoHookText?.trim());
  const hasWatermark = Boolean(effects.watermark?.text?.trim());
  const shouldBurn = (subtitleSettings.burnIn && hasCues) || hasAutoHook || hasWatermark;

  if (shouldBurn) {
    const assContent = generateAssContent(
      subtitleSettings.burnIn ? subtitleCues : [],
      subtitleSettings,
      targetW,
      targetH,
      effects
    );
    fs.writeFileSync(tempAssPath, assContent, 'utf-8');
  }

  const { preFilters, postFilters, audioFilters } = buildVisualEffectsChain(
    effects,
    targetW,
    targetH,
    outputDuration,
    speed
  );

  const effectivelyMuted = Boolean(effects.audio?.muted);
  const initialUseAudio = hasAudio && !effectivelyMuted;
  const canvasBg = effects.transform?.canvasBg ?? 'blur';

  const runEncodeAttempt = async (useAudio: boolean, burnSubtitles: boolean): Promise<void> => {
    const assFilter = burnSubtitles ? `,ass='${escapeAssFilterPath(tempAssPath)}'` : '';
    let filterComplex: string;

    if (framingMode === 'blurred_background') {
      const bgExpr =
        canvasBg === 'black'
          ? `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,drawbox=c=#080B14:t=fill[bg_blur];`
          : canvasBg === 'slate'
            ? `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,drawbox=c=#1E293B:t=fill[bg_blur];`
            : canvasBg === 'gradient'
              ? `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,drawbox=c=#1B1538:t=fill[bg_blur];`
              : `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,boxblur=22:8,eq=brightness=-0.08[bg_blur];`;

      filterComplex =
        `[0:v]${preFilters}split=2[bg][fg];` +
        bgExpr +
        `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fg_scaled];` +
        `[bg_blur][fg_scaled]overlay=(W-w)/2:(H-h)/2${postFilters}${assFilter},format=yuv420p[vout]`;
    } else if (framingMode === 'subject_crop') {
      const zoomW = Math.round((targetW * 1.16) / 2) * 2;
      const zoomH = Math.round((targetH * 1.16) / 2) * 2;
      filterComplex =
        `[0:v]${preFilters}scale=${zoomW}:${zoomH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1${postFilters}${assFilter},format=yuv420p[vout]`;
    } else {
      filterComplex =
        `[0:v]${preFilters}scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1${postFilters}${assFilter},format=yuv420p[vout]`;
    }

    const audioMapInput = useAudio ? '0:a:0' : '1:a:0';
    if (audioFilters && useAudio) {
      filterComplex += `;[${audioMapInput}]${audioFilters}[aout]`;
    }

    const args: string[] = [
      '-y',
      '-err_detect',
      'ignore_err',
      '-ss',
      Math.max(0, startSeconds).toFixed(2),
      '-t',
      clipDuration.toFixed(2),
      '-i',
      sourceVideoPath,
    ];

    if (!useAudio) {
      args.push(
        '-f',
        'lavfi',
        '-t',
        outputDuration.toFixed(2),
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=44100'
      );
    }

    const x264Preset = effects.renderSpeed === 'quality' ? 'veryfast' : 'superfast';
    const x264Crf = effects.renderSpeed === 'quality' ? '22' : '23';

    args.push(
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      audioFilters && useAudio ? '[aout]' : audioMapInput,
      '-c:v',
      'libx264',
      '-preset',
      x264Preset,
      '-crf',
      x264Crf,
      '-threads',
      '0',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '128k',
      '-max_muxing_queue_size',
      '1024',
      '-movflags',
      '+faststart',
      '-shortest',
      outMp4Path
    );

    await execFileAsync('ffmpeg', args, { timeout: 0, maxBuffer: 16 * 1024 * 1024 });
  };

  try {
    try {
      await runEncodeAttempt(initialUseAudio, shouldBurn);
    } catch (firstErr) {
      const msg = (firstErr instanceof Error ? firstErr.message : String(firstErr)).toLowerCase();
      const audioProblem =
        hasAudio &&
        (msg.includes('stream specifier') ||
          msg.includes('matches no streams') ||
          msg.includes('0:a:0') ||
          msg.includes('audio') ||
          msg.includes('atempo') ||
          msg.includes('afade'));
      const assProblem = shouldBurn && (msg.includes('ass') || msg.includes('libass'));

      if (audioProblem) {
        console.warn('[ffmpeg] Audio slice failed during render; retrying with silent audio fallback.');
        await runEncodeAttempt(false, shouldBurn);
      } else if (assProblem) {
        console.warn('[ffmpeg] Subtitle burn-in filter failed; retrying encode without ASS burn-in.');
        await runEncodeAttempt(hasAudio, false);
      } else {
        throw firstErr;
      }
    }
  } finally {
    if (fs.existsSync(tempAssPath)) {
      try {
        fs.unlinkSync(tempAssPath);
      } catch {
        // ignore
      }
    }
  }

  if (!fs.existsSync(outMp4Path)) {
    throw new Error('FFmpeg completed without producing an output MP4 file.');
  }

  const mp4Stat = fs.statSync(outMp4Path);
  const srtStat = fs.statSync(outSrtPath);

  if (mp4Stat.size < 1024) {
    throw new Error('Rendered MP4 output appears empty or corrupted.');
  }

  return {
    mp4SizeBytes: mp4Stat.size,
    srtSizeBytes: srtStat.size,
    duration: outputDuration,
  };
}

/**
 * Generates a real 16:9 H.264/AAC MP4 sample video from a studio still image
 * plus an optional spoken narration WAV (or subtle ambient sine if offline),
 * complete with smooth motion zoom and live waveform/timecode overlay.
 */
export async function buildSampleMp4(options: {
  imagePath: string;
  audioWavPath: string | null;
  durationSeconds: number;
  outMp4Path: string;
}): Promise<void> {
  const { imagePath, audioWavPath, durationSeconds, outMp4Path } = options;
  const dir = path.dirname(outMp4Path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const args: string[] = [
    '-y',
    '-loop',
    '1',
    '-framerate',
    '24',
    '-t',
    durationSeconds.toFixed(2),
    '-i',
    imagePath,
  ];

  if (audioWavPath && fs.existsSync(audioWavPath)) {
    args.push('-i', audioWavPath);
  } else {
    // Clean low-level gentle harmonic pad so video always has a valid AAC audio stream
    args.push(
      '-f',
      'lavfi',
      '-t',
      durationSeconds.toFixed(2),
      '-i',
      'sine=frequency=220:sample_rate=24000'
    );
  }

  // Gentle motion scale + audio spectrum visualizer strip at bottom so video visibly moves
  const vf =
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p[base];` +
    `[1:a]showwaves=s=1280x68:mode=cline:colors=0x20C7D9|0x7657FF:rate=24[waves];` +
    `[base][waves]overlay=0:H-76:format=auto[vout]`;

  args.push(
    '-filter_complex',
    vf,
    '-map',
    '[vout]',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    '-shortest',
    outMp4Path
  );

  await execFileAsync('ffmpeg', args, { timeout: 120000 });
}
