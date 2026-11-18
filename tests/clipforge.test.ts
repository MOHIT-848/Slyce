import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildWholeVideoClip,
  callWithModelFallback,
  chunkTranscript,
  computeExplainableScore,
  isAuthOrConfigError,
  isRetryableFallbackError,
  isTransientOrOverloadError,
  validateAndRankCandidates,
} from '../server/ai/geminiService.ts';
import {
  buildSampleMp4,
  checkFfmpegCapabilities,
  inspectVideo,
  renderVerticalClip,
} from '../server/media/ffmpegService.ts';
import { buildVisualTimelineClips } from '../server/workers/jobProcessor.ts';
import { convertCookiesToNetscape, parseYoutubeUrl } from '../server/media/youtubeService.ts';
import {
  buildCuesFromTranscript,
  generateAssContent,
  generateSrtContent,
  scaleSubtitleCuesForSpeed,
} from '../server/utils/subtitles.ts';
import {
  DEFAULT_RECIPE_CONFIG,
  applySmartCutToCueText,
  resolveClipDefaultsFromRecipe,
  resolveDurationWindow,
  type TranscriptSegment,
} from '../src/types/clipforge.ts';

describe('ClipForge AI Scoring & Transcript Pipeline', () => {
  it('computes exact weighted explainable scores (30/25/20/15/10)', () => {
    const score = computeExplainableScore({
      completeness: 90,
      hook_strength: 80,
      useful_information: 100,
      emotional_emphasis: 60,
      duration_fit: 70,
    });
    // 27 + 20 + 20 + 9 + 7 = 83
    expect(score).toBe(83);
  });

  it('chunks transcript into overlapping windows preserving sentences', () => {
    const segments: TranscriptSegment[] = Array.from({ length: 12 }, (_, i) => ({
      id: `seg-${i + 1}`,
      job_id: 'job-test',
      start_seconds: i * 10,
      end_seconds: (i + 1) * 10,
      text: `Sentence number ${i + 1} with useful details.`,
      speaker_label: null,
    }));

    const windows = chunkTranscript(segments, 50, 15);
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows[0].startSeconds).toBe(0);
    expect(windows[0].formattedTranscript).toContain('[0.0s - 10.0s]');
  });

  it('validates, clamps timestamps, deduplicates overlapping candidates, and allows unlimited clips', () => {
    const segments: TranscriptSegment[] = Array.from({ length: 7 }, (_, idx) => ({
      id: `s${idx + 1}`,
      job_id: 'j1',
      start_seconds: idx * 20,
      end_seconds: (idx + 1) * 20,
      text: `Distinct point number ${idx + 1}.`,
      speaker_label: null,
    }));

    const distinctRaw = Array.from({ length: 7 }, (_, idx) => ({
      start_time: idx === 0 ? -2 : idx * 20,
      end_time: idx === 6 ? 150 : (idx + 1) * 20,
      title: `Clip ${idx + 1}`,
      hook: `Hook ${idx + 1}`,
      summary: `Summary ${idx + 1}`,
      transcript_excerpt: `Distinct point number ${idx + 1}.`,
      selection_reason: 'Strong point',
      completeness: 90 - idx,
      hook_strength: 88,
      useful_information: 85,
      emotional_emphasis: 80,
      duration_fit: 85,
      score_explanation: 'Complete moment.',
    }));

    // Add duplicate heavily overlapping first clip
    distinctRaw.push({
      start_time: 1,
      end_time: 18,
      title: 'Duplicate Overlap',
      hook: 'Dup',
      summary: 'Dup',
      transcript_excerpt: 'Distinct point number 1.',
      selection_reason: 'Dup',
      completeness: 50,
      hook_strength: 50,
      useful_information: 50,
      emotional_emphasis: 50,
      duration_fit: 50,
      score_explanation: 'Lower score duplicate.',
    });

    const candidates = validateAndRankCandidates({
      jobId: 'j1',
      videoDuration: 140,
      segments,
      minDuration: 5,
      rawCandidates: distinctRaw,
    });

    expect(candidates.length).toBe(7);
    expect(candidates[0].start_seconds).toBe(0);
    expect(candidates.find((c) => c.title === 'Clip 7')?.end_seconds).toBe(140);
    expect(candidates.some((c) => c.title === 'Duplicate Overlap')).toBe(false);
  });

  it('parses standard, short, live, and youtu.be YouTube URLs cleanly', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw')).toEqual({
      videoId: 'jNQXAC9IVRw',
      canonicalUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    });
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(parseYoutubeUrl('https://youtube.com/shorts/abcdefghijk')).toEqual({
      videoId: 'abcdefghijk',
      canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(parseYoutubeUrl('https://example.com/not-youtube')).toBeNull();
  });

  it('generates valid SRT and safe-margin ASS subtitles', () => {
    const cues = buildCuesFromTranscript(
      [
        {
          start_seconds: 10,
          end_seconds: 16,
          text: 'ClipForge turns long recordings into reviewable vertical clips with editable captions.',
        },
      ],
      10,
      16
    );
    expect(cues.length).toBeGreaterThanOrEqual(1);
    expect(cues[0].start_seconds).toBe(0);

    const srt = generateSrtContent(cues);
    expect(srt).toContain('00:00:00,000 -->');

    const ass = generateAssContent(
      cues,
      {
        style: 'bold_creator',
        fontFamily: 'Noto Serif Display',
        fontWeight: 'extrabold',
        italic: true,
        uppercase: true,
        textColor: '#20C7D9',
        outlineColor: '#000000',
        outlineWidth: 4,
        fontSize: 30,
        position: 'bottom',
        animation: 'pop',
        burnIn: true,
      },
      1080,
      1920
    );
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('Noto Serif Display');
    expect(ass).toContain('&H00D9C720');
    expect(ass).toContain('\\fscx72');
    expect(ass).toContain('CLIPFORGE');

    const hookAss = generateAssContent(
      cues,
      {
        style: 'marker_sweep',
        fontFamily: 'Liberation Sans',
        fontWeight: 'extrabold',
        uppercase: true,
        fontSize: 28,
        position: 'bottom',
        animation: 'typewriter',
        burnIn: true,
      },
      1080,
      1920,
      {
        introTransition: 'none',
        introDuration: 0.5,
        outroTransition: 'none',
        outroDuration: 0.5,
        motionAnimation: 'none',
        visualPreset: 'natural',
        autoHookEnabled: true,
        autoHookStyle: 'editorial',
        autoHookText: 'Stop waiting. Start creating.',
      }
    );
    expect(hookAss).toContain('Title: SLYCE Subtitles');
    expect(hookAss).toContain('Style: AutoHook');
    expect(hookAss).toContain('Stop waiting. Start\\Ncreating.');
  });

  it('converts Cookie-Editor JSON arrays cleanly into Netscape cookies.txt', () => {
    const jsonCookies = JSON.stringify([
      {
        domain: '.youtube.com',
        name: 'SID',
        value: 'abc123token',
        path: '/',
        secure: true,
        expirationDate: 1900000000,
      },
    ]);
    const converted = convertCookiesToNetscape(jsonCookies);
    expect(converted.lineCount).toBe(1);
    expect(converted.netscapeText).toContain('# Netscape HTTP Cookie File');
    expect(converted.netscapeText).toContain('.youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tabc123token');
  });
});

describe('FFmpeg Media Inspection & Vertical 9:16 Rendering', () => {
  it('inspects a real MP4 and renders a playable 9:16 vertical MP4 with burned subtitles and SRT', async () => {
    const caps = await checkFfmpegCapabilities();
    expect(caps.ffmpegAvailable).toBe(true);
    expect(caps.ffprobeAvailable).toBe(true);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipforge-test-'));
    try {
      const sampleImg = path.resolve(
        process.cwd(),
        'src/assets/images/sample_talking_head_1794890384304.jpg'
      );
      const sourceMp4 = path.join(tmpDir, 'source.mp4');
      await buildSampleMp4({
        imagePath: sampleImg,
        audioWavPath: null,
        durationSeconds: 8,
        outMp4Path: sourceMp4,
      });

      const meta = await inspectVideo(sourceMp4);
      expect(meta.width).toBe(1280);
      expect(meta.height).toBe(720);
      expect(meta.duration).toBeGreaterThan(7);

      const outMp4 = path.join(tmpDir, 'vertical.mp4');
      const outSrt = path.join(tmpDir, 'vertical.srt');
      const tempAss = path.join(tmpDir, 'vertical.ass');

      const result = await renderVerticalClip({
        sourceVideoPath: sourceMp4,
        hasAudio: meta.hasAudio,
        startSeconds: 1,
        endSeconds: 6,
        framingMode: 'blurred_background',
        resolution: '720x1280',
        subtitleCues: [
          { id: 'c1', start_seconds: 0.2, end_seconds: 2.4, text: 'First verified caption line.' },
          { id: 'c2', start_seconds: 2.5, end_seconds: 4.8, text: 'Second verified caption line.' },
        ],
        subtitleSettings: {
          style: 'classic_white',
          fontFamily: 'JetBrains Mono',
          fontWeight: 'bold',
          textColor: '#20C7D9',
          fontSize: 28,
          position: 'bottom',
          animation: 'fade',
          burnIn: true,
        },
        effects: {
          introTransition: 'fade_in',
          introDuration: 0.4,
          outroTransition: 'fade_out',
          outroDuration: 0.4,
          motionAnimation: 'ken_burns_zoom_in',
          visualPreset: 'vivid_social',
        },
        outMp4Path: outMp4,
        outSrtPath: outSrt,
        tempAssPath: tempAss,
      });

      expect(result.mp4SizeBytes).toBeGreaterThan(5000);
      expect(result.srtSizeBytes).toBeGreaterThan(20);

      const outMeta = await inspectVideo(outMp4);
      expect(outMeta.width).toBe(720);
      expect(outMeta.height).toBe(1280);
      expect(outMeta.duration).toBeGreaterThanOrEqual(4.5);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60000);

  it('sends TTS requests to the v1beta endpoint with speechMetadata and speechConfig', async () => {
    const { synthesizeSampleNarration } = await import('../server/ai/geminiService.ts');
    const origKey = process.env.GEMINI_API_KEY;
    const origFetch = globalThis.fetch;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slyce-tts-test-'));
    const outWav = path.join(tmpDir, 'narration.wav');

    let capturedUrl = '';
    let capturedBody: Record<string, unknown> | null = null;

    try {
      process.env.GEMINI_API_KEY = 'test-dummy-gemini-key-for-unit-test';
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const fakePcm = Buffer.alloc(4800).toString('base64');
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'audio/l16', data: fakePcm } }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      const ok = await synthesizeSampleNarration('Hello SLYCE creators.', 'Kore', outWav);
      expect(ok).toBe(true);
      expect(capturedUrl).toContain('/v1beta/models/gemini-3.8-flash-lite-tts:generateContent');
      expect(capturedBody).toBeTruthy();
      expect(fs.existsSync(outWav)).toBe(true);
      const wavBytes = fs.readFileSync(outWav);
      expect(wavBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    } finally {
      globalThis.fetch = origFetch;
      if (origKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origKey;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleans filler words, scales subtitle timing for playback speed, and builds whole-video clips', () => {
    expect(applySmartCutToCueText('Um, this is uh actually very clear, er yes!')).toBe(
      'this is actually very clear, yes!'
    );

    const scaled = scaleSubtitleCuesForSpeed(
      [{ id: 'c1', start_seconds: 1.5, end_seconds: 4.5, text: 'Uh hello world um' }],
      1.5,
      true
    );
    expect(scaled).toEqual([{ id: 'c1', start_seconds: 1, end_seconds: 3, text: 'hello world' }]);

    const whole = buildWholeVideoClip({
      jobId: 'job-w',
      title: 'Full Session',
      durationSeconds: 30,
      smartCut: true,
      segments: [
        { id: 's1', job_id: 'job-w', start_seconds: 2, end_seconds: 8, text: 'Um welcome everyone.', speaker_label: null },
        { id: 's2', job_id: 'job-w', start_seconds: 9, end_seconds: 24, text: 'Here is the demo.', speaker_label: null },
      ],
    });
    expect(whole.start_seconds).toBe(1.8);
    expect(whole.end_seconds).toBe(24.2);
    expect(whole.subtitle_cues[0].text).not.toContain('Um');

    const defaults = resolveClipDefaultsFromRecipe({
      ...DEFAULT_RECIPE_CONFIG,
      recipe: 'clip_long_video',
      aspectRatio: '1:1',
      reframeMode: 'subject',
      playbackSpeed: 1.25,
      subtleZoom: true,
    });
    expect(defaults.aspectRatio).toBe('1:1');
    expect(defaults.exportResolution).toBe('1080x1080');
    expect(defaults.framingMode).toBe('subject_crop');
    expect(defaults.effects.playbackSpeed).toBe(1.25);
    expect(defaults.effects.motionAnimation).toBe('subtle_zoom');
    expect(resolveDurationWindow('medium_60', 15, 60, 180)).toEqual({ min: 25, max: 60 });
  });

  it('renders 1:1 square subject_crop subtle_zoom clip and 16:9 1.5x sped-up clip with FFmpeg', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slyce-aspect-test-'));
    try {
      const sampleImg = path.resolve(
        process.cwd(),
        'src/assets/images/sample_talking_head_1794890384304.jpg'
      );
      const sourceMp4 = path.join(tmpDir, 'source.mp4');
      await buildSampleMp4({
        imagePath: sampleImg,
        audioWavPath: null,
        durationSeconds: 8,
        outMp4Path: sourceMp4,
      });

      const meta = await inspectVideo(sourceMp4);

      // Render 1:1 square with subject_crop and subtle_zoom
      const sqMp4 = path.join(tmpDir, 'square.mp4');
      const sqSrt = path.join(tmpDir, 'square.srt');
      await renderVerticalClip({
        sourceVideoPath: sourceMp4,
        hasAudio: meta.hasAudio,
        startSeconds: 0,
        endSeconds: 4,
        framingMode: 'subject_crop',
        resolution: '720x720',
        subtitleCues: [{ id: 'c1', start_seconds: 0.2, end_seconds: 3.2, text: 'Uh square framing test.' }],
        subtitleSettings: { style: 'classic_white', fontSize: 28, position: 'bottom', burnIn: true },
        effects: {
          introTransition: 'none',
          introDuration: 0.4,
          outroTransition: 'none',
          outroDuration: 0.4,
          motionAnimation: 'subtle_zoom',
          visualPreset: 'natural',
          playbackSpeed: 1,
          smartCut: true,
        },
        outMp4Path: sqMp4,
        outSrtPath: sqSrt,
        tempAssPath: path.join(tmpDir, 'sq.ass'),
      });
      const sqMeta = await inspectVideo(sqMp4);
      expect(sqMeta.width).toBe(720);
      expect(sqMeta.height).toBe(720);
      expect(fs.readFileSync(sqSrt, 'utf-8')).toContain('square framing test.');

      // Render 16:9 horizontal at 1.5x speed (6s source -> ~4s output)
      const wideMp4 = path.join(tmpDir, 'wide-fast.mp4');
      const wideSrt = path.join(tmpDir, 'wide-fast.srt');
      const wideRes = await renderVerticalClip({
        sourceVideoPath: sourceMp4,
        hasAudio: meta.hasAudio,
        startSeconds: 0,
        endSeconds: 6,
        framingMode: 'center_crop',
        resolution: '1280x720',
        subtitleCues: [{ id: 'w1', start_seconds: 0, end_seconds: 3, text: 'Fast paced highlight.' }],
        subtitleSettings: { style: 'classic_white', fontSize: 28, position: 'bottom', burnIn: true },
        effects: {
          introTransition: 'none',
          introDuration: 0.4,
          outroTransition: 'none',
          outroDuration: 0.4,
          motionAnimation: 'none',
          visualPreset: 'natural',
          playbackSpeed: 1.5,
        },
        outMp4Path: wideMp4,
        outSrtPath: wideSrt,
        tempAssPath: path.join(tmpDir, 'wide.ass'),
      });
      const wideMeta = await inspectVideo(wideMp4);
      expect(wideMeta.width).toBe(1280);
      expect(wideMeta.height).toBe(720);
      expect(wideRes.duration).toBe(4);
      expect(wideMeta.duration).toBeLessThan(4.5);
      expect(wideMeta.duration).toBeGreaterThan(3.5);
      expect(fs.readFileSync(wideSrt, 'utf-8')).toContain('00:00:02,000');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60000);

  it('generates viral_bounce ASS tags, viral_shorts defaults, and renders viral_dynamic + flash_cut MP4 in fast mode', async () => {
    const bounceAss = generateAssContent(
      [{ id: 'vb1', start_seconds: 0, end_seconds: 1.8, text: 'Watch this trick!' }],
      {
        style: 'word_cut',
        fontFamily: 'Noto Sans Display',
        fontWeight: 'extrabold',
        fontSize: 28,
        position: 'bottom',
        animation: 'viral_bounce',
        burnIn: true,
      },
      1080,
      1920
    );
    expect(bounceAss).toContain('\\fscx66\\fscy66');
    expect(bounceAss).toContain('\\fscx114\\fscy114');

    const viralDefaults = resolveClipDefaultsFromRecipe({
      ...DEFAULT_RECIPE_CONFIG,
      recipe: 'viral_shorts',
    });
    expect(viralDefaults.effects.introTransition).toBe('flash_cut');
    expect(viralDefaults.effects.motionAnimation).toBe('viral_dynamic');
    expect(viralDefaults.effects.visualPreset).toBe('vivid_social');
    expect(viralDefaults.effects.renderSpeed).toBe('fast');
    expect(viralDefaults.subtitleSettings.animation).toBe('viral_bounce');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slyce-viral-test-'));
    try {
      const sampleImg = path.resolve(
        process.cwd(),
        'src/assets/images/sample_talking_head_1794890384304.jpg'
      );
      const sourceMp4 = path.join(tmpDir, 'source.mp4');
      await buildSampleMp4({
        imagePath: sampleImg,
        audioWavPath: null,
        durationSeconds: 6,
        outMp4Path: sourceMp4,
      });

      const meta = await inspectVideo(sourceMp4);
      const outMp4 = path.join(tmpDir, 'viral.mp4');
      const outSrt = path.join(tmpDir, 'viral.srt');
      const res = await renderVerticalClip({
        sourceVideoPath: sourceMp4,
        hasAudio: meta.hasAudio,
        startSeconds: 0,
        endSeconds: 4,
        framingMode: 'center_crop',
        resolution: '720x1280',
        subtitleCues: [{ id: 'v1', start_seconds: 0.1, end_seconds: 3.5, text: 'Viral hook opener' }],
        subtitleSettings: viralDefaults.subtitleSettings,
        effects: viralDefaults.effects,
        outMp4Path: outMp4,
        outSrtPath: outSrt,
        tempAssPath: path.join(tmpDir, 'viral.ass'),
      });
      expect(res.mp4SizeBytes).toBeGreaterThan(5000);
      const outMeta = await inspectVideo(outMp4);
      expect(outMeta.width).toBe(720);
      expect(outMeta.height).toBe(1280);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60000);

  it('detects high-demand 503 / malformed JSON errors and falls back bidirectionally between models', async () => {
    expect(
      isTransientOrOverloadError(
        new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary.')
      )
    ).toBe(true);
    expect(isRetryableFallbackError(new Error('503 UNAVAILABLE'))).toBe(true);
    expect(isRetryableFallbackError(new Error('Malformed Gemini JSON response: Unexpected token'))).toBe(true);
    expect(isAuthOrConfigError(new Error('API_KEY_INVALID'))).toBe(true);
    expect(isAuthOrConfigError(new Error('This model is currently experiencing high demand.'))).toBe(false);

    const attempted: string[] = [];
    const result = await callWithModelFallback(async (model) => {
      attempted.push(model);
      if (model === 'gemini-3.1-flash-lite') {
        throw new Error('503 UNAVAILABLE: This model is currently experiencing high demand.');
      }
      return `ok-from-${model}`;
    }, 'gemini-3.1-flash-lite');

    expect(attempted).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-4-hydrogen',
    ]);
    expect(result).toBe('ok-from-gemini-4-hydrogen');
  });

  it('falls back from gemini-3.1-flash-lite 429/high-demand to gemini-4-hydrogen and builds visual timeline clips', async () => {
    const modelsTried: string[] = [];
    const picked = await callWithModelFallback(async (model) => {
      modelsTried.push(model);
      if (model === 'gemini-3.1-flash-lite') {
        throw new Error('429 RESOURCE_EXHAUSTED high demand');
      }
      return { ok: true, model };
    }, 'gemini-3.1-flash-lite');

    expect(modelsTried).toEqual(['gemini-3.1-flash-lite', 'gemini-4-hydrogen']);
    expect(picked).toEqual({ ok: true, model: 'gemini-4-hydrogen' });

    const visualClips = buildVisualTimelineClips({
      jobId: 'job-amv',
      videoTitle: 'IDFC Ayanokoji AMV EDIT',
      durationSeconds: 56,
      sceneTimestamps: [6.5, 19.2, 34.0, 47.5],
      minDuration: 10,
      maxDuration: 30,
      maxCandidates: 4,
      reasonLabel: 'No speech detected in audio; prepared scene-cut visual highlights.',
    });
    expect(visualClips.length).toBeGreaterThanOrEqual(2);
    expect(visualClips.every((c) => c.end_seconds > c.start_seconds && c.end_seconds <= 56)).toBe(true);
  });

  it('gracefully recovers renderVerticalClip with silent fallback audio when hasAudio is true on a silent video', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slyce-noaudio-fallback-'));
    try {
      const sampleImg = path.resolve(
        process.cwd(),
        'src/assets/images/sample_talking_head_1794890384304.jpg'
      );
      const silentMp4 = path.join(tmpDir, 'silent.mp4');
      await buildSampleMp4({
        imagePath: sampleImg,
        audioWavPath: null,
        durationSeconds: 5,
        outMp4Path: silentMp4,
      });

      const outMp4 = path.join(tmpDir, 'recovered.mp4');
      const outSrt = path.join(tmpDir, 'recovered.srt');
      const res = await renderVerticalClip({
        sourceVideoPath: silentMp4,
        hasAudio: true, // Intentionally claim audio exists even though buildSampleMp4 w/ null audio produces video-only
        startSeconds: 0,
        endSeconds: 4,
        framingMode: 'center_crop',
        resolution: '720x1280',
        subtitleCues: [],
        subtitleSettings: { style: 'classic_white', fontSize: 28, position: 'bottom', burnIn: true },
        effects: {
          introTransition: 'flash_cut',
          introDuration: 0.3,
          outroTransition: 'fade_out',
          outroDuration: 0.3,
          motionAnimation: 'ken_burns_zoom_in',
          visualPreset: 'natural',
          playbackSpeed: 1,
        },
        outMp4Path: outMp4,
        outSrtPath: outSrt,
        tempAssPath: path.join(tmpDir, 'recovered.ass'),
      });
      expect(res.mp4SizeBytes).toBeGreaterThan(5000);
      const meta = await inspectVideo(outMp4);
      expect(meta.width).toBe(720);
      expect(meta.height).toBe(1280);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60000);
});
