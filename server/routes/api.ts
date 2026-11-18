import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import type {
  AspectRatio,
  AutoHookStyle,
  ClipCandidate,
  ClipEffects,
  ExportRecord,
  ExportResolution,
  FramingMode,
  RecipeConfig,
  SubtitleCue,
  SubtitleSettings,
  TranscriptSegment,
  VideoJob,
} from '../../src/types/clipforge.ts';
import {
  DEFAULT_CLIP_ADJUSTMENTS,
  DEFAULT_CLIP_AUDIO,
  DEFAULT_CLIP_EFFECTS,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_RECIPE_CONFIG,
  applySmartCutToCueText,
  getAspectRatioForResolution,
  getDimensionsForResolution,
  resolveClipDefaultsFromRecipe,
  resolveDurationWindow,
} from '../../src/types/clipforge.ts';
import {
  detectHighlightsFromTranscript,
  getConfiguredModel,
  isGeminiConfigured,
  setConfiguredDefaultModel,
  transcribeAudioChunk,
} from '../ai/geminiService.ts';
import {
  checkFfmpegCapabilities,
  extractAudioChunkDirectMp3,
  generateThumbnail,
  inspectVideo,
} from '../media/ffmpegService.ts';
import {
  clearYoutubeCookies,
  downloadVideoFromLink,
  fetchYoutubeOembed,
  hasYoutubeCookies,
  isYtDlpAvailable,
  parseVideoLink,
  parseYoutubeUrl,
  saveYoutubeCookies,
} from '../media/youtubeService.ts';
import {
  ensureAutoHookSampleVideo,
  ensureSampleVideoFile,
  getSampleDefinition,
  listSampleVideos,
} from '../samples/sampleData.ts';
import {
  PROCESSED_DIR,
  UPLOADS_DIR,
  cleanupOrphanedTempFiles,
  deleteJobAndFiles,
  ensureStorageDirs,
  loadDb,
  restoreProjectsSnapshot,
  safeUnlink,
  saveDb,
} from '../utils/storage.ts';
import { buildCuesFromTranscript, generateAssContent, generateSrtContent } from '../utils/subtitles.ts';
import {
  enableManualMode,
  enqueueAnalysisJob,
  enqueueClipRender,
  getActiveJobCount,
} from '../workers/jobProcessor.ts';

ensureStorageDirs();

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi']);

function isAcceptedVideoUpload(filename: string, mimeType: string): { ok: boolean; reason?: string } {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      reason: 'Unsupported file extension. Accepted video formats: .mp4, .mov, .webm, .mkv, .m4v, .avi.',
    };
  }
  const mime = mimeType.toLowerCase().trim();
  if (mime && !mime.startsWith('video/') && mime !== 'application/octet-stream') {
    return {
      ok: false,
      reason: `Unsupported MIME type (${mimeType}). Expected a video file.`,
    };
  }
  return { ok: true };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirs();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    cb(null, unique);
  },
});

// Unlimited upload size (no fileSize cap)
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const check = isAcceptedVideoUpload(file.originalname, file.mimetype);
    if (!check.ok) {
      cb(new Error(check.reason || 'Unsupported video file.'));
      return;
    }
    cb(null, true);
  },
});

function getVideoMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.avi') return 'video/x-msvideo';
  return 'video/mp4';
}

function streamFileWithRange(
  req: express.Request,
  res: express.Response,
  filePath: string,
  contentType: string,
  downloadFilename?: string
): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found on disk.' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (downloadFilename) {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Sync persisted default Gemini model on startup
  const initialDb = loadDb();
  if (initialDb.settings?.defaultGeminiModel) {
    setConfiguredDefaultModel(initialDb.settings.defaultGeminiModel);
  }

  // Health & system capabilities
  router.get('/health', async (_req, res) => {
    const caps = await checkFfmpegCapabilities();
    const geminiConfigured = isGeminiConfigured();
    res.json({
      status: caps.ffmpegAvailable && caps.ffprobeAvailable ? 'ok' : 'degraded',
      ...caps,
      ytDlpAvailable: isYtDlpAvailable(),
      youtubeCookiesConfigured: hasYoutubeCookies(),
      geminiConfigured,
      geminiModel: getConfiguredModel(),
      unlimitedMode: true,
      maxUploadMb: null,
      maxDurationSeconds: null,
      activeJobs: getActiveJobCount(),
      queueMode: 'In-process async queue · Unlimited video duration, file size & clips',
    });
  });

  // Default Gemini model configuration (never stores or exposes API keys)
  router.get('/settings/ai-model', (_req, res) => {
    const db = loadDb();
    res.json({
      defaultGeminiModel: db.settings?.defaultGeminiModel || 'default',
      effectiveModel: getConfiguredModel(),
    });
  });

  router.post('/settings/ai-model', (req, res) => {
    const requested = String(req.body?.defaultGeminiModel ?? 'default').trim();
    const allowed = new Set(['default', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
    if (!allowed.has(requested)) {
      res.status(400).json({ error: 'Unsupported Gemini model selection.' });
      return;
    }
    const db = loadDb();
    db.settings = { ...(db.settings ?? {}), defaultGeminiModel: requested };
    saveDb();
    setConfiguredDefaultModel(requested === 'default' ? null : requested);
    res.json({
      defaultGeminiModel: requested,
      effectiveModel: getConfiguredModel(),
    });
  });

  // YouTube cookies management (optional helper for cloud datacenter IPs)
  router.get('/settings/youtube-cookies', (_req, res) => {
    res.json({ configured: hasYoutubeCookies() });
  });

  router.post('/settings/youtube-cookies', (req, res) => {
    try {
      const cookiesText = String(req.body?.cookiesText ?? '');
      const result = saveYoutubeCookies(cookiesText);
      res.json({ configured: true, lineCount: result.lineCount });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid cookies payload.',
      });
    }
  });

  router.delete('/settings/youtube-cookies', (_req, res) => {
    clearYoutubeCookies();
    res.json({ configured: false });
  });

  // List available team-owned sample videos
  router.get('/samples', (_req, res) => {
    res.json({
      samples: listSampleVideos(),
      geminiConfigured: isGeminiConfigured(),
    });
  });

  // Stream real animated Auto Hook sample MP4 previews (Editorial, Statement, Classic)
  router.get('/auto-hooks/:styleId/sample.mp4', async (req, res) => {
    const styleId = req.params.styleId as AutoHookStyle;
    if (styleId !== 'editorial' && styleId !== 'statement' && styleId !== 'classic') {
      res.status(404).json({ error: 'Auto Hook sample style not found.' });
      return;
    }
    try {
      const mp4Path = await ensureAutoHookSampleVideo(styleId);
      streamFileWithRange(req, res, mp4Path, 'video/mp4');
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate Auto Hook sample video.',
      });
    }
  });

  // Start a project from a team-owned sample video (real pipeline or Demo Mode)
  router.post('/samples/:sampleId/start', async (req, res) => {
    try {
      const { sampleId } = req.params;
      const mode = req.body?.mode === 'demo' ? 'demo' : 'ai';
      const recipeConfig =
        req.body?.recipeConfig && typeof req.body.recipeConfig === 'object'
          ? (req.body.recipeConfig as RecipeConfig)
          : undefined;
      const def = getSampleDefinition(sampleId);
      if (!def) {
        res.status(404).json({ error: 'Sample video not found.' });
        return;
      }

      const useDemoMode = mode === 'demo' || !isGeminiConfigured();
      const { videoPath } = await ensureSampleVideoFile(sampleId, !useDemoMode);

      const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const job: VideoJob = {
        id: jobId,
        original_filename: def.filename,
        title: def.title,
        duration: def.duration_seconds,
        resolution: '1280x720',
        status: 'uploaded',
        current_stage: 1,
        stage_message: useDemoMode
          ? 'Sample MP4 loaded in DEMO MODE (preloaded transcript + real FFmpeg rendering).'
          : 'Sample MP4 prepared. Starting real AI transcription and highlight pipeline...',
        progress: 8,
        created_at: now,
        updated_at: now,
        error_message: null,
        is_demo_mode: useDemoMode,
        source_type: 'sample',
        source_video_url: `/api/jobs/${jobId}/media`,
        ...(recipeConfig ? { recipe_config: recipeConfig } : {}),
      };

      const db = loadDb();
      db.jobs[jobId] = job;
      db.jobFiles[jobId] = { videoPath };
      saveDb();

      enqueueAnalysisJob(jobId, sampleId);
      res.status(201).json({ job });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start sample video job.';
      res.status(500).json({ error: msg });
    }
  });

  // Import a YouTube video link & create unlimited processing job
  router.post('/videos/youtube', async (req, res) => {
    try {
      const rawUrl = String(req.body?.url ?? '').trim();
      const customTitle = String(req.body?.title ?? '').trim();
      const focusPrompt = String(req.body?.focusPrompt ?? '').trim();
      const recipeConfig =
        req.body?.recipeConfig && typeof req.body.recipeConfig === 'object'
          ? (req.body.recipeConfig as RecipeConfig)
          : undefined;

      const parsed = parseYoutubeUrl(rawUrl);
      if (!parsed) {
        res.status(400).json({
          error:
            'Please enter a valid YouTube video URL (youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., or youtube.com/live/...).',
        });
        return;
      }

      const oembed = await fetchYoutubeOembed(parsed.canonicalUrl);
      const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      const job: VideoJob = {
        id: jobId,
        original_filename: `${parsed.videoId}.mp4`,
        title: customTitle || oembed.title || `YouTube Video (${parsed.videoId})`,
        duration: 0,
        resolution: 'Fetching...',
        status: 'uploaded',
        current_stage: 1,
        stage_message: 'YouTube link queued. Downloading source video and preparing AI analysis...',
        progress: 8,
        created_at: now,
        updated_at: now,
        error_message: null,
        is_demo_mode: false,
        source_type: 'youtube',
        youtube_url: parsed.canonicalUrl,
        youtube_video_id: parsed.videoId,
        thumbnail_url: oembed.thumbnailUrl,
        ...(recipeConfig ? { recipe_config: recipeConfig } : {}),
      };

      const db = loadDb();
      db.jobs[jobId] = job;
      db.jobFiles[jobId] = { videoPath: '' };
      saveDb();

      enqueueAnalysisJob(jobId, undefined, focusPrompt || undefined);
      res.status(201).json({
        message: 'YouTube link accepted. Downloading video & extracting clips...',
        job,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create YouTube job.';
      res.status(500).json({ error: msg });
    }
  });

  // Import a YouTube or Instagram link: either Download MP4 First (clean local source) or Download & Auto-Clip
  router.post('/videos/link/download', async (req, res) => {
    try {
      const rawUrl = String(req.body?.url ?? '').trim();
      const customTitle = String(req.body?.title ?? '').trim();
      const focusPrompt = String(req.body?.focusPrompt ?? '').trim();
      const autoAnalyze = req.body?.autoAnalyze === true;
      const recipeConfig =
        req.body?.recipeConfig && typeof req.body.recipeConfig === 'object'
          ? (req.body.recipeConfig as RecipeConfig)
          : undefined;

      const parsed = parseVideoLink(rawUrl);
      if (!parsed) {
        res.status(400).json({
          error:
            'Please paste a valid YouTube (watch, shorts, youtu.be) or Instagram (reel, reels, p, tv) link.',
        });
        return;
      }

      const oembed =
        parsed.platform === 'youtube' ? await fetchYoutubeOembed(parsed.canonicalUrl) : {};
      const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const defaultTitle =
        parsed.platform === 'instagram'
          ? `Instagram Reel (${parsed.id})`
          : oembed.title || `YouTube Video (${parsed.id})`;

      if (autoAnalyze) {
        const job: VideoJob = {
          id: jobId,
          original_filename: `${parsed.id}.mp4`,
          title: customTitle || defaultTitle,
          duration: 0,
          resolution: 'Fetching...',
          status: 'uploaded',
          current_stage: 1,
          stage_message: `Downloading ${parsed.platform === 'instagram' ? 'Instagram' : 'YouTube'} MP4 and preparing clips...`,
          progress: 8,
          created_at: now,
          updated_at: now,
          error_message: null,
          is_demo_mode: false,
          source_type: parsed.platform,
          external_url: parsed.canonicalUrl,
          platform_label: parsed.platform === 'instagram' ? 'Instagram' : 'YouTube',
          ...(parsed.platform === 'youtube'
            ? { youtube_url: parsed.canonicalUrl, youtube_video_id: parsed.id }
            : {}),
          ...(oembed.thumbnailUrl ? { thumbnail_url: oembed.thumbnailUrl } : {}),
          ...(recipeConfig ? { recipe_config: recipeConfig } : {}),
        };

        const db = loadDb();
        db.jobs[jobId] = job;
        db.jobFiles[jobId] = { videoPath: '' };
        saveDb();

        enqueueAnalysisJob(jobId, undefined, focusPrompt || undefined);
        res.status(201).json({
          message: `${job.platform_label} MP4 download & AI clipping started.`,
          job,
          downloadedMp4: false,
        });
        return;
      }

      // Download-MP4-First mode: fetches clean local MP4 right now with zero YouTube embed dependency
      const targetMp4 = path.join(UPLOADS_DIR, `${jobId}-${parsed.platform}.mp4`);
      const dlResult = await downloadVideoFromLink({
        url: parsed.canonicalUrl,
        outputMp4Path: targetMp4,
      });

      if (!dlResult.success || !dlResult.videoPath || !fs.existsSync(dlResult.videoPath)) {
        safeUnlink(targetMp4);
        res.status(400).json({
          error:
            dlResult.errorReason ||
            `Could not download MP4 from ${parsed.platform === 'instagram' ? 'Instagram' : 'YouTube'}. Paste cookies below or try another public video.`,
          blockedByBotCheck: Boolean(dlResult.blockedByBotCheck),
          platform: parsed.platform,
        });
        return;
      }

      const jobDir = path.join(PROCESSED_DIR, jobId);
      if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
      const thumbPath = path.join(jobDir, 'thumbnail.jpg');

      const [metadata, thumbOk] = await Promise.all([
        inspectVideo(dlResult.videoPath),
        generateThumbnail(dlResult.videoPath, thumbPath, 1.5)
          .then(() => true)
          .catch(() => false),
      ]);

      const resolvedTitle = customTitle || dlResult.title || defaultTitle;
      const job: VideoJob = {
        id: jobId,
        original_filename: `${parsed.id}.mp4`,
        title: resolvedTitle,
        duration: metadata.duration,
        resolution: `${metadata.width}x${metadata.height}`,
        metadata,
        status: 'ready',
        current_stage: 2,
        stage_message:
          'Clean MP4 downloaded! Preview, download raw .MP4, or click "Extract AI Clips & Lyrics".',
        progress: 100,
        created_at: now,
        updated_at: now,
        error_message: null,
        is_demo_mode: false,
        source_type: parsed.platform,
        external_url: parsed.canonicalUrl,
        platform_label: parsed.platform === 'instagram' ? 'Instagram' : 'YouTube',
        ...(parsed.platform === 'youtube'
          ? { youtube_url: parsed.canonicalUrl, youtube_video_id: parsed.id }
          : {}),
        youtube_download_blocked: false,
        source_video_url: `/api/jobs/${jobId}/media`,
        thumbnail_url: thumbOk ? `/api/jobs/${jobId}/thumbnail` : dlResult.thumbnailUrl || oembed.thumbnailUrl,
        ...(recipeConfig ? { recipe_config: recipeConfig } : {}),
      };

      const defaults = resolveClipDefaultsFromRecipe(recipeConfig, resolvedTitle);
      const starterClip: ClipCandidate = {
        id: `${jobId}-clip-1`,
        job_id: jobId,
        start_seconds: 0,
        end_seconds: Number(Math.max(2, metadata.duration).toFixed(2)),
        title: `${resolvedTitle} · Full MP4`,
        hook: resolvedTitle,
        summary: 'Downloaded clean MP4 ready for trimming, song lyrics auto-captions, and vertical export.',
        transcript_excerpt: 'Downloaded MP4 ready — click "Extract AI Clips & Lyrics" or generate captions inside Clip Editor.',
        score: 95,
        score_breakdown: {
          completeness: 95,
          hook_strength: 92,
          useful_information: 92,
          emotional_emphasis: 94,
          duration_fit: 96,
          explanation: 'Full downloaded MP4 ready for instant editing or AI highlight extraction.',
        },
        selection_reason: 'Downloaded source MP4 ready for direct clipping & editing',
        status: 'selected',
        subtitle_cues: [],
        subtitle_settings: defaults.subtitleSettings,
        framing_mode: defaults.framingMode,
        aspect_ratio: defaults.aspectRatio,
        export_resolution: defaults.exportResolution,
        effects: defaults.effects,
      };

      const db = loadDb();
      db.jobs[jobId] = job;
      db.jobFiles[jobId] = {
        videoPath: dlResult.videoPath,
        ...(thumbOk ? { thumbnailPath: thumbPath } : {}),
      };
      db.clips[starterClip.id] = starterClip;
      saveDb();

      res.status(201).json({
        message: 'MP4 downloaded cleanly! Preview or extract AI clips & lyrics anytime.',
        job,
        downloadedMp4: true,
        downloadUrl: `/api/jobs/${jobId}/media?download=1`,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to download MP4 from link.',
      });
    }
  });

  // Retry downloading the YouTube or Instagram MP4 for an existing link job (e.g., after adding cookies)
  router.post('/jobs/:jobId/retry-youtube-download', async (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    const linkUrl = job?.external_url || job?.youtube_url;
    if (!job || (job.source_type !== 'youtube' && job.source_type !== 'instagram') || !linkUrl) {
      res.status(404).json({ error: 'Link project job not found.' });
      return;
    }

    try {
      const targetMp4 = path.join(UPLOADS_DIR, `${job.id}-${job.source_type}.mp4`);
      const dlResult = await downloadVideoFromLink({
        url: linkUrl,
        outputMp4Path: targetMp4,
      });

      if (!dlResult.success || !dlResult.videoPath) {
        res.status(400).json({
          error:
            dlResult.errorReason ||
            'Could not download source MP4. Make sure valid cookies are saved or attach an MP4 file directly.',
        });
        return;
      }

      const metadata = await inspectVideo(dlResult.videoPath);
      db.jobFiles[job.id] = {
        ...(db.jobFiles[job.id] ?? {}),
        videoPath: dlResult.videoPath,
      };
      job.youtube_download_blocked = false;
      job.source_video_url = `/api/jobs/${job.id}/media`;
      job.duration = metadata.duration;
      job.resolution = `${metadata.width}x${metadata.height}`;
      job.metadata = metadata;
      job.stage_message = 'Source MP4 downloaded! Ready for vertical FFmpeg rendering.';
      job.updated_at = new Date().toISOString();
      saveDb();

      res.json({ job });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to download source MP4.',
      });
    }
  });

  // Upload user-owned video & create processing job (no size/duration limit)
  router.post('/videos', (req, res) => {
    upload.single('video')(req, res, (err) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'Video upload failed.';
        res.status(400).json({ error: msg });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No video file provided under field name "video".' });
        return;
      }

      const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const rawTitle =
        typeof req.body?.title === 'string' && req.body.title.trim().length > 0
          ? req.body.title.trim()
          : path.parse(req.file.originalname).name;
      const focusPrompt =
        typeof req.body?.focusPrompt === 'string' && req.body.focusPrompt.trim().length > 0
          ? req.body.focusPrompt.trim()
          : undefined;
      let recipeConfig: RecipeConfig | undefined;
      if (typeof req.body?.recipeConfig === 'string') {
        try {
          recipeConfig = JSON.parse(req.body.recipeConfig) as RecipeConfig;
        } catch {
          // ignore malformed JSON
        }
      } else if (req.body?.recipeConfig && typeof req.body.recipeConfig === 'object') {
        recipeConfig = req.body.recipeConfig as RecipeConfig;
      }

      const job: VideoJob = {
        id: jobId,
        original_filename: req.file.originalname,
        title: rawTitle,
        duration: 0,
        resolution: 'Inspecting...',
        status: 'uploaded',
        current_stage: 1,
        stage_message: 'Video uploaded successfully. Ready for unlimited AI analysis.',
        progress: 8,
        created_at: now,
        updated_at: now,
        error_message: null,
        is_demo_mode: false,
        source_type: 'upload',
        source_video_url: `/api/jobs/${jobId}/media`,
        ...(recipeConfig ? { recipe_config: recipeConfig } : {}),
      };

      const db = loadDb();
      db.jobs[jobId] = job;
      db.jobFiles[jobId] = { videoPath: req.file.path };
      saveDb();

      enqueueAnalysisJob(jobId, undefined, focusPrompt);
      res.status(201).json({
        message: 'Video uploaded successfully. Ready for AI analysis.',
        job,
      });
    });
  });

  // Chunked upload session store (supports arbitrarily large multi-GB files with no size limit)
  const pendingUploads = new Map<
    string,
    {
      filePath: string;
      originalFilename: string;
      title: string;
      totalSize: number;
      receivedBytes: number;
      nextChunkIndex: number;
      focusPrompt?: string;
      attachToJobId?: string;
      recipeConfig?: RecipeConfig;
    }
  >();

  router.post('/videos/upload/init', (req, res) => {
    const filename = String(req.body?.filename ?? '').trim();
    const mimeType = String(req.body?.mimeType ?? '').toLowerCase().trim();
    const totalSize = Number(req.body?.totalSize ?? 0);
    const title = String(req.body?.title ?? '').trim();
    const focusPrompt = String(req.body?.focusPrompt ?? '').trim() || undefined;
    const attachToJobId = String(req.body?.attachToJobId ?? '').trim() || undefined;
    const recipeConfig =
      req.body?.recipeConfig && typeof req.body.recipeConfig === 'object'
        ? (req.body.recipeConfig as RecipeConfig)
        : undefined;

    if (!filename) {
      res.status(400).json({ error: 'Filename is required.' });
      return;
    }

    const check = isAcceptedVideoUpload(filename, mimeType);
    if (!check.ok) {
      res.status(400).json({ error: check.reason });
      return;
    }

    if (!Number.isFinite(totalSize) || totalSize <= 0) {
      res.status(400).json({ error: 'File size must be greater than 0 bytes.' });
      return;
    }

    ensureStorageDirs();
    const ext = path.extname(filename).toLowerCase();
    const uploadId = `upl-${crypto.randomUUID().slice(0, 12)}`;
    const destName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    const filePath = path.join(UPLOADS_DIR, destName);
    fs.writeFileSync(filePath, Buffer.alloc(0));

    pendingUploads.set(uploadId, {
      filePath,
      originalFilename: filename,
      title: title || path.parse(filename).name,
      totalSize,
      receivedBytes: 0,
      nextChunkIndex: 0,
      focusPrompt,
      attachToJobId,
      recipeConfig,
    });

    res.status(201).json({
      uploadId,
      chunkSize: 4 * 1024 * 1024, // 4 MB chunks cut HTTP upload round-trips 4x while staying fast & proxy-safe
    });
  });

  router.post(
    '/videos/upload/:uploadId/chunk',
    express.raw({ type: 'application/octet-stream', limit: '8mb' }),
    (req, res) => {
      const session = pendingUploads.get(req.params.uploadId);
      if (!session) {
        res.status(404).json({ error: 'Upload session not found or expired.' });
        return;
      }

      const chunkIndex = Number(req.headers['x-chunk-index'] ?? session.nextChunkIndex);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Empty binary chunk received.' });
        return;
      }

      // Idempotent retry handling if the same chunk index is resent
      if (chunkIndex < session.nextChunkIndex) {
        res.json({ receivedBytes: session.receivedBytes, duplicate: true });
        return;
      }

      if (chunkIndex !== session.nextChunkIndex) {
        res.status(409).json({
          error: `Out-of-order chunk ${chunkIndex}; expected ${session.nextChunkIndex}.`,
        });
        return;
      }

      fs.appendFileSync(session.filePath, req.body);
      session.receivedBytes += req.body.length;
      session.nextChunkIndex += 1;

      res.json({ receivedBytes: session.receivedBytes, nextChunkIndex: session.nextChunkIndex });
    }
  );

  router.post('/videos/upload/:uploadId/complete', async (req, res) => {
    const session = pendingUploads.get(req.params.uploadId);
    if (!session) {
      res.status(404).json({ error: 'Upload session not found or already completed.' });
      return;
    }

    pendingUploads.delete(req.params.uploadId);

    if (!fs.existsSync(session.filePath)) {
      res.status(400).json({ error: 'Uploaded video file is missing on server.' });
      return;
    }

    const stat = fs.statSync(session.filePath);
    if (stat.size !== session.totalSize) {
      try {
        fs.unlinkSync(session.filePath);
      } catch {
        // ignore
      }
      res.status(400).json({
        error: `Incomplete upload: received ${stat.size} of ${session.totalSize} bytes.`,
      });
      return;
    }

    // If attaching a local MP4 to an existing YouTube-analyzed project
    if (session.attachToJobId) {
      const db = loadDb();
      const existingJob = db.jobs[session.attachToJobId];
      if (!existingJob) {
        safeUnlink(session.filePath);
        res.status(404).json({ error: 'Target project job not found.' });
        return;
      }
      try {
        const metadata = await inspectVideo(session.filePath);
        db.jobFiles[existingJob.id] = {
          ...(db.jobFiles[existingJob.id] ?? {}),
          videoPath: session.filePath,
        };
        existingJob.original_filename = session.originalFilename;
        existingJob.youtube_download_blocked = false;
        existingJob.source_video_url = `/api/jobs/${existingJob.id}/media`;
        existingJob.duration = metadata.duration;
        existingJob.resolution = `${metadata.width}x${metadata.height}`;
        existingJob.metadata = metadata;
        existingJob.stage_message = 'Source video attached! Ready for 9:16 FFmpeg rendering.';
        existingJob.updated_at = new Date().toISOString();
        saveDb();

        res.status(200).json({
          message: 'Source video attached to project. Ready for 9:16 MP4 rendering.',
          job: existingJob,
        });
        return;
      } catch (err) {
        safeUnlink(session.filePath);
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid video file attached.',
        });
        return;
      }
    }

    const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const job: VideoJob = {
      id: jobId,
      original_filename: session.originalFilename,
      title: session.title,
      duration: 0,
      resolution: 'Inspecting...',
      status: 'uploaded',
      current_stage: 1,
      stage_message: 'Video uploaded successfully. Ready for unlimited AI analysis.',
      progress: 8,
      created_at: now,
      updated_at: now,
      error_message: null,
      is_demo_mode: false,
      source_type: 'upload',
      source_video_url: `/api/jobs/${jobId}/media`,
      ...(session.recipeConfig ? { recipe_config: session.recipeConfig } : {}),
    };

    const db = loadDb();
    db.jobs[jobId] = job;
    db.jobFiles[jobId] = { videoPath: session.filePath };
    saveDb();

    enqueueAnalysisJob(jobId, undefined, session.focusPrompt);
    res.status(201).json({
      message: 'Video uploaded successfully. Ready for AI analysis.',
      job,
    });
  });

  router.delete('/videos/upload/:uploadId', (req, res) => {
    const session = pendingUploads.get(req.params.uploadId);
    if (session) {
      pendingUploads.delete(req.params.uploadId);
      try {
        if (fs.existsSync(session.filePath)) fs.unlinkSync(session.filePath);
      } catch {
        // ignore
      }
    }
    res.json({ aborted: true });
  });

  // List all jobs
  router.get('/jobs', (_req, res) => {
    const db = loadDb();
    const jobs = Object.values(db.jobs).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    res.json({ jobs });
  });

  // Get single job status & progress
  router.get('/jobs/:jobId', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    res.json({ job });
  });

  // Retry failed or fallback-clipped job safely
  router.post('/jobs/:jobId/retry', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    for (const [cid, c] of Object.entries(db.clips)) {
      if (c.job_id === job.id && cid.startsWith(`${job.id}-clip-`)) {
        delete db.clips[cid];
      }
    }
    job.status = 'uploaded';
    job.current_stage = 1;
    job.progress = 8;
    job.error_message = null;
    job.ai_warning = null;
    job.stage_message = 'Retrying video analysis pipeline...';
    job.updated_at = new Date().toISOString();
    saveDb();

    enqueueAnalysisJob(job.id);
    res.json({ job });
  });

  // Switch failed/quota-limited job directly into manual clipping mode
  router.post('/jobs/:jobId/manual-mode', (req, res) => {
    try {
      const job = enableManualMode(req.params.jobId);
      res.json({ job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to enable manual clipping mode.',
      });
    }
  });

  // Trigger AI Highlight + Transcript/Lyrics extraction on a downloaded-first MP4 project
  router.post('/jobs/:jobId/analyze', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    const files = db.jobFiles[job.id];
    if (!files?.videoPath || !fs.existsSync(files.videoPath)) {
      res.status(400).json({ error: 'Local MP4 source file not found on server for analysis.' });
      return;
    }

    const focusPrompt = String(req.body?.focusPrompt ?? '').trim() || undefined;
    if (req.body?.recipeConfig && typeof req.body.recipeConfig === 'object') {
      job.recipe_config = req.body.recipeConfig as RecipeConfig;
    }
    for (const [cid, c] of Object.entries(db.clips)) {
      if (c.job_id === job.id) {
        delete db.clips[cid];
      }
    }
    job.status = 'uploaded';
    job.current_stage = 1;
    job.progress = 8;
    job.error_message = null;
    job.ai_warning = null;
    job.stage_message = 'Analyzing downloaded MP4 for speech, song lyrics, and viral highlights...';
    job.updated_at = new Date().toISOString();
    saveDb();

    enqueueAnalysisJob(job.id, undefined, focusPrompt);
    res.json({ job });
  });

  // Dedicated Lyrics Auto-Captions generator (per-clip karaoke lyrics OR full-video song lyrics transcript)
  router.post('/jobs/:jobId/transcribe-lyrics', async (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    if (!isGeminiConfigured()) {
      res.status(400).json({ error: 'GEMINI_API_KEY is required to extract song lyrics captions.' });
      return;
    }
    const files = db.jobFiles[job.id];
    if (!files?.videoPath || !fs.existsSync(files.videoPath)) {
      res.status(400).json({ error: 'Source MP4 is missing on disk. Download or attach MP4 first.' });
      return;
    }

    const meta = job.metadata ?? (await inspectVideo(files.videoPath));
    if (!meta.hasAudio) {
      res.status(400).json({ error: 'This video has no audio track to extract song lyrics from.' });
      return;
    }

    const clipId = typeof req.body?.clipId === 'string' ? req.body.clipId.trim() : '';
    const jobDir = path.join(PROCESSED_DIR, job.id);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
    const cfg = { ...DEFAULT_RECIPE_CONFIG, ...(job.recipe_config ?? {}) };
    const modelOverride = cfg.geminiModel !== 'default' ? cfg.geminiModel : undefined;

    try {
      if (clipId) {
        const clip = db.clips[clipId];
        if (!clip || clip.job_id !== job.id) {
          res.status(404).json({ error: 'Clip not found in this project.' });
          return;
        }
        const clipLen = Math.max(1, clip.end_seconds - clip.start_seconds);
        const tempMp3 = path.join(jobDir, `lyrics_${clip.id}_${Date.now()}.mp3`);
        try {
          await extractAudioChunkDirectMp3(files.videoPath, clip.start_seconds, clipLen, tempMp3);
          const segments = await transcribeAudioChunk({
            audioFilePath: tempMp3,
            mimeType: 'audio/mp3',
            chunkOffsetSeconds: clip.start_seconds,
            chunkDurationSeconds: clipLen,
            jobId: job.id,
            segmentIndexOffset: 1,
            modelOverride,
            spokenLanguage: cfg.spokenLanguage,
            turboMode: true,
            captionMode: 'lyrics',
          });

          const cues: SubtitleCue[] = segments
            .map((seg, idx) => ({
              id: `lyric-${idx + 1}`,
              start_seconds: Number(Math.max(0, seg.start_seconds - clip.start_seconds).toFixed(2)),
              end_seconds: Number(Math.max(0.3, Math.min(clipLen, seg.end_seconds - clip.start_seconds)).toFixed(2)),
              text: seg.text.trim(),
            }))
            .filter((c) => c.text.length > 0 && c.end_seconds > c.start_seconds);

          if (cues.length === 0) {
            res.status(200).json({
              clip,
              segments: [],
              cues: [],
              message: 'No clear vocals or lyrics detected in this clip audio (likely pure instrumental).',
            });
            return;
          }

          clip.subtitle_cues = cues;
          clip.subtitle_settings = {
            ...clip.subtitle_settings,
            style: 'karaoke',
            animation: 'typewriter',
            uppercase: true,
            burnIn: true,
          };
          if (!clip.transcript_excerpt || clip.transcript_excerpt.startsWith('Visual /') || clip.transcript_excerpt.startsWith('Downloaded MP4')) {
            clip.transcript_excerpt = cues.map((c) => c.text).join(' ');
          }
          saveDb();
          res.json({ clip, segments, cues });
          return;
        } finally {
          safeUnlink(tempMp3);
        }
      }

      // Full-video song lyrics extraction across 240s chunks
      const totalDur = meta.duration;
      const chunkLen = 240;
      const plans: Array<{ index: number; offset: number; len: number }> = [];
      for (let offset = 0, idx = 0; offset < totalDur; offset += chunkLen, idx++) {
        const len = Math.min(chunkLen, totalDur - offset);
        if (len >= 0.5) plans.push({ index: idx, offset, len });
      }

      const buckets: TranscriptSegment[][] = new Array(plans.length);
      let cursor = 0;
      async function worker() {
        while (cursor < plans.length) {
          const p = plans[cursor++];
          const mp3 = path.join(jobDir, `lyrics_full_${p.index}_${Date.now()}.mp3`);
          try {
            await extractAudioChunkDirectMp3(files.videoPath, p.offset, p.len, mp3);
            buckets[p.index] = await transcribeAudioChunk({
              audioFilePath: mp3,
              mimeType: 'audio/mp3',
              chunkOffsetSeconds: p.offset,
              chunkDurationSeconds: p.len,
              jobId: job.id,
              segmentIndexOffset: p.index * 1000 + 1,
              modelOverride,
              spokenLanguage: cfg.spokenLanguage,
              turboMode: true,
              captionMode: 'lyrics',
            });
          } finally {
            safeUnlink(mp3);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, plans.length) }, () => worker()));

      const allLyrics = buckets
        .flat()
        .filter(Boolean)
        .sort((a, b) => a.start_seconds - b.start_seconds)
        .map((s, idx) => ({ ...s, id: `lyric-seg-${idx + 1}`, speaker_label: s.speaker_label || 'Lyrics' }));

      if (allLyrics.length > 0) {
        const freshDb = loadDb();
        freshDb.transcripts[job.id] = allLyrics;
        for (const c of Object.values(freshDb.clips)) {
          if (c.job_id === job.id && c.subtitle_cues.length === 0) {
            c.subtitle_cues = buildCuesFromTranscript(allLyrics, c.start_seconds, c.end_seconds);
            if (c.subtitle_cues.length > 0) {
              c.subtitle_settings = {
                ...c.subtitle_settings,
                style: 'karaoke',
                animation: 'typewriter',
                uppercase: true,
                burnIn: true,
              };
            }
          }
        }
        saveDb();
      }
      res.json({ segments: allLyrics, cues: [] });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to transcribe song lyrics.',
      });
    }
  });

  // Restore persisted project snapshots saved in browser storage after server container restart
  router.post('/projects/restore', (req, res) => {
    try {
      const result = restoreProjectsSnapshot({
        jobs: Array.isArray(req.body?.jobs) ? req.body.jobs : [],
        transcripts: req.body?.transcripts && typeof req.body.transcripts === 'object' ? req.body.transcripts : {},
        clips: Array.isArray(req.body?.clips) ? req.body.clips : [],
        exports: Array.isArray(req.body?.exports) ? req.body.exports : [],
      });
      const db = loadDb();
      const jobs = Object.values(db.jobs).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      res.json({ ...result, jobs });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to restore saved projects.',
      });
    }
  });

  // Get timestamped transcript
  router.get('/jobs/:jobId/transcript', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    const segments = db.transcripts[req.params.jobId] ?? [];
    res.json({ jobId: req.params.jobId, segments });
  });

  // Get AI-generated & custom clip candidates
  router.get('/jobs/:jobId/clips', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    const clips = Object.values(db.clips)
      .filter((c) => c.job_id === req.params.jobId)
      .sort((a, b) => b.score - a.score);
    res.json({ jobId: req.params.jobId, clips });
  });

  // Create unlimited custom/manual clip at any timestamp range
  router.post('/jobs/:jobId/clips/custom', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }

    const startSeconds = Math.max(0, Number(req.body?.start_seconds));
    let endSeconds = Number(req.body?.end_seconds);
    const rawTitle = String(req.body?.title ?? '').trim();

    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      res.status(400).json({ error: 'Start and end timestamps must be valid numbers.' });
      return;
    }
    if (job.duration > 0 && endSeconds > job.duration) {
      if (endSeconds - job.duration <= 0.6) {
        endSeconds = job.duration;
      } else {
        res.status(400).json({
          error: `End time (${endSeconds.toFixed(1)}s) cannot exceed video duration (${job.duration.toFixed(1)}s).`,
        });
        return;
      }
    }
    if (endSeconds - startSeconds < 2) {
      res.status(400).json({ error: 'Clip duration must be at least 2 seconds.' });
      return;
    }

    const segments = db.transcripts[job.id] ?? [];
    let cues = buildCuesFromTranscript(segments, startSeconds, endSeconds);
    if (job.recipe_config?.smartCut) {
      cues = cues
        .map((c) => ({ ...c, text: applySmartCutToCueText(c.text) }))
        .filter((c) => c.text.length > 0);
    }
    const excerpt = segments
      .filter((s) => s.end_seconds > startSeconds && s.start_seconds < endSeconds)
      .map((s) => s.text)
      .join(' ')
      .trim();

    const clipId = `${job.id}-clip-${crypto.randomUUID().slice(0, 6)}`;
    const resolvedTitle =
      rawTitle || `Custom Clip (${Math.round(startSeconds)}s – ${Math.round(endSeconds)}s)`;
    const recipeDefaults = resolveClipDefaultsFromRecipe(
      job.recipe_config,
      resolvedTitle
    );
    const clip: ClipCandidate = {
      id: clipId,
      job_id: job.id,
      start_seconds: Number(startSeconds.toFixed(2)),
      end_seconds: Number(endSeconds.toFixed(2)),
      title: resolvedTitle,
      hook: excerpt ? excerpt.slice(0, 120) : 'Custom creator-defined clip range',
      summary: 'Manually selected clip boundaries with auto-aligned transcript captions.',
      transcript_excerpt: excerpt || 'No spoken transcript segments in this custom range.',
      score: 100,
      score_breakdown: {
        completeness: 100,
        hook_strength: 100,
        useful_information: 100,
        emotional_emphasis: 100,
        duration_fit: 100,
        explanation: 'Creator-selected custom timestamp range.',
      },
      selection_reason: 'Custom creator-selected clip range',
      status: 'selected',
      subtitle_cues: cues,
      subtitle_settings: recipeDefaults.subtitleSettings,
      effects: recipeDefaults.effects,
      framing_mode: recipeDefaults.framingMode,
      aspect_ratio: recipeDefaults.aspectRatio,
      export_resolution: recipeDefaults.exportResolution,
    };

    db.clips[clipId] = clip;
    saveDb();
    res.status(201).json({ clip });
  });

  // Ask AI to generate additional non-overlapping clips (no cap!)
  router.post('/jobs/:jobId/clips/generate-more', async (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    if (!isGeminiConfigured()) {
      res.status(400).json({
        error: 'GEMINI_API_KEY is required to generate additional AI highlight clips.',
      });
      return;
    }
    const segments = db.transcripts[job.id] ?? [];
    if (segments.length === 0) {
      res.status(400).json({
        error: 'Transcript is empty. Create custom clips manually or wait for transcription to finish.',
      });
      return;
    }

    try {
      const focusPrompt = String(req.body?.focusPrompt ?? '').trim() || undefined;
      const existingClips = Object.values(db.clips).filter((c) => c.job_id === job.id);
      const duration = job.duration > 0 ? job.duration : segments[segments.length - 1].end_seconds;
      const cfg = { ...DEFAULT_RECIPE_CONFIG, ...(job.recipe_config ?? {}) };
      const modelOverride = cfg.geminiModel !== 'default' ? cfg.geminiModel : undefined;
      const durWin = resolveDurationWindow(
        cfg.targetDuration,
        cfg.customMinDuration,
        cfg.customMaxDuration,
        duration
      );

      const addedClips = await detectHighlightsFromTranscript({
        jobId: job.id,
        segments,
        videoDuration: duration,
        videoTitle: job.title,
        focusPrompt,
        existingClips,
        modelOverride,
        minDuration: durWin.min,
        maxDuration: durWin.max,
        smartCut: cfg.smartCut,
      });

      const freshDb = loadDb();
      for (const clip of addedClips) {
        const defaults = resolveClipDefaultsFromRecipe(cfg, clip.hook || clip.title);
        clip.framing_mode = defaults.framingMode;
        clip.aspect_ratio = defaults.aspectRatio;
        clip.export_resolution = defaults.exportResolution;
        clip.subtitle_settings = defaults.subtitleSettings;
        clip.effects = defaults.effects;
        freshDb.clips[clip.id] = clip;
      }
      saveDb();

      const totalClips = Object.values(freshDb.clips).filter((c) => c.job_id === job.id).length;
      res.json({ addedClips, totalClips });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate additional clips.',
      });
    }
  });

  // Batch render all clips in a project
  router.post('/jobs/:jobId/render-all', (req, res) => {
    const db = loadDb();
    const job = db.jobs[req.params.jobId];
    if (!job) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }

    const clips = Object.values(db.clips).filter((c) => c.job_id === job.id);
    if (clips.length === 0) {
      res.status(400).json({ error: 'No clips available to render.' });
      return;
    }

    const force = req.body?.force === true;
    const existingExports = Object.values(db.exports).filter((e) => e.job_id === job.id);
    const enqueued: ExportRecord[] = [];

    try {
      for (const clip of clips) {
        const alreadyDoneOrBusy = existingExports.some(
          (e) =>
            e.clip_id === clip.id &&
            (e.render_status === 'completed' ||
              e.render_status === 'queued' ||
              e.render_status === 'rendering')
        );
        if (!force && alreadyDoneOrBusy) continue;
        enqueued.push(enqueueClipRender(clip.id));
      }
      res.status(202).json({ enqueuedCount: enqueued.length, exports: enqueued });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to enqueue batch render.',
      });
    }
  });

  // Get exports for a job
  router.get('/jobs/:jobId/exports', (req, res) => {
    const db = loadDb();
    const exportsList = Object.values(db.exports)
      .filter((e) => e.job_id === req.params.jobId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ exports: exportsList });
  });

  // Get all recent exports
  router.get('/exports', (_req, res) => {
    const db = loadDb();
    const exportsList = Object.values(db.exports).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    res.json({ exports: exportsList });
  });

  // Stream or download source MP4 video
  router.get('/jobs/:jobId/media', (req, res) => {
    const db = loadDb();
    const files = db.jobFiles[req.params.jobId];
    const job = db.jobs[req.params.jobId];
    if (!files || !files.videoPath || !fs.existsSync(files.videoPath)) {
      res.status(404).json({ error: 'Source video not found.' });
      return;
    }
    const isDownload = req.query.download === '1' || req.query.download === 'true';
    const safeSlug =
      (job?.title || req.params.jobId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 48) || req.params.jobId;
    streamFileWithRange(
      req,
      res,
      files.videoPath,
      getVideoMimeType(files.videoPath),
      isDownload ? `${safeSlug}.mp4` : undefined
    );
  });

  // Serve generated thumbnail
  router.get('/jobs/:jobId/thumbnail', (req, res) => {
    const db = loadDb();
    const files = db.jobFiles[req.params.jobId];
    if (!files || !files.thumbnailPath || !fs.existsSync(files.thumbnailPath)) {
      res.status(404).json({ error: 'Thumbnail not found.' });
      return;
    }
    res.sendFile(path.resolve(files.thumbnailPath));
  });

  // Edit clip title, start/end timestamps, framing, resolution, or subtitle cues/settings
  router.patch('/clips/:clipId', (req, res) => {
    const db = loadDb();
    const clip = db.clips[req.params.clipId];
    if (!clip) {
      res.status(404).json({ error: 'Clip candidate not found.' });
      return;
    }
    const job = db.jobs[clip.job_id];
    const maxDuration = job?.duration && job.duration > 0 ? job.duration : Number.MAX_SAFE_INTEGER;

    const body = req.body as Partial<{
      title: string;
      start_seconds: number;
      end_seconds: number;
      subtitle_cues: SubtitleCue[];
      subtitle_settings: Partial<SubtitleSettings>;
      effects: Partial<ClipEffects>;
      framing_mode: FramingMode;
      aspect_ratio: AspectRatio;
      export_resolution: ExportResolution;
      status: ClipCandidate['status'];
      rebuild_cues_from_transcript: boolean;
      apply_smart_cut: boolean;
    }>;

    if (typeof body.title === 'string') {
      const trimmed = body.title.trim();
      if (trimmed.length === 0) {
        res.status(400).json({ error: 'Clip title cannot be empty.' });
        return;
      }
      clip.title = trimmed.slice(0, 120);
    }

    let boundsChanged = false;
    if (body.start_seconds !== undefined || body.end_seconds !== undefined) {
      const nextStart = Math.max(
        0,
        body.start_seconds !== undefined ? Number(body.start_seconds) : clip.start_seconds
      );
      let nextEnd =
        body.end_seconds !== undefined ? Number(body.end_seconds) : clip.end_seconds;

      if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
        res.status(400).json({ error: 'Start and end timestamps must be valid numbers.' });
        return;
      }
      if (nextEnd > maxDuration) {
        if (nextEnd - maxDuration <= 0.6) {
          nextEnd = maxDuration;
        } else {
          res.status(400).json({
            error: `Timestamps must remain within the source video duration (0s – ${maxDuration.toFixed(1)}s).`,
          });
          return;
        }
      }
      if (nextEnd - nextStart < 2) {
        res.status(400).json({ error: 'Clip duration must be at least 2 seconds.' });
        return;
      }

      clip.start_seconds = Number(nextStart.toFixed(2));
      clip.end_seconds = Number(nextEnd.toFixed(2));
      boundsChanged = true;
    }

    if (boundsChanged && body.rebuild_cues_from_transcript) {
      const segs = db.transcripts[clip.job_id] ?? [];
      clip.subtitle_cues = buildCuesFromTranscript(segs, clip.start_seconds, clip.end_seconds);
    } else if (Array.isArray(body.subtitle_cues)) {
      const clipLen = clip.end_seconds - clip.start_seconds;
      clip.subtitle_cues = body.subtitle_cues
        .map((c, idx) => ({
          id: c.id || `cue-${idx + 1}`,
          start_seconds: Math.max(0, Math.min(clipLen, Number(c.start_seconds) || 0)),
          end_seconds: Math.max(0.2, Math.min(clipLen, Number(c.end_seconds) || 1)),
          text: String(c.text ?? '').trim(),
        }))
        .filter((c) => c.end_seconds > c.start_seconds);
    }

    if (body.apply_smart_cut) {
      const segs = db.transcripts[clip.job_id] ?? [];
      const inner = segs
        .filter((s) => s.end_seconds > clip.start_seconds && s.start_seconds < clip.end_seconds)
        .sort((a, b) => a.start_seconds - b.start_seconds);
      if (inner.length > 0) {
        const trimmedStart = Math.max(clip.start_seconds, inner[0].start_seconds - 0.15);
        const trimmedEnd = Math.min(clip.end_seconds, inner[inner.length - 1].end_seconds + 0.15);
        if (trimmedEnd - trimmedStart >= 2) {
          clip.start_seconds = Number(trimmedStart.toFixed(2));
          clip.end_seconds = Number(trimmedEnd.toFixed(2));
          clip.subtitle_cues = buildCuesFromTranscript(segs, clip.start_seconds, clip.end_seconds);
        }
      }
      clip.subtitle_cues = clip.subtitle_cues
        .map((c) => ({ ...c, text: applySmartCutToCueText(c.text) }))
        .filter((c) => c.text.length > 0);
    }

    if (body.subtitle_settings) {
      const merged = {
        ...clip.subtitle_settings,
        ...body.subtitle_settings,
        fontSize: Math.max(
          16,
          Math.min(54, Number(body.subtitle_settings.fontSize ?? clip.subtitle_settings.fontSize))
        ),
      };
      if (merged.outlineWidth !== undefined) {
        merged.outlineWidth = Math.max(0, Math.min(10, Number(merged.outlineWidth) || 0));
      }
      if (typeof merged.fontFamily === 'string') {
        merged.fontFamily = merged.fontFamily.trim().slice(0, 60) || undefined;
      }
      clip.subtitle_settings = merged;
    }

    if (body.effects) {
      const baseEffects = clip.effects ?? DEFAULT_CLIP_EFFECTS;
      const nextSpeed = Number(body.effects.playbackSpeed ?? baseEffects.playbackSpeed ?? 1);
      const rawAdj = body.effects.adjustments;
      const rawTrans = body.effects.transform;
      const rawAudio = body.effects.audio;
      const rawWm = body.effects.watermark;

      const clamp = (val: unknown, lo: number, hi: number, fallback: number) => {
        const n = Number(val);
        return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
      };

      const nextAdj = rawAdj
        ? {
            brightness: clamp(rawAdj.brightness, -0.3, 0.3, DEFAULT_CLIP_ADJUSTMENTS.brightness),
            contrast: clamp(rawAdj.contrast, 0.7, 1.5, DEFAULT_CLIP_ADJUSTMENTS.contrast),
            saturation: clamp(rawAdj.saturation, 0, 2.0, DEFAULT_CLIP_ADJUSTMENTS.saturation),
            warmth: clamp(rawAdj.warmth, -1, 1, DEFAULT_CLIP_ADJUSTMENTS.warmth),
            sharpness: clamp(rawAdj.sharpness, 0, 1.5, DEFAULT_CLIP_ADJUSTMENTS.sharpness),
            vignette: clamp(rawAdj.vignette, 0, 1, DEFAULT_CLIP_ADJUSTMENTS.vignette),
          }
        : baseEffects.adjustments ?? DEFAULT_CLIP_ADJUSTMENTS;

      const rotVal = rawTrans?.rotateDeg;
      const safeRot: 0 | 90 | 180 | 270 =
        rotVal === 90 || rotVal === 180 || rotVal === 270 ? rotVal : 0;
      const canvasVal = rawTrans?.canvasBg;
      const safeCanvas: 'blur' | 'black' | 'slate' | 'gradient' =
        canvasVal === 'black' || canvasVal === 'slate' || canvasVal === 'gradient' ? canvasVal : 'blur';

      const nextTrans = rawTrans
        ? {
            zoom: clamp(rawTrans.zoom, 0.85, 1.8, DEFAULT_CLIP_TRANSFORM.zoom),
            panX: clamp(rawTrans.panX, -50, 50, DEFAULT_CLIP_TRANSFORM.panX),
            panY: clamp(rawTrans.panY, -50, 50, DEFAULT_CLIP_TRANSFORM.panY),
            flipH: Boolean(rawTrans.flipH),
            rotateDeg: safeRot,
            canvasBg: safeCanvas,
          }
        : baseEffects.transform ?? DEFAULT_CLIP_TRANSFORM;

      const nextAudio = rawAudio
        ? {
            volume: clamp(rawAudio.volume, 0, 2.0, DEFAULT_CLIP_AUDIO.volume),
            muted: Boolean(rawAudio.muted),
            fadeIn: Boolean(rawAudio.fadeIn),
            fadeOut: Boolean(rawAudio.fadeOut),
          }
        : baseEffects.audio ?? DEFAULT_CLIP_AUDIO;

      const wmPos = rawWm?.position;
      const safeWmPos: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' =
        wmPos === 'top_left' || wmPos === 'bottom_left' || wmPos === 'bottom_right'
          ? wmPos
          : 'top_right';
      const nextWm = rawWm
        ? {
            text: String(rawWm.text ?? '').trim().slice(0, 48),
            position: safeWmPos,
            opacity: clamp(rawWm.opacity, 0.2, 1.0, 0.75),
          }
        : baseEffects.watermark;

      clip.effects = {
        ...baseEffects,
        ...body.effects,
        introDuration: Math.max(
          0.2,
          Math.min(2.0, Number(body.effects.introDuration ?? baseEffects.introDuration) || 0.5)
        ),
        outroDuration: Math.max(
          0.2,
          Math.min(2.0, Number(body.effects.outroDuration ?? baseEffects.outroDuration) || 0.5)
        ),
        playbackSpeed: Math.max(0.5, Math.min(2.0, Number.isFinite(nextSpeed) ? nextSpeed : 1)),
        adjustments: nextAdj,
        transform: nextTrans,
        audio: nextAudio,
        watermark: nextWm,
      };
    }

    if (
      body.framing_mode === 'center_crop' ||
      body.framing_mode === 'subject_crop' ||
      body.framing_mode === 'blurred_background'
    ) {
      clip.framing_mode = body.framing_mode;
    }

    const VALID_RESOLUTIONS = new Set<ExportResolution>([
      '1080x1920',
      '720x1280',
      '1080x1080',
      '720x720',
      '1920x1080',
      '1280x720',
    ]);
    if (body.export_resolution && VALID_RESOLUTIONS.has(body.export_resolution)) {
      clip.export_resolution = body.export_resolution;
      clip.aspect_ratio = getAspectRatioForResolution(body.export_resolution);
    }

    if (
      body.aspect_ratio === '9:16' ||
      body.aspect_ratio === '1:1' ||
      body.aspect_ratio === '16:9'
    ) {
      clip.aspect_ratio = body.aspect_ratio;
    }

    if (body.status === 'candidate' || body.status === 'selected') {
      clip.status = body.status;
    }

    saveDb();
    res.json({ clip });
  });

  // Split a clip into two sequential clips at the relative playhead offset (CapCut / VN style Split)
  router.post('/clips/:clipId/split', (req, res) => {
    const db = loadDb();
    const clip = db.clips[req.params.clipId];
    if (!clip) {
      res.status(404).json({ error: 'Clip candidate not found.' });
      return;
    }

    const clipLen = clip.end_seconds - clip.start_seconds;
    if (clipLen < 4) {
      res.status(400).json({ error: 'Clip must be at least 4 seconds long to split into two parts.' });
      return;
    }

    const rawSplit = Number(req.body?.split_seconds);
    if (!Number.isFinite(rawSplit)) {
      res.status(400).json({ error: 'Invalid split timestamp.' });
      return;
    }

    const splitOffset = Math.max(2, Math.min(clipLen - 2, Number(rawSplit.toFixed(2))));
    const splitAbsolute = Number((clip.start_seconds + splitOffset).toFixed(2));
    const origEnd = clip.end_seconds;
    const origTitle = clip.title.replace(/\s*\(Part [12]\)$/i, '');

    const part1Cues = clip.subtitle_cues
      .filter((c) => c.start_seconds < splitOffset - 0.05)
      .map((c, idx) => ({
        ...c,
        id: c.id || `cue-p1-${idx + 1}`,
        end_seconds: Number(Math.min(splitOffset, c.end_seconds).toFixed(2)),
      }))
      .filter((c) => c.end_seconds > c.start_seconds + 0.1);

    const part2Cues = clip.subtitle_cues
      .filter((c) => c.end_seconds > splitOffset + 0.05)
      .map((c, idx) => ({
        ...c,
        id: `cue-p2-${idx + 1}`,
        start_seconds: Number(Math.max(0, c.start_seconds - splitOffset).toFixed(2)),
        end_seconds: Number(Math.max(0.2, c.end_seconds - splitOffset).toFixed(2)),
      }))
      .filter((c) => c.end_seconds > c.start_seconds + 0.1);

    clip.end_seconds = splitAbsolute;
    clip.title = `${origTitle} (Part 1)`;
    clip.subtitle_cues = part1Cues;
    clip.status = 'selected';

    const part2Id = `${clip.job_id}-clip-${crypto.randomUUID().slice(0, 6)}`;
    const part2: ClipCandidate = {
      ...structuredClone(clip),
      id: part2Id,
      start_seconds: splitAbsolute,
      end_seconds: origEnd,
      title: `${origTitle} (Part 2)`,
      subtitle_cues: part2Cues,
      status: 'selected',
    };

    db.clips[part2Id] = part2;
    saveDb();
    res.status(201).json({ clips: [clip, part2] });
  });

  // Delete a single clip and its exports
  router.delete('/clips/:clipId', (req, res) => {
    const db = loadDb();
    const clip = db.clips[req.params.clipId];
    if (!clip) {
      res.status(404).json({ error: 'Clip candidate not found.' });
      return;
    }
    for (const [expId, exp] of Object.entries(db.exports)) {
      if (exp.clip_id === clip.id) {
        safeUnlink(exp.file_path);
        safeUnlink(exp.subtitle_file_path);
        delete db.exports[expId];
      }
    }
    delete db.clips[clip.id];
    saveDb();
    res.json({ deleted: true, clipId: clip.id });
  });

  // Download direct SRT subtitles for any clip (even before MP4 render)
  router.get('/clips/:clipId/srt', (req, res) => {
    const db = loadDb();
    const clip = db.clips[req.params.clipId];
    if (!clip) {
      res.status(404).json({ error: 'Clip candidate not found.' });
      return;
    }
    const slug =
      clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'clipforge-subtitles';
    const speed = Math.max(0.5, Math.min(2.0, Number(clip.effects?.playbackSpeed) || 1));
    const smartCut = Boolean(clip.effects?.smartCut);
    const srt = generateSrtContent(clip.subtitle_cues, speed, smartCut);
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.srt"`);
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.send(srt);
  });

  // Download styled ASS subtitles (preserving custom fonts & animations)
  router.get('/clips/:clipId/ass', (req, res) => {
    const db = loadDb();
    const clip = db.clips[req.params.clipId];
    if (!clip) {
      res.status(404).json({ error: 'Clip candidate not found.' });
      return;
    }
    const slug =
      clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'clipforge-subtitles';
    const [w, h] = getDimensionsForResolution(clip.export_resolution, clip.aspect_ratio);
    const ass = generateAssContent(
      clip.subtitle_cues,
      clip.subtitle_settings,
      w,
      h,
      clip.effects
    );
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.ass"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(ass);
  });

  // Render vertical 9:16 MP4 + SRT export for a clip candidate
  router.post('/clips/:clipId/render', (req, res) => {
    try {
      const exportRecord = enqueueClipRender(req.params.clipId);
      res.status(202).json({ export: exportRecord });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to enqueue clip render.';
      res.status(400).json({ error: msg });
    }
  });

  // Stream or download real rendered MP4 or SRT export
  router.get('/exports/:exportId', (req, res) => {
    const db = loadDb();
    const exp = db.exports[req.params.exportId];
    if (!exp) {
      res.status(404).json({ error: 'Export record not found.' });
      return;
    }
    if (exp.render_status !== 'completed') {
      res.status(409).json({
        error:
          exp.render_status === 'failed'
            ? exp.error_message || 'Export render failed.'
            : 'Export is still rendering.',
      });
      return;
    }

    const format = req.query.format === 'srt' ? 'srt' : 'mp4';
    const isDownload = req.query.download === '1' || req.query.download === 'true';

    if (format === 'srt') {
      if (!fs.existsSync(exp.subtitle_file_path)) {
        res.status(404).json({ error: 'SRT subtitle file missing from disk.' });
        return;
      }
      if (isDownload) {
        res.setHeader('Content-Disposition', `attachment; filename="${exp.srt_filename}"`);
      }
      res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
      fs.createReadStream(exp.subtitle_file_path).pipe(res);
      return;
    }

    streamFileWithRange(
      req,
      res,
      exp.file_path,
      'video/mp4',
      isDownload ? exp.filename : undefined
    );
  });

  // Delete project and temporary files
  router.delete('/jobs/:jobId', (req, res) => {
    const deleted = deleteJobAndFiles(req.params.jobId);
    if (!deleted) {
      res.status(404).json({ error: 'Project job not found.' });
      return;
    }
    res.json({ deleted: true, jobId: req.params.jobId });
  });

  // Manual temporary-file cleanup trigger
  router.post('/maintenance/cleanup', (_req, res) => {
    const removed = cleanupOrphanedTempFiles(1);
    res.json({ removedOrphanedFiles: removed });
  });

  return router;
}
