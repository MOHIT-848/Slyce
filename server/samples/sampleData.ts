import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  AUTO_HOOK_STYLE_CARDS,
  type AutoHookStyle,
  type ClipCandidate,
  type SampleVideoInfo,
  type TranscriptSegment,
} from '../../src/types/clipforge.ts';
import { isGeminiConfigured, synthesizeSampleNarration, validateAndRankCandidates } from '../ai/geminiService.ts';
import { buildSampleMp4, inspectVideo } from '../media/ffmpegService.ts';
import { ROOT_DIR, SAMPLES_DIR, ensureStorageDirs } from '../utils/storage.ts';
import { generateAssContent } from '../utils/subtitles.ts';

const execFileAsync = promisify(execFile);

export interface SampleDefinition extends SampleVideoInfo {
  filename: string;
  imagePath: string;
  voice: 'Kore' | 'Puck';
  script: string;
  demoSegments: Array<{ start: number; end: number; text: string }>;
  demoHighlights: Array<{
    start_time: number;
    end_time: number;
    title: string;
    hook: string;
    summary: string;
    selection_reason: string;
    completeness: number;
    hook_strength: number;
    useful_information: number;
    emotional_emphasis: number;
    duration_fit: number;
    score_explanation: string;
  }>;
}

export const SAMPLE_DEFINITIONS: SampleDefinition[] = [
  {
    id: 'sample-talking-head',
    title: 'Why Most Creators Burn Out on Short-Form Video',
    category: 'Landscape Talking Head',
    duration_seconds: 48,
    description:
      'A 16:9 studio talking-head essay explaining how creators waste hours scrubbing timelines instead of starting from spoken structure.',
    thumbnail_url: '/src/assets/images/sample_talking_head_1794890384304.jpg',
    filename: 'clipforge_sample_talking_head.mp4',
    imagePath: path.join(ROOT_DIR, 'src/assets/images/sample_talking_head_1794890384304.jpg'),
    voice: 'Kore',
    script:
      'Most creators do not burn out because they run out of ideas. They burn out because turning one twenty-minute recording into four vertical clips takes three hours of scrubbing timelines and typing captions by hand. Here is the shift that fixes it: stop editing from the waveform and start editing from the transcript. When you read what you actually said, three things jump off the page immediately. First, look for moments where you answer one specific question completely in under forty seconds. Second, cut any throat-clearing before your opening hook, because the first two seconds determine whether a viewer stays for the explanation. Third, keep the original context intact—never chop off a qualification just to make a clip louder. Review every candidate yourself, tweak the subtitle phrasing so it reads cleanly on a phone screen, and export when you are genuinely proud of the cut.',
    demoSegments: [
      {
        start: 0.0,
        end: 7.4,
        text: 'Most creators do not burn out because they run out of ideas. They burn out turning one recording into four vertical clips.',
      },
      {
        start: 7.4,
        end: 13.8,
        text: 'Here is the shift that fixes it: stop editing from the waveform and start editing from the transcript.',
      },
      {
        start: 13.8,
        end: 21.5,
        text: 'First, look for moments where you answer one specific question completely in under forty seconds.',
      },
      {
        start: 21.5,
        end: 29.8,
        text: 'Second, cut any throat-clearing before your opening hook, because the first two seconds decide whether viewers stay.',
      },
      {
        start: 29.8,
        end: 38.6,
        text: 'Third, keep the original context intact—never chop off a qualification just to make a clip sound louder.',
      },
      {
        start: 38.6,
        end: 47.5,
        text: 'Review every candidate yourself, tweak the subtitle phrasing for mobile, and export only when you stand behind the cut.',
      },
    ],
    demoHighlights: [
      {
        start_time: 0.0,
        end_time: 14.0,
        title: 'Edit From the Transcript, Not the Waveform',
        hook: 'Most creators do not burn out because they run out of ideas.',
        summary: 'Reframes short-form repurposing from timeline scrubbing to transcript-first selection.',
        selection_reason: 'Strong opening hook with an immediate actionable reframe.',
        completeness: 88,
        hook_strength: 92,
        useful_information: 84,
        emotional_emphasis: 82,
        duration_fit: 86,
        score_explanation: 'Opens with a relatable tension and resolves cleanly with a concrete workflow change.',
      },
      {
        start_time: 13.8,
        end_time: 29.8,
        title: 'The Two-Second Hook & 40-Second Answer Rule',
        hook: 'Look for moments where you answer one specific question completely.',
        summary: 'Gives two concrete editing rules: self-contained answers and trimming pre-hook filler.',
        selection_reason: 'High educational value with two clear, numbered takeaways.',
        completeness: 90,
        hook_strength: 80,
        useful_information: 92,
        emotional_emphasis: 74,
        duration_fit: 94,
        score_explanation: 'Delivers two structured, directly applicable criteria for selecting short clips.',
      },
      {
        start_time: 29.8,
        end_time: 47.5,
        title: 'Why Context Matters More Than Loud Cuts',
        hook: 'Keep the original context intact—never chop off a qualification.',
        summary: 'Advocates human-in-the-loop review and preserving speaker intent before exporting.',
        selection_reason: 'Memorable ethical takeaway that stands alone as a closing principle.',
        completeness: 86,
        hook_strength: 78,
        useful_information: 85,
        emotional_emphasis: 88,
        duration_fit: 90,
        score_explanation: 'Expressive statement of creator responsibility paired with a practical review step.',
      },
    ],
  },
  {
    id: 'sample-tutorial',
    title: 'Three Rules for Sub-50ms API Caching',
    category: 'Tutorial & Educational',
    duration_seconds: 46,
    description:
      'A concise developer tutorial covering cache keys, stale-while-revalidate headers, and avoiding stampedes in production APIs.',
    thumbnail_url: '/src/assets/images/sample_tutorial_deck_1794890384508.jpg',
    filename: 'clipforge_sample_tutorial.mp4',
    imagePath: path.join(ROOT_DIR, 'src/assets/images/sample_tutorial_deck_1794890384508.jpg'),
    voice: 'Puck',
    script:
      'If your API endpoint takes four hundred milliseconds to respond, adding a bigger database is rarely the fastest fix. Let us walk through three caching rules that cut latency under fifty milliseconds. Rule number one: normalize your cache keys before lookup. Query parameter order and trailing slashes silently destroy hit rates if you hash raw URLs. Rule number two: use stale-while-revalidate so users receive an instant cached payload while your server refreshes the data asynchronously in the background. Rule number three: protect your origin from cache stampedes using request coalescing—when a popular key expires, only one worker recomputes it while waiting requests share that single promise.',
    demoSegments: [
      {
        start: 0.0,
        end: 8.2,
        text: 'If your API takes 400 milliseconds to respond, adding a bigger database is rarely the fastest fix.',
      },
      {
        start: 8.2,
        end: 17.6,
        text: 'Rule one: normalize your cache keys before lookup. Query parameter order silently destroys hit rates if you hash raw URLs.',
      },
      {
        start: 17.6,
        end: 29.0,
        text: 'Rule two: use stale-while-revalidate so users get an instant payload while the server refreshes in the background.',
      },
      {
        start: 29.0,
        end: 45.5,
        text: 'Rule three: prevent cache stampedes with request coalescing—only one worker recomputes an expired key while callers share the promise.',
      },
    ],
    demoHighlights: [
      {
        start_time: 0.0,
        end_time: 17.6,
        title: 'Why Raw URL Hashing Breaks Your Cache Hit Rate',
        hook: 'Adding a bigger database is rarely the fastest fix.',
        summary: 'Explains how unnormalized query strings and slashes quietly tank API cache hit rates.',
        selection_reason: 'Surprising engineering diagnostic with immediate practical fix.',
        completeness: 87,
        hook_strength: 89,
        useful_information: 91,
        emotional_emphasis: 75,
        duration_fit: 92,
        score_explanation: 'Strong contrarian opener followed by a specific root-cause explanation.',
      },
      {
        start_time: 17.6,
        end_time: 29.0,
        title: 'Instant Responses With Stale-While-Revalidate',
        hook: 'Serve an instant cached payload while refreshing asynchronously.',
        summary: 'Concise breakdown of the stale-while-revalidate caching pattern.',
        selection_reason: 'Self-contained technical tip ideal for developer short-form audiences.',
        completeness: 84,
        hook_strength: 79,
        useful_information: 93,
        emotional_emphasis: 70,
        duration_fit: 85,
        score_explanation: 'Crisp single-concept explanation with clear user-facing latency benefit.',
      },
      {
        start_time: 29.0,
        end_time: 45.5,
        title: 'Stopping Cache Stampedes With Request Coalescing',
        hook: 'Protect your origin from cache stampedes using request coalescing.',
        summary: 'Shows how sharing a single in-flight promise prevents origin overload when keys expire.',
        selection_reason: 'High-value production reliability insight with clear mechanism.',
        completeness: 91,
        hook_strength: 83,
        useful_information: 94,
        emotional_emphasis: 78,
        duration_fit: 90,
        score_explanation: 'Complete architectural explanation from failure mode to exact solution.',
      },
    ],
  },
];

export function listSampleVideos(): SampleVideoInfo[] {
  return SAMPLE_DEFINITIONS.map(({ id, title, category, duration_seconds, description, thumbnail_url }) => ({
    id,
    title,
    category,
    duration_seconds,
    description,
    thumbnail_url,
  }));
}

export function getSampleDefinition(sampleId: string): SampleDefinition | undefined {
  return SAMPLE_DEFINITIONS.find((s) => s.id === sampleId);
}

/**
 * Ensures the requested team-owned sample MP4 exists on disk.
 * When GEMINI_API_KEY is available and preferRealSpeech is true, synthesizes real
 * spoken audio via Gemini TTS and caches a spoken MP4 so the full transcription
 * + highlight pipeline executes against genuine spoken audio.
 */
export async function ensureSampleVideoFile(
  sampleId: string,
  preferRealSpeech: boolean
): Promise<{ videoPath: string; hasRealSpeech: boolean }> {
  ensureStorageDirs();
  const def = getSampleDefinition(sampleId);
  if (!def) {
    throw new Error(`Unknown sample ID: ${sampleId}`);
  }

  const spokenMp4Path = path.join(SAMPLES_DIR, `${def.id}_spoken.mp4`);
  const baseMp4Path = path.join(SAMPLES_DIR, def.filename);

  if (preferRealSpeech && isGeminiConfigured()) {
    if (fs.existsSync(spokenMp4Path)) {
      return { videoPath: spokenMp4Path, hasRealSpeech: true };
    }
    const wavPath = path.join(SAMPLES_DIR, `${def.id}_tts.wav`);
    const synthesized = await synthesizeSampleNarration(def.script, def.voice, wavPath);
    if (synthesized && fs.existsSync(wavPath)) {
      // Inspect WAV duration or fall back to def.duration_seconds
      let wavDur = def.duration_seconds;
      try {
        // Compute duration from 24kHz 16-bit mono WAV header/size if needed
        const stat = fs.statSync(wavPath);
        const estimated = (stat.size - 44) / (24000 * 2);
        if (estimated > 10) wavDur = Number(estimated.toFixed(2));
      } catch {
        // ignore
      }
      await buildSampleMp4({
        imagePath: def.imagePath,
        audioWavPath: wavPath,
        durationSeconds: wavDur,
        outMp4Path: spokenMp4Path,
      });
      return { videoPath: spokenMp4Path, hasRealSpeech: true };
    }
  }

  if (!fs.existsSync(baseMp4Path)) {
    await buildSampleMp4({
      imagePath: def.imagePath,
      audioWavPath: null,
      durationSeconds: def.duration_seconds,
      outMp4Path: baseMp4Path,
    });
  }

  return { videoPath: baseMp4Path, hasRealSpeech: false };
}

export async function buildDemoDataForSample(
  jobId: string,
  sampleId: string,
  actualDuration: number
): Promise<{ segments: TranscriptSegment[]; clips: ClipCandidate[] }> {
  const def = getSampleDefinition(sampleId);
  if (!def) throw new Error('Sample not found');

  const scale = actualDuration / def.duration_seconds;
  const segments: TranscriptSegment[] = def.demoSegments.map((s, idx) => ({
    id: `seg-${idx + 1}`,
    job_id: jobId,
    start_seconds: Number((s.start * scale).toFixed(2)),
    end_seconds: Number(Math.min(actualDuration, s.end * scale).toFixed(2)),
    text: s.text,
    speaker_label: 'Speaker 1',
    confidence_note: null,
  }));

  const scaledRaw = def.demoHighlights.map((h) => ({
    ...h,
    start_time: Number((h.start_time * scale).toFixed(2)),
    end_time: Number(Math.min(actualDuration, h.end_time * scale).toFixed(2)),
    transcript_excerpt: segments
      .filter((seg) => seg.end_seconds > h.start_time * scale && seg.start_seconds < h.end_time * scale)
      .map((seg) => seg.text)
      .join(' '),
  }));

  const clips = validateAndRankCandidates({
    jobId,
    rawCandidates: scaledRaw,
    segments,
    videoDuration: actualDuration,
    minDuration: 5,
    maxDuration: 90,
  });

  // Verify ffprobe metadata consistency if needed
  void inspectVideo;
  return { segments, clips };
}

function escapeAssFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

/**
 * Builds and caches a 3.5s 3:4 animated portrait MP4 sample for each Auto Hook preset
 * (Editorial, Statement, Classic) so Recipe Studio cards render genuine playing videos.
 */
export async function ensureAutoHookSampleVideo(styleId: AutoHookStyle): Promise<string> {
  ensureStorageDirs();
  const card = AUTO_HOOK_STYLE_CARDS.find((c) => c.id === styleId);
  if (!card) {
    throw new Error(`Unknown Auto Hook style: ${styleId}`);
  }

  const outMp4Path = path.join(SAMPLES_DIR, `autohook_${styleId}.mp4`);
  if (fs.existsSync(outMp4Path) && fs.statSync(outMp4Path).size > 10000) {
    return outMp4Path;
  }

  const relImg = card.imageUrl.replace(/^\//, '');
  const imgPath = path.join(ROOT_DIR, relImg);
  if (!fs.existsSync(imgPath)) {
    throw new Error(`Auto Hook image asset missing: ${relImg}`);
  }

  const tempAssPath = path.join(SAMPLES_DIR, `autohook_${styleId}.ass`);
  const headline = `${card.sampleEyebrow} ${card.sampleHeadline}`.trim();
  const assContent = generateAssContent(
    [
      {
        id: 'hook-demo-1',
        start_seconds: 0.35,
        end_seconds: 3.3,
        text: styleId === 'editorial' ? 'Calm focus, real clarity.' : styleId === 'statement' ? 'Ship vertical clips faster.' : 'Tap to preview motion.',
      },
    ],
    {
      style: styleId === 'classic' ? 'word_cut' : styleId === 'statement' ? 'karaoke' : 'minimal_clean',
      fontFamily: styleId === 'editorial' ? 'Noto Serif Display' : 'Noto Sans Display',
      fontWeight: 'bold',
      fontSize: 22,
      position: 'bottom',
      animation: 'fade',
      burnIn: true,
    },
    540,
    720,
    {
      introTransition: 'fade_in',
      introDuration: 0.35,
      outroTransition: 'none',
      outroDuration: 0.3,
      motionAnimation: 'subtle_zoom',
      visualPreset: 'natural',
      autoHookEnabled: true,
      autoHookStyle: styleId,
      autoHookText: headline,
    }
  );
  fs.writeFileSync(tempAssPath, assContent, 'utf-8');

  const tmpOutPath = `${outMp4Path}.tmp.mp4`;
  try {
    const escapedAss = escapeAssFilterPath(path.resolve(tempAssPath));
    const vf =
      `scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440,` +
      `zoompan=z='1+0.08*(on/84)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=540x720:fps=24,` +
      `fade=t=in:st=0:d=0.3,format=yuv420p,ass='${escapedAss}'`;

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-loop',
        '1',
        '-framerate',
        '24',
        '-t',
        '3.5',
        '-i',
        imgPath,
        '-f',
        'lavfi',
        '-t',
        '3.5',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=24000',
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '26',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        '-shortest',
        tmpOutPath,
      ],
      { timeout: 60000 }
    );
    fs.renameSync(tmpOutPath, outMp4Path);
    return outMp4Path;
  } finally {
    try {
      if (fs.existsSync(tempAssPath)) fs.unlinkSync(tempAssPath);
      if (fs.existsSync(tmpOutPath)) fs.unlinkSync(tmpOutPath);
    } catch {
      // ignore
    }
  }
}

