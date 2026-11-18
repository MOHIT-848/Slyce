import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import crypto from 'crypto';
import fs from 'fs';
import {
  SPOKEN_LANGUAGE_OPTIONS,
  applySmartCutToCueText,
  type CaptionMode,
  type ClipCandidate,
  type ScoreBreakdown,
  type SpokenLanguageOption,
  type TranscriptSegment,
} from '../../src/types/clipforge.ts';
import { buildCuesFromTranscript } from '../utils/subtitles.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.trim().length > 10);
}

const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
let runtimeDefaultModel: string | null = null;

export function setConfiguredDefaultModel(model: string | null): void {
  runtimeDefaultModel = model && model !== 'default' ? model : null;
}

export function getConfiguredModel(): string {
  return runtimeDefaultModel || process.env.GEMINI_MODEL || 'gemini-4-hydrogen';
}

function getLatencyThinkingConfig(model: string): { thinkingLevel: ThinkingLevel } | undefined {
  if (model === 'gemini-3.1-flash-lite') {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (model.startsWith('gemini-4-') || model.startsWith('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIdx = 0;

  async function runWorker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

const ACTIVE_MULTIMODAL_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;

export function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate-limit') ||
    msg.includes('rate limit')
  );
}

export function isTransientOrOverloadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('spikes in demand') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily') ||
    msg.includes('try again later') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('internal error') ||
    msg.includes('empty gemini json') ||
    msg.includes('malformed gemini json')
  );
}

export function isRetryableFallbackError(err: unknown): boolean {
  return isQuotaOrRateLimitError(err) || isTransientOrOverloadError(err);
}

export function isAuthOrConfigError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('api_key_invalid') ||
    msg.includes('permission_denied') ||
    msg.includes('gemini_api_key is not configured') ||
    msg.includes('401') ||
    msg.includes('403')
  );
}

function safeParseGeminiJson<T>(rawText: string | undefined): T {
  let cleaned = (rawText ?? '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  if (!cleaned) {
    throw new Error('Empty Gemini JSON response.');
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `Malformed Gemini JSON response: ${err instanceof Error ? err.message : 'parse error'}`
    );
  }
}

function extractReadableApiMessage(raw: string): {
  code?: number;
  message?: string;
  retryIn?: string;
  quotaLimit?: string;
} {
  try {
    const jsonStart = raw.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      const message = parsed.error?.message ?? raw;
      const retryMatch = message.match(/retry in ([^\s.,]+(?:\s+[^\s.,]+)?)/i);
      const limitMatch = message.match(/limit:\s*(\d+)/i);
      return {
        code: parsed.error?.code,
        message,
        retryIn: retryMatch?.[1],
        quotaLimit: limitMatch?.[1],
      };
    }
  } catch {
    // ignore JSON parse errors
  }
  const retryMatch = raw.match(/retry in ([^\s.,]+)/i);
  const limitMatch = raw.match(/limit:\s*(\d+)/i);
  return { message: raw, retryIn: retryMatch?.[1], quotaLimit: limitMatch?.[1] };
}

export function formatGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const info = extractReadableApiMessage(raw);

  if (isQuotaOrRateLimitError(err)) {
    const limitNote = info.quotaLimit ? ` (${info.quotaLimit} requests/day limit reached)` : '';
    const retryNote = info.retryIn ? ` Quota resets in ~${info.retryIn.replace(/\.\d+s$/, 's')}.` : '';
    return new Error(
      `Gemini Free Tier quota exhausted${limitNote} across primary and fallback models.${retryNote} Select a billing-enabled Gemini API key in Settings > Secrets, or click "Retry AI Analysis" later.`
    );
  }

  if (isTransientOrOverloadError(err)) {
    return new Error(
      'Gemini models are temporarily experiencing high demand. SLYCE switched automatically to fallback clipping so your project is ready without waiting — click "Retry AI Analysis" anytime.'
    );
  }

  if (
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('403')
  ) {
    return new Error(
      'Gemini API key was rejected or lacks permission. Please verify GEMINI_API_KEY in AI Studio Settings > Secrets.'
    );
  }

  if (info.message && info.message !== raw) {
    return new Error(info.message);
  }
  return err instanceof Error ? err : new Error(raw);
}

async function withRetries<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Do not burn quota or delay on auth, invalid arguments (except transient malformed JSON), or 429 quota exhaustion
      const isParseRetryable = msg.includes('Gemini JSON response');
      if (
        !isParseRetryable &&
        (isQuotaOrRateLimitError(err) ||
          msg.includes('API_KEY_INVALID') ||
          msg.includes('PERMISSION_DENIED') ||
          msg.includes('INVALID_ARGUMENT') ||
          msg.includes('403') ||
          msg.includes('400'))
      ) {
        throw err;
      }
      if (attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 350);
        await new Promise((r) => setTimeout(r, 900 * Math.pow(2, attempt) + jitter));
      }
    }
  }
  throw lastError;
}

export async function callWithModelFallback<T>(
  fn: (model: string) => Promise<T>,
  modelOverride?: string
): Promise<T> {
  const primaryModel =
    modelOverride && modelOverride !== 'default' ? modelOverride : getConfiguredModel();

  const candidateModels = [
    primaryModel,
    ...ACTIVE_MULTIMODAL_MODELS.filter((m) => m !== primaryModel),
  ];

  let lastErr: unknown;
  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    try {
      return await withRetries(() => fn(model), i === 0 ? 2 : 1);
    } catch (err) {
      lastErr = err;
      const hasMoreModels = i < candidateModels.length - 1;
      if (hasMoreModels && isRetryableFallbackError(err)) {
        console.warn(
          `[gemini] Model "${model}" unavailable or rate-limited; falling back to "${candidateModels[i + 1]}".`
        );
        continue;
      }
      break;
    }
  }

  throw formatGeminiError(lastErr);
}

export interface RawTranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  uncertain?: boolean;
}

export function buildAudioTranscriptionPrompt(
  chunkDurationSeconds: number,
  spokenLanguage: SpokenLanguageOption = 'auto',
  captionMode: CaptionMode = 'auto'
): string {
  const langLabel =
    SPOKEN_LANGUAGE_OPTIONS.find((l) => l.value === spokenLanguage)?.label ?? 'Multi-language';
  const languageRule =
    spokenLanguage && spokenLanguage !== 'auto'
      ? `\n6. Spoken/sung language is ${langLabel} (${spokenLanguage}). Transcribe accurately in ${langLabel}.`
      : '\n6. Support multi-language speech and sung vocals accurately in the original language(s).';

  if (captionMode === 'lyrics') {
    return `Listen carefully to this ${chunkDurationSeconds.toFixed(1)}-second music/song audio track and produce accurate, tightly synced timestamped SONG LYRICS captions.
Rules:
1. Transcribe every audible sung vocal, chorus hook, rap verse, and background lyric line with start and end times in seconds relative to the start of THIS audio clip (between 0.0 and ${chunkDurationSeconds.toFixed(1)}).
2. Break lyrics into crisp, short karaoke-ready lines (typically 1.5 to 4.0 seconds per segment, matching vocal phrasing and beat).
3. NEVER invent lyrics during purely instrumental intros, drops, or breaks; only transcribe vocals you genuinely hear.
4. Set speaker="Lyrics" for sung lines (or "Speaker 1" if spoken).
5. If a line is muffled by heavy instrumentation, still transcribe what is clearly audible and set uncertain=true if needed.${languageRule}`;
  }

  if (captionMode === 'speech') {
    return `Listen carefully to this ${chunkDurationSeconds.toFixed(1)}-second audio recording and produce an accurate, verbatim timestamped spoken transcript.
Rules:
1. Return spoken sentences or natural phrases as segments with start and end times in seconds relative to the start of THIS audio clip (between 0.0 and ${chunkDurationSeconds.toFixed(1)}).
2. Preserve exact spoken words. NEVER invent speech, fill in missing audio with guesses, or fabricate dialogue.
3. If there is only instrumental music, noise, or silence with no speech, return an empty segments array [].
4. If a word or phrase is indistinct or noisy, set uncertain=true on that segment.
5. Keep each segment concise (typically 3 to 10 seconds).${languageRule}`;
  }

  // 'auto': detects BOTH spoken dialogue AND audible song lyrics/vocals!
  return `Listen carefully to this ${chunkDurationSeconds.toFixed(1)}-second audio recording and produce an accurate, verbatim timestamped transcript of BOTH spoken words and any clearly audible sung song lyrics/vocals.
Rules:
1. Return spoken dialogue OR sung song lyric lines as segments with start and end times in seconds relative to the start of THIS audio clip (between 0.0 and ${chunkDurationSeconds.toFixed(1)}).
2. Preserve exact spoken or sung words. NEVER fabricate words during strictly instrumental music, noise, or silence.
3. If the audio is strictly instrumental/silence with zero spoken words and zero sung lyrics, return an empty segments array [].
4. For sung song lyrics, set speaker="Lyrics" and keep lines crisp (1.5 to 4.5 seconds per segment) so captions sync cleanly.
5. If audio is noisy or unclear, set uncertain=true on that segment.${languageRule}`;
}

/**
 * Stage 3: Transcribes an audio chunk using Gemini multimodal audio understanding
 * with structured JSON output preserving timestamps (supports spoken words & song lyrics).
 */
export async function transcribeAudioChunk(options: {
  audioFilePath: string;
  mimeType: string;
  chunkOffsetSeconds: number;
  chunkDurationSeconds: number;
  jobId: string;
  segmentIndexOffset: number;
  modelOverride?: string;
  spokenLanguage?: SpokenLanguageOption;
  captionMode?: CaptionMode;
  turboMode?: boolean;
}): Promise<TranscriptSegment[]> {
  const {
    audioFilePath,
    mimeType,
    chunkOffsetSeconds,
    chunkDurationSeconds,
    jobId,
    segmentIndexOffset,
    modelOverride,
    spokenLanguage = 'auto',
    captionMode = 'auto',
    turboMode = true,
  } = options;

  const ai = getGeminiClient();
  const audioBase64 = fs.readFileSync(audioFilePath).toString('base64');

  // In Turbo mode (when no explicit model override is chosen), route audio transcription
  // through gemini-3.1-flash-lite with MINIMAL thinking for 5-10x lower latency.
  const effectiveModelOverride =
    modelOverride && modelOverride !== 'default'
      ? modelOverride
      : turboMode && !runtimeDefaultModel
        ? FALLBACK_MODEL
        : undefined;

  const prompt = buildAudioTranscriptionPrompt(
    chunkDurationSeconds,
    spokenLanguage,
    captionMode
  );

  let rawSegments: RawTranscriptSegment[] = [];
  try {
    const parsed = await callWithModelFallback(async (model) => {
      const thinkingConfig = getLatencyThinkingConfig(model);
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          ...(thinkingConfig ? { thinkingConfig } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER, description: 'Start time in seconds within this chunk' },
                    end: { type: Type.NUMBER, description: 'End time in seconds within this chunk' },
                    text: { type: Type.STRING, description: 'Verbatim spoken text or sung lyrics' },
                    speaker: { type: Type.STRING, description: 'Optional speaker label such as Speaker 1 or Lyrics' },
                    uncertain: { type: Type.BOOLEAN, description: 'True if audio quality makes speech/lyrics uncertain' },
                  },
                  required: ['start', 'end', 'text'],
                },
              },
            },
            required: ['segments'],
          },
        },
      });
      return safeParseGeminiJson<{ segments?: RawTranscriptSegment[] }>(response.text);
    }, effectiveModelOverride);

    rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  } catch (err) {
    // 3rd-tier dedicated audio transcription model fallback when multimodal models are overloaded/quota-limited
    if (isRetryableFallbackError(err) || isTransientOrOverloadError(err) || isQuotaOrRateLimitError(err)) {
      try {
        console.warn('[gemini] Trying gemini-3.5-transcribe fallback for audio chunk...');
        const fallbackInstruction =
          captionMode === 'lyrics'
            ? 'Transcribe all audible sung song lyrics and vocals line-by-line verbatim. If strictly instrumental with no vocals, reply with NO_SPEECH.'
            : 'Transcribe all spoken dialogue or clearly audible song lyrics verbatim. If there is only instrumental music or silence, reply with NO_SPEECH.';
        const txResp = await withRetries(
          () =>
            ai.models.generateContent({
              model: 'gemini-3.5-transcribe',
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: audioBase64,
                    },
                  },
                  {
                    text: fallbackInstruction,
                  },
                ],
              },
            }),
          1
        );
        const txPlain = (txResp.text ?? '').trim();
        if (!txPlain || /^NO_SPEECH\b/i.test(txPlain)) {
          return [];
        }
        const sentences = txPlain
          .split(/(?<=[.!?])\s+|\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const step = chunkDurationSeconds / Math.max(1, sentences.length);
        rawSegments = sentences.map((text, idx) => ({
          start: Number((idx * step).toFixed(2)),
          end: Number(Math.min(chunkDurationSeconds, (idx + 1) * step).toFixed(2)),
          text,
          speaker: null,
        }));
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }

  const valid: TranscriptSegment[] = [];
  let idx = segmentIndexOffset;

  for (const seg of rawSegments) {
    const cleanText = (seg.text ?? '').trim();
    if (!cleanText) continue;

    const localStart = Math.max(0, Math.min(chunkDurationSeconds, Number(seg.start) || 0));
    const localEnd = Math.max(localStart + 0.3, Math.min(chunkDurationSeconds, Number(seg.end) || localStart + 2));
    if (localEnd <= localStart) continue;

    valid.push({
      id: `seg-${idx++}`,
      job_id: jobId,
      start_seconds: Number((chunkOffsetSeconds + localStart).toFixed(2)),
      end_seconds: Number((chunkOffsetSeconds + localEnd).toFixed(2)),
      text: cleanText,
      speaker_label: seg.speaker ? String(seg.speaker).trim() : null,
      confidence_note: seg.uncertain ? 'Uncertain audio clarity — manual review recommended' : null,
    });
  }

  return valid;
}

export interface TranscriptWindow {
  windowIndex: number;
  startSeconds: number;
  endSeconds: number;
  formattedTranscript: string;
}

/**
 * Stage 4: Splits transcript into overlapping 30-90 second windows preserving
 * complete sentences and original timestamps.
 */
export function chunkTranscript(
  segments: TranscriptSegment[],
  windowSeconds = 60,
  overlapSeconds = 15
): TranscriptWindow[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.start_seconds - b.start_seconds);
  const totalEnd = sorted[sorted.length - 1].end_seconds;
  const windows: TranscriptWindow[] = [];

  let cursor = Math.max(0, sorted[0].start_seconds);
  let windowIndex = 0;

  while (cursor < totalEnd) {
    const windowEnd = cursor + windowSeconds;
    const included = sorted.filter(
      (s) => s.end_seconds > cursor && s.start_seconds < windowEnd
    );

    if (included.length > 0) {
      const actualStart = included[0].start_seconds;
      const actualEnd = included[included.length - 1].end_seconds;
      const lines = included.map(
        (s) => `[${s.start_seconds.toFixed(1)}s - ${s.end_seconds.toFixed(1)}s] ${s.text}`
      );
      windows.push({
        windowIndex: windowIndex++,
        startSeconds: actualStart,
        endSeconds: actualEnd,
        formattedTranscript: lines.join('\n'),
      });
    }

    if (windowEnd >= totalEnd) break;
    cursor += Math.max(20, windowSeconds - overlapSeconds);
  }

  return windows;
}

export interface RawHighlightCandidate {
  start_time: number;
  end_time: number;
  title: string;
  hook: string;
  summary: string;
  transcript_excerpt: string;
  selection_reason: string;
  completeness: number;
  hook_strength: number;
  useful_information: number;
  emotional_emphasis: number;
  duration_fit: number;
  score_explanation: string;
}

/**
 * Deterministic weighted scoring formula from the ClipForge AI blueprint:
 * 30% completeness + 25% hook strength + 20% useful info + 15% emphasis + 10% duration fit.
 */
export function computeExplainableScore(breakdown: Omit<ScoreBreakdown, 'explanation'>): number {
  const clamp100 = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  const weighted =
    clamp100(breakdown.completeness) * 0.30 +
    clamp100(breakdown.hook_strength) * 0.25 +
    clamp100(breakdown.useful_information) * 0.20 +
    clamp100(breakdown.emotional_emphasis) * 0.15 +
    clamp100(breakdown.duration_fit) * 0.10;
  return Math.round(weighted);
}

/**
 * Stage 5: Identifies self-contained short-form highlight candidates across the
 * entire transcript (batched across unlimited video lengths, with no clip count cap).
 */
export async function detectHighlightsFromTranscript(options: {
  jobId: string;
  segments: TranscriptSegment[];
  videoDuration: number;
  videoTitle: string;
  focusPrompt?: string;
  existingClips?: ClipCandidate[];
  modelOverride?: string;
  minDuration?: number;
  maxDuration?: number;
  maxCandidates?: number;
  smartCut?: boolean;
}): Promise<ClipCandidate[]> {
  const {
    jobId,
    segments,
    videoDuration,
    videoTitle,
    focusPrompt,
    existingClips = [],
    modelOverride,
    minDuration,
    maxDuration,
    maxCandidates = Number.POSITIVE_INFINITY,
    smartCut = false,
  } = options;

  if (segments.length === 0) {
    throw new Error('Cannot identify highlights because the transcript is empty.');
  }

  const windows = chunkTranscript(segments, 65, 15);
  const ai = getGeminiClient();

  const minClipLen = minDuration ?? (videoDuration < 45 ? 5 : 10);
  const maxClipLen = maxDuration ?? Math.max(30, Math.min(180, Math.floor(videoDuration)));
  const countInstruction = Number.isFinite(maxCandidates)
    ? `extract the top ${maxCandidates} strongest self-contained short-video moments`
    : `extract ALL strong, self-contained short-video moments from this section (no arbitrary 5-clip limit; include every distinct high-value moment you find, typically 3 to 8 per section)`;

  // Process transcript batches concurrently (up to 3 batches at once) with low-latency thinking
  const BATCH_SIZE = 25;
  const batches: TranscriptWindow[][] = [];
  for (let b = 0; b < windows.length; b += BATCH_SIZE) {
    batches.push(windows.slice(b, b + BATCH_SIZE));
  }

  const existingSummary =
    existingClips.length > 0
      ? `\nExisting clips already extracted (DO NOT repeat these timestamp ranges; find NEW distinct moments):\n${existingClips
          .map((c) => `- ${c.start_seconds.toFixed(1)}s to ${c.end_seconds.toFixed(1)}s: "${c.title}"`)
          .join('\n')}\n`
      : '';

  const focusInstruction = focusPrompt?.trim()
    ? `\nUser focus request: Prioritize moments matching "${focusPrompt.trim()}".\n`
    : '';

  const batchResults = await mapWithConcurrency(batches, 3, async (batch, batchIdx) => {
    const windowBlock = batch
      .map(
        (w) =>
          `--- WINDOW ${w.windowIndex + 1} (${w.startSeconds.toFixed(1)}s to ${w.endSeconds.toFixed(1)}s) ---\n${w.formattedTranscript}`
      )
      .join('\n\n');

    const prompt = `You are the SLYCE viral short-form highlight engine analyzing "${videoTitle}" (total duration: ${videoDuration.toFixed(1)} seconds, batch ${batchIdx + 1} of ${batches.length}).

Given the timestamped transcript windows below, ${countInstruction}.
${focusInstruction}${existingSummary}
Rules:
1. Prioritize high-retention short-form moments: start right on a bold claim, surprising question, or pattern-interrupt hook (trim slow throat-clearing intros), and end on a crisp payoff or insight. Fit between ${minClipLen} and ${maxClipLen} seconds.
2. Write "hook" as a punchy, scroll-stopping opening headline (5–9 words max) ideal for an on-screen Auto Hook banner.
3. All start_time and end_time values MUST fall within [0, ${videoDuration.toFixed(1)}] and align with the actual transcript timestamps provided.
4. transcript_excerpt MUST be exact words from the transcript—do NOT invent dialogue or facts.
5. Score each candidate honestly from 0 to 100 on the 5 rubric dimensions:
   - completeness (30% weight): self-contained idea with clear beginning and payoff
   - hook_strength (25% weight): scroll-stopping opening statement, tension, or question
   - useful_information (20% weight): actionable takeaway, clear explanation, or surprising fact
   - emotional_emphasis (15% weight): expressive delivery, story beat, or memorable conviction
   - duration_fit (10% weight): snappy pacing ideal for vertical Shorts/Reels
6. Return valid JSON only.

TRANSCRIPT WINDOWS:
${windowBlock}`;

    const parsed = await callWithModelFallback(async (model) => {
      const thinkingConfig = getLatencyThinkingConfig(model);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...(thinkingConfig ? { thinkingConfig } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              candidates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start_time: { type: Type.NUMBER },
                    end_time: { type: Type.NUMBER },
                    title: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    transcript_excerpt: { type: Type.STRING },
                    selection_reason: { type: Type.STRING },
                    completeness: { type: Type.NUMBER },
                    hook_strength: { type: Type.NUMBER },
                    useful_information: { type: Type.NUMBER },
                    emotional_emphasis: { type: Type.NUMBER },
                    duration_fit: { type: Type.NUMBER },
                    score_explanation: { type: Type.STRING },
                  },
                  required: [
                    'start_time',
                    'end_time',
                    'title',
                    'hook',
                    'summary',
                    'transcript_excerpt',
                    'selection_reason',
                    'completeness',
                    'hook_strength',
                    'useful_information',
                    'emotional_emphasis',
                    'duration_fit',
                    'score_explanation',
                  ],
                },
              },
            },
            required: ['candidates'],
          },
        },
      });
      return safeParseGeminiJson<{ candidates?: RawHighlightCandidate[] }>(response.text);
    }, modelOverride);

    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  });

  const allRawCandidates = batchResults.flat();

  return validateAndRankCandidates({
    jobId,
    rawCandidates: allRawCandidates,
    segments,
    videoDuration,
    minDuration: minClipLen,
    maxDuration: maxDuration ?? videoDuration,
    maxCandidates,
    existingClips,
    smartCut,
  });
}

/**
 * Analyzes a public YouTube URL directly via Gemini multimodal video understanding
 * when server-side yt-dlp binary download is blocked by bot verification.
 */
export async function analyzeYoutubeUrlWithGemini(options: {
  jobId: string;
  youtubeUrl: string;
  videoTitle: string;
  focusPrompt?: string;
  modelOverride?: string;
  spokenLanguage?: SpokenLanguageOption;
  minDuration?: number;
  maxDuration?: number;
  maxCandidates?: number;
  findViralMoments?: boolean;
  smartCut?: boolean;
}): Promise<{
  durationSeconds: number;
  segments: TranscriptSegment[];
  clips: ClipCandidate[];
}> {
  const {
    jobId,
    youtubeUrl,
    videoTitle,
    focusPrompt,
    modelOverride,
    spokenLanguage = 'auto',
    minDuration,
    maxDuration,
    maxCandidates = Number.POSITIVE_INFINITY,
    findViralMoments = true,
    smartCut = false,
  } = options;
  const ai = getGeminiClient();

  const focusNote = focusPrompt?.trim()
    ? `Pay special attention to moments matching: "${focusPrompt.trim()}".`
    : '';
  const langLabel =
    SPOKEN_LANGUAGE_OPTIONS.find((l) => l.value === spokenLanguage)?.label ?? 'Multi-language';
  const langNote =
    spokenLanguage && spokenLanguage !== 'auto'
      ? `Spoken language: ${langLabel}. Transcribe in ${langLabel}.`
      : '';
  const durNote =
    minDuration && maxDuration
      ? `Target each extracted clip duration between ${minDuration}s and ${maxDuration}s.`
      : '';
  const countNote = Number.isFinite(maxCandidates)
    ? `Return up to ${maxCandidates} strongest distinct clips.`
    : `Extract ALL strong, self-contained short-form highlight clips (no 5-clip limit; include every distinct, complete moment across the full video).`;

  const prompt = `Analyze this YouTube video ("${videoTitle}") thoroughly and fast.
${focusNote} ${langNote} ${durNote}
1. Estimate the accurate total duration_seconds of the video.
2. Produce a verbatim, timestamped transcript of the spoken dialogue as "segments" with start (seconds), end (seconds), text, and optional speaker. Never fabricate speech.
3. ${findViralMoments ? countNote + ' Start each clip right on a bold hook (no slow filler) with a punchy <= 9-word "hook" headline and clean payoff ending.' : 'Also return a single full-video summary candidate spanning the full video duration.'} Each candidate must have start_time, end_time, title, hook, summary, transcript_excerpt (exact words), selection_reason, and honest 0-100 rubric scores (completeness, hook_strength, useful_information, emotional_emphasis, duration_fit, score_explanation).`;

  const parsed = await callWithModelFallback(async (model) => {
    const thinkingConfig = getLatencyThinkingConfig(model);
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          fileData: {
            fileUri: youtubeUrl,
          },
        },
        { text: prompt },
      ],
      config: {
        ...(thinkingConfig ? { thinkingConfig } : {}),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            duration_seconds: { type: Type.NUMBER },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                  speaker: { type: Type.STRING },
                },
                required: ['start', 'end', 'text'],
              },
            },
            candidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start_time: { type: Type.NUMBER },
                  end_time: { type: Type.NUMBER },
                  title: { type: Type.STRING },
                  hook: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  transcript_excerpt: { type: Type.STRING },
                  selection_reason: { type: Type.STRING },
                  completeness: { type: Type.NUMBER },
                  hook_strength: { type: Type.NUMBER },
                  useful_information: { type: Type.NUMBER },
                  emotional_emphasis: { type: Type.NUMBER },
                  duration_fit: { type: Type.NUMBER },
                  score_explanation: { type: Type.STRING },
                },
                required: [
                  'start_time',
                  'end_time',
                  'title',
                  'hook',
                  'summary',
                  'transcript_excerpt',
                  'selection_reason',
                  'completeness',
                  'hook_strength',
                  'useful_information',
                  'emotional_emphasis',
                  'duration_fit',
                  'score_explanation',
                ],
              },
            },
          },
          required: ['duration_seconds', 'segments', 'candidates'],
        },
      },
    });
    return safeParseGeminiJson<{
      duration_seconds?: number;
      segments?: RawTranscriptSegment[];
      candidates?: RawHighlightCandidate[];
    }>(response.text);
  }, modelOverride);

  const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  const lastSegEnd = rawSegments.reduce((max, s) => Math.max(max, Number(s.end) || 0), 0);
  const lastCandEnd = (parsed.candidates ?? []).reduce(
    (max, c) => Math.max(max, Number(c.end_time) || 0),
    0
  );
  const durationSeconds = Math.max(
    10,
    Number(parsed.duration_seconds) || 0,
    lastSegEnd,
    lastCandEnd
  );

  const segments: TranscriptSegment[] = [];
  let idx = 1;
  for (const seg of rawSegments) {
    const cleanText = (seg.text ?? '').trim();
    if (!cleanText) continue;
    const start = Math.max(0, Math.min(durationSeconds, Number(seg.start) || 0));
    const end = Math.max(start + 0.3, Math.min(durationSeconds, Number(seg.end) || start + 2));
    segments.push({
      id: `seg-${idx++}`,
      job_id: jobId,
      start_seconds: Number(start.toFixed(2)),
      end_seconds: Number(end.toFixed(2)),
      text: cleanText,
      speaker_label: seg.speaker ? String(seg.speaker).trim() : null,
      confidence_note: null,
    });
  }

  if (!findViralMoments) {
    const firstClip = buildWholeVideoClip({
      jobId,
      title: videoTitle,
      segments,
      durationSeconds,
      smartCut,
    });
    return {
      durationSeconds: Number(durationSeconds.toFixed(2)),
      segments,
      clips: [firstClip],
    };
  }

  const clips = validateAndRankCandidates({
    jobId,
    rawCandidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    segments,
    videoDuration: durationSeconds,
    minDuration: minDuration ?? (durationSeconds < 45 ? 4 : 8),
    maxDuration: maxDuration ?? durationSeconds,
    maxCandidates,
    smartCut,
  });

  return {
    durationSeconds: Number(durationSeconds.toFixed(2)),
    segments,
    clips,
  };
}

export function buildWholeVideoClip(options: {
  jobId: string;
  title: string;
  segments: TranscriptSegment[];
  durationSeconds: number;
  smartCut?: boolean;
}): ClipCandidate {
  const { jobId, title, segments, durationSeconds, smartCut = false } = options;
  let start = 0;
  let end = Math.max(2, durationSeconds);

  if (smartCut && segments.length > 0) {
    const sorted = [...segments].sort((a, b) => a.start_seconds - b.start_seconds);
    start = Math.max(0, Number((sorted[0].start_seconds - 0.2).toFixed(2)));
    end = Math.min(
      durationSeconds,
      Math.max(start + 2, Number((sorted[sorted.length - 1].end_seconds + 0.2).toFixed(2)))
    );
  }

  let cues = buildCuesFromTranscript(segments, start, end);
  if (smartCut) {
    cues = cues
      .map((c) => ({ ...c, text: applySmartCutToCueText(c.text) }))
      .filter((c) => c.text.length > 0);
  }

  const excerpt = segments
    .filter((s) => s.end_seconds > start && s.start_seconds < end)
    .map((s) => s.text)
    .join(' ')
    .trim();

  return {
    id: `${jobId}-clip-${crypto.randomUUID().slice(0, 6)}`,
    job_id: jobId,
    start_seconds: Number(start.toFixed(2)),
    end_seconds: Number(end.toFixed(2)),
    title: `${title} (Full Edit)`,
    hook: excerpt ? excerpt.slice(0, 120) : title,
    summary: 'Full source video prepared with synchronized transcript captions and styling.',
    transcript_excerpt: excerpt || 'No spoken dialogue detected.',
    score: 100,
    score_breakdown: {
      completeness: 100,
      hook_strength: 90,
      useful_information: 95,
      emotional_emphasis: 85,
      duration_fit: 90,
      explanation: 'Full-video mode selected (viral moment cutting disabled).',
    },
    selection_reason: 'Whole video output mode',
    status: 'selected',
    subtitle_cues: cues,
    subtitle_settings: {
      style: 'classic_white',
      fontSize: 28,
      position: 'bottom',
      burnIn: true,
    },
    framing_mode: 'center_crop',
    aspect_ratio: '9:16',
    export_resolution: '1080x1920',
  };
}

export function validateAndRankCandidates(options: {
  jobId: string;
  rawCandidates: RawHighlightCandidate[];
  segments: TranscriptSegment[];
  videoDuration: number;
  minDuration?: number;
  maxDuration?: number;
  maxCandidates?: number;
  existingClips?: Array<{ start_seconds: number; end_seconds: number }>;
  smartCut?: boolean;
}): ClipCandidate[] {
  const {
    jobId,
    rawCandidates,
    segments,
    videoDuration,
    minDuration = 2,
    maxDuration = Number.MAX_SAFE_INTEGER,
    maxCandidates = Number.POSITIVE_INFINITY,
    existingClips = [],
    smartCut = false,
  } = options;

  const validated: ClipCandidate[] = [];

  for (let i = 0; i < rawCandidates.length; i++) {
    const raw = rawCandidates[i];
    let start = Math.max(0, Math.min(Math.max(0, videoDuration - minDuration), Number(raw.start_time) || 0));
    let end = Math.max(start + minDuration, Math.min(videoDuration, Number(raw.end_time) || start + minDuration));

    // Smart Cut: tighten silent dead-air margins to match actual spoken transcript segments
    if (smartCut && segments.length > 0) {
      const innerSegs = segments.filter((s) => s.end_seconds > start && s.start_seconds < end);
      if (innerSegs.length > 0) {
        const firstSpeech = Math.max(start, innerSegs[0].start_seconds - 0.15);
        const lastSpeech = Math.min(end, innerSegs[innerSegs.length - 1].end_seconds + 0.15);
        if (lastSpeech - firstSpeech >= Math.max(2, minDuration * 0.7)) {
          start = firstSpeech;
          end = lastSpeech;
        }
      }
    }

    const dur = end - start;

    if (dur < minDuration || dur > maxDuration) continue;

    const breakdown: ScoreBreakdown = {
      completeness: Math.round(Math.max(0, Math.min(100, Number(raw.completeness) || 70))),
      hook_strength: Math.round(Math.max(0, Math.min(100, Number(raw.hook_strength) || 70))),
      useful_information: Math.round(Math.max(0, Math.min(100, Number(raw.useful_information) || 70))),
      emotional_emphasis: Math.round(Math.max(0, Math.min(100, Number(raw.emotional_emphasis) || 65))),
      duration_fit: Math.round(Math.max(0, Math.min(100, Number(raw.duration_fit) || 75))),
      explanation: (raw.score_explanation || raw.selection_reason || 'Self-contained moment grounded in transcript.').trim(),
    };

    const score = computeExplainableScore(breakdown);
    let cues = buildCuesFromTranscript(segments, start, end);
    if (smartCut) {
      cues = cues
        .map((c) => ({ ...c, text: applySmartCutToCueText(c.text) }))
        .filter((c) => c.text.length > 0);
    }
    const excerptFromTranscript = segments
      .filter((s) => s.end_seconds > start && s.start_seconds < end)
      .map((s) => s.text)
      .join(' ')
      .trim();

    validated.push({
      id: `${jobId}-clip-${crypto.randomUUID().slice(0, 6)}`,
      job_id: jobId,
      start_seconds: Number(start.toFixed(2)),
      end_seconds: Number(end.toFixed(2)),
      title: (raw.title || `Highlight ${i + 1}`).trim(),
      hook: (raw.hook || '').trim(),
      summary: (raw.summary || '').trim(),
      transcript_excerpt: excerptFromTranscript || (raw.transcript_excerpt || '').trim(),
      score,
      score_breakdown: breakdown,
      selection_reason: (raw.selection_reason || 'Complete self-contained explanation').trim(),
      status: 'candidate',
      subtitle_cues: cues,
      subtitle_settings: {
        style: 'classic_white',
        fontSize: 28,
        position: 'bottom',
        burnIn: true,
      },
      framing_mode: 'center_crop',
      aspect_ratio: '9:16',
      export_resolution: '1080x1920',
    });
  }

  // Sort by score descending and deduplicate overlapping duplicates (> 55% overlap)
  validated.sort((a, b) => b.score - a.score);
  const kept: ClipCandidate[] = [];
  const allOccupied: Array<{ start_seconds: number; end_seconds: number }> = [...existingClips];

  for (const cand of validated) {
    const overlaps = allOccupied.some((existing) => {
      const interStart = Math.max(existing.start_seconds, cand.start_seconds);
      const interEnd = Math.min(existing.end_seconds, cand.end_seconds);
      const inter = Math.max(0, interEnd - interStart);
      const minLen = Math.min(
        existing.end_seconds - existing.start_seconds,
        cand.end_seconds - cand.start_seconds
      );
      return minLen > 0 && inter / minLen > 0.55;
    });
    if (!overlaps) {
      kept.push(cand);
      allOccupied.push(cand);
    }
    if (kept.length >= maxCandidates) break;
  }

  return kept;
}

/**
 * Builds a standard 44-byte RIFF/WAV header for 24kHz mono 16-bit LE raw PCM
 * in case an endpoint returns raw PCM instead of an already-wrapped WAV buffer.
 */
function ensureWavBuffer(rawBuffer: Buffer): Buffer {
  if (rawBuffer.length >= 4 && rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    return rawBuffer;
  }
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + rawBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(rawBuffer.length, 40);
  return Buffer.concat([header, rawBuffer]);
}

/**
 * Generates real spoken WAV narration via Gemini TTS for our team-owned sample videos
 * when GEMINI_API_KEY is available.
 */
export async function synthesizeSampleNarration(
  scriptText: string,
  voiceName: 'Kore' | 'Puck',
  outWavPath: string
): Promise<boolean> {
  if (!isGeminiConfigured()) return false;
  try {
    const ai = getGeminiClient();
    const ttsModel = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
    const response = await ai.models.generateContent({
      model: ttsModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: scriptText,
              speechMetadata: {
                style: 'Clear, natural, articulate educator speaking for a studio video',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((p) => p.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;
    if (!base64Audio) return false;
    const wavBuffer = ensureWavBuffer(Buffer.from(base64Audio, 'base64'));
    fs.writeFileSync(outWavPath, wavBuffer);
    return true;
  } catch (err) {
    console.warn('[gemini-tts] Failed to synthesize sample narration:', formatGeminiError(err).message);
    return false;
  }
}
