import fs from 'fs';
import path from 'path';
import {
  DEFAULT_RECIPE_CONFIG,
  getAspectRatioForResolution,
  resolveClipDefaultsFromRecipe,
  resolveDurationWindow,
  type ClipCandidate,
  type ExportRecord,
  type TranscriptSegment,
  type VideoJob,
  type VideoMetadata,
} from '../../src/types/clipforge.ts';
import {
  analyzeYoutubeUrlWithGemini,
  buildWholeVideoClip,
  detectHighlightsFromTranscript,
  isAuthOrConfigError,
  isGeminiConfigured,
  transcribeAudioChunk,
} from '../ai/geminiService.ts';
import {
  detectSceneChanges,
  extractAudioChunkDirectMp3,
  generateThumbnail,
  inspectVideo,
  renderVerticalClip,
} from '../media/ffmpegService.ts';
import { downloadVideoFromLink } from '../media/youtubeService.ts';
import { buildDemoDataForSample } from '../samples/sampleData.ts';
import {
  EXPORTS_DIR,
  PROCESSED_DIR,
  UPLOADS_DIR,
  loadDb,
  safeUnlink,
  saveDb,
} from '../utils/storage.ts';

// Single-instance in-process background queues (replace with Redis/BullMQ in multi-worker production)
const activeAnalysisJobs = new Set<string>();
const renderQueue: Array<{ clipId: string; exportId: string }> = [];
const MAX_CONCURRENT_RENDERS = 2;
let activeRenderCount = 0;

export function getActiveJobCount(): number {
  return activeAnalysisJobs.size + activeRenderCount + renderQueue.length;
}

function updateJob(
  jobId: string,
  patch: Partial<{
    title: string;
    original_filename: string;
    status:
      | 'uploaded'
      | 'inspecting'
      | 'extracting_audio'
      | 'transcribing'
      | 'chunking'
      | 'detecting_highlights'
      | 'ready'
      | 'failed';
    current_stage: number;
    stage_message: string;
    progress: number;
    duration: number;
    resolution: string;
    metadata: VideoMetadata;
    error_message: string | null;
    thumbnail_url: string;
    source_video_url: string;
    youtube_download_blocked: boolean;
    processing_time_ms: number;
    ai_warning: string | null;
  }>
): void {
  const db = loadDb();
  const job = db.jobs[jobId];
  if (!job) return;
  Object.assign(job, patch, { updated_at: new Date().toISOString() });
  saveDb();
}

export function buildVisualTimelineClips(options: {
  jobId: string;
  videoTitle: string;
  durationSeconds: number;
  sceneTimestamps: number[];
  segments?: TranscriptSegment[];
  minDuration: number;
  maxDuration: number;
  maxCandidates: number;
  smartCut?: boolean;
  reasonLabel: string;
}): ClipCandidate[] {
  const {
    jobId,
    videoTitle,
    durationSeconds,
    sceneTimestamps,
    segments = [],
    minDuration,
    maxDuration,
    maxCandidates,
    smartCut = false,
    reasonLabel,
  } = options;

  const safeDur = Math.max(2, durationSeconds);
  const effMin = Math.min(safeDur, Math.max(4, minDuration));
  const effMax = Math.max(effMin, Math.min(safeDur, maxDuration));
  const desiredSegLen = Math.max(effMin, Math.min(effMax, safeDur <= 40 ? safeDur : Math.min(25, Math.round(safeDur / 3))));

  const ranges: Array<{ start: number; end: number }> = [];
  if (safeDur <= desiredSegLen * 1.35) {
    ranges.push({ start: 0, end: Number(safeDur.toFixed(2)) });
    if (safeDur >= 16) {
      const mid = Number((safeDur * 0.5).toFixed(2));
      ranges.push({ start: 0, end: mid });
      ranges.push({ start: mid, end: Number(safeDur.toFixed(2)) });
    }
  } else {
    const boundaries = [0, ...sceneTimestamps.filter((t) => t > 2 && t < safeDur - 2), safeDur];
    let curStart = 0;
    for (let i = 1; i < boundaries.length; i++) {
      const b = boundaries[i];
      const len = b - curStart;
      if (len >= effMin && (len >= desiredSegLen * 0.7 || b === safeDur)) {
        const clampedEnd = Math.min(safeDur, curStart + effMax);
        ranges.push({ start: Number(curStart.toFixed(2)), end: Number(clampedEnd.toFixed(2)) });
        curStart = clampedEnd;
      }
    }
    // If scene cuts left gaps or too few segments, generate evenly paced clips across the full duration
    if (ranges.length === 0) {
      let cursor = 0;
      while (cursor + 3 < safeDur) {
        const end = Math.min(safeDur, cursor + desiredSegLen);
        if (end - cursor < 4 && ranges.length > 0) {
          ranges[ranges.length - 1].end = Number(safeDur.toFixed(2));
          break;
        }
        ranges.push({ start: Number(cursor.toFixed(2)), end: Number(end.toFixed(2)) });
        cursor = end;
      }
    }
  }

  const limited = Number.isFinite(maxCandidates) ? ranges.slice(0, maxCandidates) : ranges;
  return limited.map((r, idx) => {
    const matchingSegs = segments.filter((s) => s.end_seconds > r.start && s.start_seconds < r.end);
    const cues = matchingSegs.map((s, cIdx) => ({
      id: `cue-${idx}-${cIdx + 1}`,
      start_seconds: Number(Math.max(0, s.start_seconds - r.start).toFixed(2)),
      end_seconds: Number(Math.max(0.4, Math.min(r.end - r.start, s.end_seconds - r.start)).toFixed(2)),
      text: s.text,
    }));
    const excerpt = matchingSegs.map((s) => s.text).join(' ').trim();

    return {
      id: `${jobId}-clip-${idx + 1}`,
      job_id: jobId,
      start_seconds: r.start,
      end_seconds: r.end,
      title: limited.length === 1 ? videoTitle : `${videoTitle} · Part ${idx + 1}`,
      hook: excerpt ? excerpt.slice(0, 72) : `${videoTitle} · Cut ${idx + 1}`,
      summary: excerpt || reasonLabel,
      transcript_excerpt: excerpt || 'Visual / scene-cut clip segment (no spoken dialogue).',
      score: Math.max(70, 92 - idx * 3),
      score_breakdown: {
        completeness: 82,
        hook_strength: 80,
        useful_information: 78,
        emotional_emphasis: 85,
        duration_fit: 90,
        explanation: reasonLabel,
      },
      selection_reason: reasonLabel,
      status: 'candidate',
      subtitle_cues: cues,
      subtitle_settings: {
        style: 'word_cut',
        fontSize: 28,
        position: 'bottom',
        burnIn: cues.length > 0,
      },
      framing_mode: 'center_crop',
      export_resolution: '1080x1920',
      ...(smartCut ? {} : {}),
    };
  });
}

export function enqueueAnalysisJob(jobId: string, sampleId?: string, focusPrompt?: string): void {
  if (activeAnalysisJobs.has(jobId)) return;
  activeAnalysisJobs.add(jobId);

  // Run asynchronously so HTTP request returns immediately without blocking
  setImmediate(() => {
    runAnalysisPipeline(jobId, sampleId, focusPrompt)
      .catch((err) => {
        console.error(`[jobProcessor] Job ${jobId} failed:`, err);
      })
      .finally(() => {
        activeAnalysisJobs.delete(jobId);
      });
  });
}

async function runAnalysisPipeline(
  jobId: string,
  sampleId?: string,
  focusPrompt?: string
): Promise<void> {
  const startedAt = Date.now();
  const db = loadDb();
  const job = db.jobs[jobId];
  const files = db.jobFiles[jobId] ?? { videoPath: '' };
  if (!job) return;

  const jobDir = path.join(PROCESSED_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  const cfg = { ...DEFAULT_RECIPE_CONFIG, ...(job.recipe_config ?? {}) };
  const modelOverride = cfg.geminiModel !== 'default' ? cfg.geminiModel : undefined;
  const maxCandidates =
    cfg.clipsPerVideoMode === 'set'
      ? Math.max(1, Number(cfg.clipsPerVideoCount) || 5)
      : Number.POSITIVE_INFINITY;

  try {
    // Stage 1b: If this is a YouTube or Instagram link job and local MP4 isn't downloaded yet, download MP4 first
    if (
      (job.source_type === 'youtube' || job.source_type === 'instagram') &&
      (!files.videoPath || !fs.existsSync(files.videoPath))
    ) {
      const linkUrl = job.external_url || job.youtube_url || '';
      const targetMp4 = path.join(UPLOADS_DIR, `${jobId}-${job.source_type}.mp4`);
      const platformLabel = job.source_type === 'instagram' ? 'Instagram' : 'YouTube';
      updateJob(jobId, {
        status: 'inspecting',
        current_stage: 1,
        stage_message: `Connecting to ${platformLabel} and downloading source MP4...`,
        progress: 10,
        error_message: null,
      });

      const dlResult = await downloadVideoFromLink({
        url: linkUrl,
        outputMp4Path: targetMp4,
        onProgress: (msg, pct) => {
          updateJob(jobId, {
            stage_message: msg,
            ...(pct !== undefined ? { progress: pct } : {}),
          });
        },
      });

      if (dlResult.success && dlResult.videoPath) {
        files.videoPath = dlResult.videoPath;
        db.jobFiles[jobId] = files;
        saveDb();
        updateJob(jobId, {
          title:
            job.title === 'YouTube Video' ||
            job.title === 'Instagram Reel' ||
            job.title === job.youtube_video_id
              ? dlResult.title || job.title
              : job.title,
          original_filename: `${job.youtube_video_id || jobId}.mp4`,
          youtube_download_blocked: false,
          source_video_url: `/api/jobs/${jobId}/media`,
          ...(dlResult.thumbnailUrl ? { thumbnail_url: dlResult.thumbnailUrl } : {}),
        });
      } else if (dlResult.blockedByBotCheck && job.source_type === 'youtube') {
        if (!isGeminiConfigured()) {
          throw new Error(
            'YouTube requested bot verification on this server IP, and GEMINI_API_KEY is not configured. Configure GEMINI_API_KEY in Secrets, or add optional YouTube cookies in Settings / YouTube Import, or upload the video file directly.'
          );
        }

        const resolvedTitle = dlResult.title || job.title;
        updateJob(jobId, {
          title: resolvedTitle,
          youtube_download_blocked: true,
          ...(dlResult.thumbnailUrl ? { thumbnail_url: dlResult.thumbnailUrl } : {}),
          status: 'transcribing',
          current_stage: 4,
          stage_message:
            'YouTube blocked direct MP4 download on this cloud IP — analyzing YouTube link directly with Gemini AI...',
          progress: 48,
        });

        const ytDurationWindow = resolveDurationWindow(
          cfg.targetDuration,
          cfg.customMinDuration,
          cfg.customMaxDuration,
          3600
        );
        const ytAiResult = await analyzeYoutubeUrlWithGemini({
          jobId,
          youtubeUrl: job.youtube_url || '',
          videoTitle: resolvedTitle,
          focusPrompt,
          modelOverride,
          spokenLanguage: cfg.spokenLanguage,
          minDuration: cfg.targetDuration === 'auto' ? undefined : ytDurationWindow.min,
          maxDuration: cfg.targetDuration === 'auto' ? undefined : ytDurationWindow.max,
          maxCandidates,
          findViralMoments: cfg.findViralMoments,
          smartCut: cfg.smartCut,
        });

        if (ytAiResult.segments.length === 0 && ytAiResult.clips.length === 0) {
          throw new Error(
            'Unable to extract spoken transcript from this YouTube video. Try adding YouTube cookies in Settings or uploading the video file directly.'
          );
        }

        const freshDb = loadDb();
        freshDb.transcripts[jobId] = ytAiResult.segments;
        for (const clip of ytAiResult.clips) {
          const defaults = resolveClipDefaultsFromRecipe(
            cfg,
            clip.hook || clip.title
          );
          clip.framing_mode = defaults.framingMode;
          clip.aspect_ratio = defaults.aspectRatio;
          clip.export_resolution = defaults.exportResolution;
          clip.subtitle_settings = defaults.subtitleSettings;
          clip.effects = defaults.effects;
          freshDb.clips[clip.id] = clip;
        }
        saveDb();

        updateJob(jobId, {
          duration: ytAiResult.durationSeconds,
          resolution: 'YouTube Embed',
          status: 'ready',
          current_stage: 6,
          youtube_download_blocked: true,
          stage_message: `Analyzed via Gemini (${ytAiResult.clips.length} clips extracted). Add YouTube cookies or attach MP4 to render ${cfg.aspectRatio} MP4 exports, or export SRT & create unlimited clips now.`,
          progress: 100,
          processing_time_ms: Date.now() - startedAt,
        });
        return;
      } else {
        throw new Error(dlResult.errorReason || 'Failed to download YouTube video.');
      }
    }

    // Stage 2: Parallel video inspection (FFprobe) & thumbnail generation
    updateJob(jobId, {
      status: 'inspecting',
      current_stage: 2,
      stage_message: 'Inspecting video metadata & capturing studio thumbnail...',
      progress: 18,
      error_message: null,
    });

    const thumbPath = path.join(jobDir, 'thumbnail.jpg');
    const [metadata, thumbOk] = await Promise.all([
      inspectVideo(files.videoPath),
      generateThumbnail(files.videoPath, thumbPath, 1.5)
        .then(() => true)
        .catch(() => false),
    ]);

    if (thumbOk) {
      files.thumbnailPath = thumbPath;
      db.jobFiles[jobId] = files;
      saveDb();
    }
    updateJob(jobId, {
      duration: metadata.duration,
      resolution: `${metadata.width}x${metadata.height}`,
      metadata,
      ...(thumbOk ? { thumbnail_url: `/api/jobs/${jobId}/thumbnail` } : {}),
    });

    // Check if running explicitly in DEMO MODE (no API key or user selected demo transcript mode)
    if (job.is_demo_mode && sampleId) {
      updateJob(jobId, {
        status: 'transcribing',
        current_stage: 4,
        stage_message: 'DEMO MODE: Loading preloaded timestamped sample transcript...',
        progress: 55,
      });

      const demo = await buildDemoDataForSample(jobId, sampleId, metadata.duration);
      const freshDb = loadDb();
      freshDb.transcripts[jobId] = demo.segments;
      const demoClips = Number.isFinite(maxCandidates) ? demo.clips.slice(0, maxCandidates) : demo.clips;
      for (const clip of demoClips) {
        if (job.recipe_config) {
          const defaults = resolveClipDefaultsFromRecipe(
            cfg,
            clip.hook || clip.title
          );
          clip.framing_mode = defaults.framingMode;
          clip.aspect_ratio = defaults.aspectRatio;
          clip.export_resolution = defaults.exportResolution;
          clip.subtitle_settings = defaults.subtitleSettings;
          clip.effects = defaults.effects;
        }
        freshDb.clips[clip.id] = clip;
      }
      saveDb();

      updateJob(jobId, {
        status: 'ready',
        current_stage: 6,
        stage_message: `DEMO MODE ready: ${demoClips.length} highlight candidates prepared for review and real FFmpeg export.`,
        progress: 100,
        processing_time_ms: Date.now() - startedAt,
      });
      return;
    }

    // Non-audio videos (AMVs without audio, B-roll, muted screen recordings) -> FFmpeg scene-cut mode
    if (!metadata.hasAudio) {
      updateJob(jobId, {
        status: 'detecting_highlights',
        current_stage: 5,
        stage_message: 'No audio track detected — scanning visual scene cuts for fast clipping...',
        progress: 75,
      });

      const durWin = resolveDurationWindow(
        cfg.targetDuration,
        cfg.customMinDuration,
        cfg.customMaxDuration,
        metadata.duration
      );
      const scenes = await detectSceneChanges(files.videoPath, metadata.duration);
      const sceneClips = buildVisualTimelineClips({
        jobId,
        videoTitle: job.title,
        durationSeconds: metadata.duration,
        sceneTimestamps: scenes,
        minDuration: cfg.targetDuration === 'auto' ? Math.min(10, metadata.duration) : durWin.min,
        maxDuration: cfg.targetDuration === 'auto' ? Math.max(18, Math.min(45, metadata.duration)) : durWin.max,
        maxCandidates,
        smartCut: cfg.smartCut,
        reasonLabel: 'Visual scene-cut boundary detected via FFmpeg',
      });

      const noAudioDb = loadDb();
      for (const clip of sceneClips) {
        const defaults = resolveClipDefaultsFromRecipe(cfg, clip.title);
        clip.framing_mode = defaults.framingMode;
        clip.aspect_ratio = defaults.aspectRatio;
        clip.export_resolution = defaults.exportResolution;
        clip.subtitle_settings = { ...defaults.subtitleSettings, burnIn: false };
        clip.effects = { ...defaults.effects, autoHookEnabled: false };
        noAudioDb.clips[clip.id] = clip;
      }
      saveDb();

      let autoQueued = 0;
      if (cfg.autoRenderTopClips) {
        for (const c of sceneClips.slice(0, 5)) {
          try {
            enqueueClipRender(c.id);
            autoQueued += 1;
          } catch {
            // ignore
          }
        }
      }

      const elapsedMs = Date.now() - startedAt;
      updateJob(jobId, {
        status: 'ready',
        current_stage: 6,
        ai_warning:
          'This video has no audio track, so SLYCE automatically detected visual scene cuts. You can adjust timestamps, add custom cuts, apply motion FX, or export MP4s immediately.',
        stage_message:
          autoQueued > 0
            ? `Scene cuts ready (${sceneClips.length} clip(s)) · Auto-rendering top ${autoQueued} MP4(s)...`
            : `Scene cuts ready: ${sceneClips.length} visual clip(s) prepared (${cfg.aspectRatio}).`,
        progress: 100,
        processing_time_ms: elapsedMs,
      });
      return;
    }

    if (!isGeminiConfigured()) {
      throw new Error(
        'GEMINI_API_KEY is not configured in the server environment. Configure GEMINI_API_KEY in Secrets, or use a Sample Video in Demo Mode, or click "Clip Manually (Skip AI)".'
      );
    }

    // Stage 3 & 4: Direct compressed audio slicing + concurrent Gemini transcription
    // (Skips slow full-file WAV dump and processes up to 4 chunks in parallel for 10x speed)
    updateJob(jobId, {
      status: 'extracting_audio',
      current_stage: 3,
      stage_message: 'Extracting fast 24 kbps MP3 audio segments in parallel...',
      progress: 32,
      ai_warning: null,
    });

    const totalDuration = metadata.duration;
    const chunkLengthSeconds = 240; // 4-min chunks (~720KB each) stay fast and well below JSON output truncation limits
    const chunkPlans: Array<{ index: number; offset: number; len: number }> = [];
    for (let offset = 0, idx = 0; offset < totalDuration; offset += chunkLengthSeconds, idx++) {
      const len = Math.min(chunkLengthSeconds, totalDuration - offset);
      if (len >= 0.5) {
        chunkPlans.push({ index: idx, offset, len });
      }
    }

    updateJob(jobId, {
      status: 'transcribing',
      current_stage: 4,
      stage_message: `Transcribing ${chunkPlans.length} audio segment(s) concurrently with Gemini AI...`,
      progress: 45,
    });

    let completedChunks = 0;
    const chunkSegmentBuckets: TranscriptSegment[][] = new Array(chunkPlans.length);
    const CONCURRENCY = 4;
    let nextChunkCursor = 0;
    let aiFailureReason: string | null = null;
    let aiAuthFailed = false;

    async function runChunkWorker(): Promise<void> {
      while (nextChunkCursor < chunkPlans.length) {
        const plan = chunkPlans[nextChunkCursor++];
        const chunkMp3 = path.join(jobDir, `chunk_${plan.index}.mp3`);
        try {
          await extractAudioChunkDirectMp3(files.videoPath, plan.offset, plan.len, chunkMp3);
          const segs = await transcribeAudioChunk({
            audioFilePath: chunkMp3,
            mimeType: 'audio/mp3',
            chunkOffsetSeconds: plan.offset,
            chunkDurationSeconds: plan.len,
            jobId,
            segmentIndexOffset: plan.index * 1000 + 1,
            modelOverride,
            spokenLanguage: cfg.spokenLanguage,
            turboMode: cfg.turboMode,
            captionMode: cfg.captionMode ?? 'auto',
          });
          chunkSegmentBuckets[plan.index] = segs;
        } catch (chunkErr) {
          if (isAuthOrConfigError(chunkErr)) {
            aiAuthFailed = true;
            throw chunkErr;
          }
          // Record the upstream Gemini error message so if all chunks fail we switch cleanly to FFmpeg scene-cut mode
          aiFailureReason = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
          chunkSegmentBuckets[plan.index] = [];
        } finally {
          safeUnlink(chunkMp3);
        }

        completedChunks += 1;
        updateJob(jobId, {
          stage_message: `Transcribed ${completedChunks}/${chunkPlans.length} audio segments (${Math.round((completedChunks / chunkPlans.length) * 100)}%)...`,
          progress: Math.min(72, 45 + Math.round((completedChunks / chunkPlans.length) * 27)),
        });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, chunkPlans.length) }, () => runChunkWorker())
    );

    if (aiAuthFailed) {
      throw new Error(aiFailureReason || 'Gemini API key authentication failed.');
    }

    const allSegments: TranscriptSegment[] = chunkSegmentBuckets
      .flat()
      .filter(Boolean)
      .sort((a, b) => a.start_seconds - b.start_seconds)
      .map((seg, i) => ({ ...seg, id: `seg-${i + 1}` }));

    const dbAfterTranscript = loadDb();
    dbAfterTranscript.transcripts[jobId] = allSegments;
    saveDb();

    const durationWindow = resolveDurationWindow(
      cfg.targetDuration,
      cfg.customMinDuration,
      cfg.customMaxDuration,
      totalDuration
    );

    // If video has music/AMV/gameplay with 0 speech OR Gemini upstream experienced temporary high demand/quota:
    // automatically produce real FFmpeg scene-cut clips instead of stranding the user on a Failed Stage 4 screen!
    if (allSegments.length === 0) {
      updateJob(jobId, {
        status: 'detecting_highlights',
        current_stage: 5,
        stage_message: aiFailureReason
          ? 'Gemini AI is busy — detecting visual scene cuts locally via FFmpeg so your clips are ready...'
          : 'Non-speech / music edit detected — detecting visual scene cuts for highlight clips...',
        progress: 82,
      });

      const scenes = await detectSceneChanges(files.videoPath, totalDuration);
      const fallbackClips = buildVisualTimelineClips({
        jobId,
        videoTitle: job.title,
        durationSeconds: totalDuration,
        sceneTimestamps: scenes,
        minDuration: cfg.targetDuration === 'auto' ? Math.min(10, totalDuration) : durationWindow.min,
        maxDuration: cfg.targetDuration === 'auto' ? Math.max(18, Math.min(45, totalDuration)) : durationWindow.max,
        maxCandidates,
        smartCut: cfg.smartCut,
        reasonLabel: aiFailureReason
          ? 'FFmpeg scene-cut segment (prepared while Gemini AI was overloaded)'
          : 'FFmpeg scene-cut segment (instrumental / AMV / non-speech video)',
      });

      const fallbackDb = loadDb();
      for (const clip of fallbackClips) {
        const defaults = resolveClipDefaultsFromRecipe(cfg, clip.title);
        clip.framing_mode = defaults.framingMode;
        clip.aspect_ratio = defaults.aspectRatio;
        clip.export_resolution = defaults.exportResolution;
        clip.subtitle_settings = { ...defaults.subtitleSettings, burnIn: false };
        clip.effects = { ...defaults.effects, autoHookEnabled: false };
        fallbackDb.clips[clip.id] = clip;
      }
      saveDb();

      let autoQueuedCount = 0;
      if (cfg.autoRenderTopClips) {
        for (const c of fallbackClips.slice(0, 5)) {
          try {
            enqueueClipRender(c.id);
            autoQueuedCount += 1;
          } catch {
            // ignore
          }
        }
      }

      const noticeMsg = aiFailureReason
        ? `${aiFailureReason}`
        : 'No spoken dialogue detected (ideal for AMVs, music edits, gaming, or B-roll). SLYCE generated scene-paced clips ready for motion FX, transitions, and MP4 export.';

      const elapsedMs = Date.now() - startedAt;
      updateJob(jobId, {
        status: 'ready',
        current_stage: 6,
        ai_warning: noticeMsg,
        stage_message:
          autoQueuedCount > 0
            ? `Scene-cut fallback ready (${fallbackClips.length} clip(s)) · Auto-rendering top ${autoQueuedCount} MP4(s)...`
            : `Scene-cut clips ready: ${fallbackClips.length} clip(s) prepared (${cfg.aspectRatio}).`,
        progress: 100,
        processing_time_ms: elapsedMs,
      });
      return;
    }

    // Stage 5: Transcript chunking & Gemini highlight extraction (or whole-video clip when disabled)
    updateJob(jobId, {
      status: 'detecting_highlights',
      current_stage: 5,
      stage_message: cfg.findViralMoments
        ? 'Chunking transcript windows and identifying highlight moments across the full video...'
        : 'Preparing full video clip with synchronized captions and styling...',
      progress: 78,
    });

    let candidates: ClipCandidate[] = [];
    let stage5Warning: string | null = null;

    if (cfg.findViralMoments) {
      try {
        candidates = await detectHighlightsFromTranscript({
          jobId,
          segments: allSegments,
          videoDuration: totalDuration,
          videoTitle: job.title,
          focusPrompt,
          modelOverride,
          minDuration: durationWindow.min,
          maxDuration: durationWindow.max,
          maxCandidates,
          smartCut: cfg.smartCut,
        });
      } catch (stage5Err) {
        if (isAuthOrConfigError(stage5Err)) {
          throw stage5Err;
        }
        stage5Warning = stage5Err instanceof Error ? stage5Err.message : String(stage5Err);
      }
    } else {
      candidates = [
        buildWholeVideoClip({
          jobId,
          title: job.title,
          segments: allSegments,
          durationSeconds: totalDuration,
          smartCut: cfg.smartCut,
        }),
      ];
    }

    // If Stage 5 failed on demand/quota OR returned 0 clips for a strict duration preset,
    // preserve the real transcript & generate timed transcript-backed clips cleanly instead of crashing!
    if (candidates.length === 0) {
      const scenes = await detectSceneChanges(files.videoPath, totalDuration).catch(() => []);
      candidates = buildVisualTimelineClips({
        jobId,
        videoTitle: job.title,
        durationSeconds: totalDuration,
        sceneTimestamps: scenes,
        segments: allSegments,
        minDuration: Math.min(totalDuration, durationWindow.min),
        maxDuration: Math.min(totalDuration, Math.max(durationWindow.max, 30)),
        maxCandidates,
        smartCut: cfg.smartCut,
        reasonLabel: stage5Warning
          ? 'Real spoken transcript segment (Gemini highlight scoring temporarily busy)'
          : 'Spoken transcript segment aligned to video duration',
      });
      if (!stage5Warning) {
        stage5Warning =
          'No segments matched the strict target duration filter — prepared balanced transcript clips across the full video.';
      }
    }

    // Stage 6: Clips prepared & subtitle cues aligned
    const isLyricsJob =
      cfg.captionMode === 'lyrics' ||
      (allSegments.length > 0 && allSegments.every((s) => s.speaker_label === 'Lyrics'));
    const dbFinal = loadDb();
    for (const clip of candidates) {
      const defaults = resolveClipDefaultsFromRecipe(
        cfg,
        clip.hook || clip.title
      );
      clip.framing_mode = defaults.framingMode;
      clip.aspect_ratio = defaults.aspectRatio;
      clip.export_resolution = defaults.exportResolution;
      clip.subtitle_settings = {
        ...defaults.subtitleSettings,
        ...(isLyricsJob && defaults.subtitleSettings.style === 'word_cut'
          ? { style: 'karaoke' as const, animation: 'typewriter' as const, uppercase: true }
          : {}),
      };
      clip.effects = defaults.effects;
      dbFinal.clips[clip.id] = clip;
    }
    saveDb();

    const elapsedMs = Date.now() - startedAt;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    let autoQueuedCount = 0;

    if (cfg.autoRenderTopClips && files.videoPath && fs.existsSync(files.videoPath)) {
      const topToRender = candidates.slice(0, 5);
      for (const c of topToRender) {
        try {
          enqueueClipRender(c.id);
          autoQueuedCount += 1;
        } catch {
          // ignore individual render enqueue errors
        }
      }
    }

    updateJob(jobId, {
      status: 'ready',
      current_stage: 6,
      ai_warning: stage5Warning,
      stage_message:
        autoQueuedCount > 0
          ? `Analyzed in ${elapsedSec}s: ${candidates.length} viral clip(s) prepared (${cfg.aspectRatio}) · Auto-rendering top ${autoQueuedCount} MP4(s)...`
          : `Analysis complete in ${elapsedSec}s: ${candidates.length} candidate clip(s) prepared (${cfg.aspectRatio}).`,
      progress: 100,
      processing_time_ms: elapsedMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected processing error.';
    updateJob(jobId, {
      status: 'failed',
      stage_message: `Failed at stage ${loadDb().jobs[jobId]?.current_stage ?? 1}`,
      error_message: message,
    });
  }
}

export function enableManualMode(jobId: string): VideoJob {
  const db = loadDb();
  const job = db.jobs[jobId];
  if (!job) {
    throw new Error('Project job not found.');
  }
  const files = db.jobFiles[jobId];
  const hasLocalVideo = Boolean(files?.videoPath && fs.existsSync(files.videoPath));
  const hasYoutubeEmbed = Boolean(job.youtube_video_id);
  if (!hasLocalVideo && !hasYoutubeEmbed && !job.source_video_url) {
    throw new Error('No video source found for manual clipping.');
  }

  job.error_message = null;
  job.status = 'ready';
  job.current_stage = 6;
  job.progress = 100;
  job.stage_message =
    'Manual clipping mode active — create unlimited custom clips and render 9:16 exports.';
  job.updated_at = new Date().toISOString();
  saveDb();
  return job;
}

export function enqueueClipRender(clipId: string): ExportRecord {
  const db = loadDb();
  const clip = db.clips[clipId];
  if (!clip) throw new Error('Clip candidate not found.');
  const job = db.jobs[clip.job_id];
  if (!job) throw new Error('Parent video job not found.');
  const files = db.jobFiles[job.id];
  if (!files || !files.videoPath || !fs.existsSync(files.videoPath)) {
    throw new Error(
      job.youtube_download_blocked
        ? `${job.source_type === 'instagram' ? 'Instagram' : 'YouTube'} blocked direct MP4 download on this server IP. Download the SRT subtitles directly, or attach the source MP4 / add cookies to render exports.`
        : 'Source video file is missing on disk. Cannot render MP4.'
    );
  }

  // Clean previous export for this clip if re-rendering after confirmation
  for (const [expId, existing] of Object.entries(db.exports)) {
    if (existing.clip_id === clipId) {
      safeUnlink(existing.file_path);
      safeUnlink(existing.subtitle_file_path);
      delete db.exports[expId];
    }
  }

  const exportId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const safeSlug = clip.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'clipforge-short';

  const mp4Filename = `${safeSlug}-${exportId.slice(-5)}.mp4`;
  const srtFilename = `${safeSlug}-${exportId.slice(-5)}.srt`;

  const aspectRatio = clip.aspect_ratio ?? getAspectRatioForResolution(clip.export_resolution);
  const speed = Math.max(0.5, Math.min(2.0, Number(clip.effects?.playbackSpeed) || 1));

  const record: ExportRecord = {
    id: exportId,
    clip_id: clipId,
    job_id: job.id,
    clip_title: clip.title,
    filename: mp4Filename,
    file_path: path.join(EXPORTS_DIR, mp4Filename),
    srt_filename: srtFilename,
    subtitle_file_path: path.join(EXPORTS_DIR, srtFilename),
    resolution: clip.export_resolution,
    aspect_ratio: aspectRatio,
    duration: Number(((clip.end_seconds - clip.start_seconds) / speed).toFixed(2)),
    file_size_bytes: 0,
    srt_size_bytes: 0,
    has_burned_subtitles: clip.subtitle_settings.burnIn,
    framing_mode: clip.framing_mode,
    subtitle_style: clip.subtitle_settings.style,
    render_status: 'queued',
    error_message: null,
    created_at: new Date().toISOString(),
  };

  clip.status = 'rendering';
  db.exports[exportId] = record;
  saveDb();

  renderQueue.push({ clipId, exportId });
  processRenderQueue();

  return record;
}

function processRenderQueue(): void {
  while (activeRenderCount < MAX_CONCURRENT_RENDERS && renderQueue.length > 0) {
    const next = renderQueue.shift();
    if (!next) break;

    activeRenderCount += 1;
    runSingleRender(next.clipId, next.exportId)
      .catch((err) => {
        console.error(`[renderQueue] Render failed for ${next.exportId}:`, err);
      })
      .finally(() => {
        activeRenderCount = Math.max(0, activeRenderCount - 1);
        processRenderQueue();
      });
  }
}

async function runSingleRender(clipId: string, exportId: string): Promise<void> {
  const db = loadDb();
  const clip = db.clips[clipId];
  const exp = db.exports[exportId];
  const job = clip ? db.jobs[clip.job_id] : undefined;
  const files = clip ? db.jobFiles[clip.job_id] : undefined;

  if (!clip || !exp || !job || !files) return;

  try {
    const aspect = clip.aspect_ratio ?? getAspectRatioForResolution(clip.export_resolution);
    exp.render_status = 'rendering';
    job.current_stage = 7;
    job.stage_message = `Generating subtitles and rendering ${aspect} clip "${clip.title}"...`;
    saveDb();

    const tempAssPath = path.join(EXPORTS_DIR, `${exportId}.ass`);
    const hasAudio = job.metadata?.hasAudio ?? true;

    const result = await renderVerticalClip({
      sourceVideoPath: files.videoPath,
      hasAudio,
      startSeconds: clip.start_seconds,
      endSeconds: clip.end_seconds,
      framingMode: clip.framing_mode,
      resolution: clip.export_resolution,
      subtitleCues: clip.subtitle_cues,
      subtitleSettings: clip.subtitle_settings,
      effects: clip.effects,
      outMp4Path: exp.file_path,
      outSrtPath: exp.subtitle_file_path,
      tempAssPath,
    });

    const freshDb = loadDb();
    const freshExp = freshDb.exports[exportId];
    const freshClip = freshDb.clips[clipId];
    const freshJob = freshDb.jobs[job.id];

    if (freshExp && freshClip) {
      freshExp.render_status = 'completed';
      freshExp.file_size_bytes = result.mp4SizeBytes;
      freshExp.srt_size_bytes = result.srtSizeBytes;
      freshExp.duration = result.duration;
      freshClip.status = 'rendered';
    }
    if (freshJob) {
      freshJob.current_stage = 8;
      freshJob.stage_message = `Export ready: ${exp.filename} (${exp.resolution} ${exp.aspect_ratio})`;
    }
    saveDb();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FFmpeg rendering failed.';
    const freshDb = loadDb();
    if (freshDb.exports[exportId]) {
      freshDb.exports[exportId].render_status = 'failed';
      freshDb.exports[exportId].error_message = message;
    }
    if (freshDb.clips[clipId]) {
      freshDb.clips[clipId].status = 'failed';
    }
    saveDb();
  }
}
