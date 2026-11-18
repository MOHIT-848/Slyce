import fs from 'fs';
import path from 'path';
import type {
  ClipCandidate,
  ExportRecord,
  TranscriptSegment,
  VideoJob,
} from '../../src/types/clipforge.ts';

export const ROOT_DIR = process.cwd();
export const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
export const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
export const PROCESSED_DIR = path.join(STORAGE_DIR, 'processed');
export const EXPORTS_DIR = path.join(STORAGE_DIR, 'exports');
export const SAMPLES_DIR = path.join(STORAGE_DIR, 'samples');
const DB_PATH = path.join(STORAGE_DIR, 'db.json');

export interface DatabaseSettings {
  defaultGeminiModel?: string;
}

export interface DatabaseState {
  jobs: Record<string, VideoJob>;
  jobFiles: Record<string, { videoPath: string; audioPath?: string; thumbnailPath?: string }>;
  transcripts: Record<string, TranscriptSegment[]>;
  clips: Record<string, ClipCandidate>;
  exports: Record<string, ExportRecord>;
  settings?: DatabaseSettings;
}

const emptyState: DatabaseState = {
  jobs: {},
  jobFiles: {},
  transcripts: {},
  clips: {},
  exports: {},
  settings: {},
};

export function ensureStorageDirs(): void {
  for (const dir of [STORAGE_DIR, UPLOADS_DIR, PROCESSED_DIR, EXPORTS_DIR, SAMPLES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

let memoryDb: DatabaseState | null = null;

const BUSY_JOB_STATUSES = new Set([
  'inspecting',
  'extracting_audio',
  'transcribing',
  'chunking',
  'detecting_highlights',
]);

function runStartupRecovery(db: DatabaseState): boolean {
  let changed = false;

  for (const job of Object.values(db.jobs)) {
    if (BUSY_JOB_STATUSES.has(job.status)) {
      job.status = 'failed';
      job.stage_message = 'Server restarted while processing — click Retry Analysis or Clip Manually.';
      job.error_message =
        job.error_message ||
        'Processing was interrupted by a server restart. Click Retry Analysis or Clip Manually to continue.';
      job.updated_at = new Date().toISOString();
      changed = true;
    }

    const files = db.jobFiles[job.id];
    if (job.source_video_url && (!files?.videoPath || !fs.existsSync(files.videoPath))) {
      // Check if a sample file exists on disk so sample projects remain directly playable
      const maybeSampleMp4 =
        job.source_type === 'sample' && job.original_filename
          ? path.join(SAMPLES_DIR, job.original_filename)
          : '';
      const maybeSpokenSample =
        job.source_type === 'sample' && job.original_filename
          ? path.join(SAMPLES_DIR, job.original_filename.replace(/\.mp4$/, '_spoken.mp4'))
          : '';
      if (maybeSpokenSample && fs.existsSync(maybeSpokenSample)) {
        db.jobFiles[job.id] = { ...(files ?? {}), videoPath: maybeSpokenSample };
        changed = true;
      } else if (maybeSampleMp4 && fs.existsSync(maybeSampleMp4)) {
        db.jobFiles[job.id] = { ...(files ?? {}), videoPath: maybeSampleMp4 };
        changed = true;
      } else if (job.source_type !== 'sample') {
        delete job.source_video_url;
        if (job.source_type === 'youtube' || job.source_type === 'instagram') {
          job.youtube_download_blocked = true;
        }
        changed = true;
      }
    }
  }

  for (const exp of Object.values(db.exports)) {
    if (exp.render_status === 'queued' || exp.render_status === 'rendering') {
      exp.render_status = 'failed';
      exp.error_message = 'Server restarted during render — click Render MP4 to regenerate.';
      if (db.clips[exp.clip_id] && db.clips[exp.clip_id].status === 'rendering') {
        db.clips[exp.clip_id].status = 'selected';
      }
      changed = true;
    } else if (exp.render_status === 'completed' && exp.file_path && !fs.existsSync(exp.file_path)) {
      exp.render_status = 'failed';
      exp.error_message = 'Rendered file was cleared after container restart — re-render anytime.';
      if (db.clips[exp.clip_id] && db.clips[exp.clip_id].status === 'rendered') {
        db.clips[exp.clip_id].status = 'selected';
      }
      changed = true;
    }
  }

  return changed;
}

export function loadDb(): DatabaseState {
  ensureStorageDirs();
  if (memoryDb) return memoryDb;
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DatabaseState>;
      memoryDb = {
        jobs: parsed.jobs ?? {},
        jobFiles: parsed.jobFiles ?? {},
        transcripts: parsed.transcripts ?? {},
        clips: parsed.clips ?? {},
        exports: parsed.exports ?? {},
        settings: parsed.settings ?? {},
      };
      if (runStartupRecovery(memoryDb)) {
        saveDb();
      }
      return memoryDb;
    } catch {
      memoryDb = structuredClone(emptyState);
      return memoryDb;
    }
  }
  memoryDb = structuredClone(emptyState);
  saveDb();
  return memoryDb;
}

export function saveDb(): void {
  ensureStorageDirs();
  if (!memoryDb) return;
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(memoryDb, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

export function restoreProjectsSnapshot(snapshot: {
  jobs?: VideoJob[];
  transcripts?: Record<string, TranscriptSegment[]>;
  clips?: ClipCandidate[];
  exports?: ExportRecord[];
}): { restoredJobs: number; restoredClips: number } {
  const db = loadDb();
  let restoredJobs = 0;
  let restoredClips = 0;

  if (Array.isArray(snapshot.jobs)) {
    for (const incomingJob of snapshot.jobs) {
      if (!incomingJob?.id || db.jobs[incomingJob.id]) continue;
      const cloned: VideoJob = { ...incomingJob };
      const existingFile = db.jobFiles[cloned.id]?.videoPath;
      if (!existingFile || !fs.existsSync(existingFile)) {
        // Check common saved paths on disk before clearing local video indicator
        const ytCandidate = path.join(UPLOADS_DIR, `${cloned.id}-youtube.mp4`);
        const igCandidate = path.join(UPLOADS_DIR, `${cloned.id}-instagram.mp4`);
        const linkCandidate = path.join(UPLOADS_DIR, `${cloned.id}-source.mp4`);
        if (fs.existsSync(ytCandidate)) {
          db.jobFiles[cloned.id] = { videoPath: ytCandidate };
        } else if (fs.existsSync(igCandidate)) {
          db.jobFiles[cloned.id] = { videoPath: igCandidate };
        } else if (fs.existsSync(linkCandidate)) {
          db.jobFiles[cloned.id] = { videoPath: linkCandidate };
        } else if (cloned.source_type === 'sample' && cloned.original_filename) {
          const samplePath = path.join(SAMPLES_DIR, cloned.original_filename);
          if (fs.existsSync(samplePath)) {
            db.jobFiles[cloned.id] = { videoPath: samplePath };
          }
        } else {
          delete cloned.source_video_url;
        }
      }
      if (BUSY_JOB_STATUSES.has(cloned.status)) {
        cloned.status = 'failed';
        cloned.stage_message = 'Restored project — click Retry Analysis or Clip Manually.';
      }
      db.jobs[cloned.id] = cloned;
      restoredJobs += 1;
    }
  }

  if (snapshot.transcripts && typeof snapshot.transcripts === 'object') {
    for (const [jobId, segs] of Object.entries(snapshot.transcripts)) {
      if (!db.transcripts[jobId] && Array.isArray(segs)) {
        db.transcripts[jobId] = segs;
      }
    }
  }

  if (Array.isArray(snapshot.clips)) {
    for (const incomingClip of snapshot.clips) {
      if (!incomingClip?.id || !incomingClip.job_id || db.clips[incomingClip.id]) continue;
      db.clips[incomingClip.id] = {
        ...incomingClip,
        status: incomingClip.status === 'rendering' ? 'selected' : incomingClip.status,
      };
      restoredClips += 1;
    }
  }

  if (Array.isArray(snapshot.exports)) {
    for (const incomingExp of snapshot.exports) {
      if (!incomingExp?.id || db.exports[incomingExp.id]) continue;
      const hasFile = Boolean(incomingExp.file_path && fs.existsSync(incomingExp.file_path));
      db.exports[incomingExp.id] = {
        ...incomingExp,
        render_status:
          hasFile && incomingExp.render_status === 'completed' ? 'completed' : 'failed',
        error_message: hasFile
          ? incomingExp.error_message
          : 'Re-render MP4 needed after server restart.',
      };
    }
  }

  if (restoredJobs > 0 || restoredClips > 0) {
    saveDb();
  }
  return { restoredJobs, restoredClips };
}

export function safeUnlink(filePath?: string | null): void {
  if (!filePath) return;
  try {
    // Only delete files inside STORAGE_DIR (never delete pre-built samples unless explicitly requested)
    const resolved = path.resolve(filePath);
    if (
      resolved.startsWith(path.resolve(UPLOADS_DIR)) ||
      resolved.startsWith(path.resolve(PROCESSED_DIR)) ||
      resolved.startsWith(path.resolve(EXPORTS_DIR))
    ) {
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }
  } catch (err) {
    console.warn('[storage] Failed to unlink file:', filePath, err);
  }
}

export function deleteJobAndFiles(jobId: string): boolean {
  const db = loadDb();
  const job = db.jobs[jobId];
  if (!job) return false;

  const files = db.jobFiles[jobId];
  if (files) {
    safeUnlink(files.videoPath);
    safeUnlink(files.audioPath);
    safeUnlink(files.thumbnailPath);
    delete db.jobFiles[jobId];
  }

  // Delete processed folder for job if present
  const jobProcessedDir = path.join(PROCESSED_DIR, jobId);
  if (fs.existsSync(jobProcessedDir)) {
    fs.rmSync(jobProcessedDir, { recursive: true, force: true });
  }

  // Delete clips and their exports
  for (const [clipId, clip] of Object.entries(db.clips)) {
    if (clip.job_id === jobId) {
      delete db.clips[clipId];
    }
  }

  for (const [exportId, exp] of Object.entries(db.exports)) {
    if (exp.job_id === jobId) {
      safeUnlink(exp.file_path);
      safeUnlink(exp.subtitle_file_path);
      delete db.exports[exportId];
    }
  }

  delete db.transcripts[jobId];
  delete db.jobs[jobId];
  saveDb();
  return true;
}

export function cleanupOrphanedTempFiles(maxAgeHours = 24): number {
  ensureStorageDirs();
  const db = loadDb();
  const referenced = new Set<string>();

  for (const files of Object.values(db.jobFiles)) {
    if (files.videoPath) referenced.add(path.resolve(files.videoPath));
    if (files.audioPath) referenced.add(path.resolve(files.audioPath));
    if (files.thumbnailPath) referenced.add(path.resolve(files.thumbnailPath));
  }
  for (const exp of Object.values(db.exports)) {
    if (exp.file_path) referenced.add(path.resolve(exp.file_path));
    if (exp.subtitle_file_path) referenced.add(path.resolve(exp.subtitle_file_path));
  }

  const cutoffMs = Date.now() - maxAgeHours * 3600 * 1000;
  let removed = 0;

  for (const dir of [UPLOADS_DIR, EXPORTS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.resolve(path.join(dir, entry));
      if (referenced.has(fullPath)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(fullPath);
          removed += 1;
        }
      } catch {
        // ignore stat/unlink error
      }
    }
  }
  return removed;
}
