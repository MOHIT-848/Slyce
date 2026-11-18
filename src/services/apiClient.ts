import type {
  ClipCandidate,
  ExportRecord,
  HealthStatus,
  RecipeConfig,
  SampleVideoInfo,
  SubtitleCue,
  TranscriptSegment,
  VideoJob,
} from '../types/clipforge';

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch('/api/health');
  return parseJsonOrThrow<HealthStatus>(res);
}

export async function fetchSamples(): Promise<{
  samples: SampleVideoInfo[];
  geminiConfigured: boolean;
}> {
  const res = await fetch('/api/samples');
  return parseJsonOrThrow(res);
}

export async function startSampleProject(
  sampleId: string,
  mode: 'ai' | 'demo',
  recipeConfig?: RecipeConfig
): Promise<{ job: VideoJob }> {
  const res = await fetch(`/api/samples/${encodeURIComponent(sampleId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, recipeConfig }),
  });
  return parseJsonOrThrow(res);
}

export async function createYoutubeProject(payload: {
  url: string;
  title?: string;
  focusPrompt?: string;
  recipeConfig?: RecipeConfig;
}): Promise<{ message: string; job: VideoJob }> {
  const res = await fetch('/api/videos/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function downloadLinkAsMp4(payload: {
  url: string;
  title?: string;
  focusPrompt?: string;
  recipeConfig?: RecipeConfig;
  autoAnalyze?: boolean;
}): Promise<{
  message: string;
  job: VideoJob;
  downloadedMp4: boolean;
  downloadUrl?: string;
}> {
  const res = await fetch('/api/videos/link/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function analyzeDownloadedJob(
  jobId: string,
  payload?: { focusPrompt?: string; recipeConfig?: RecipeConfig }
): Promise<{ job: VideoJob }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return parseJsonOrThrow(res);
}

export async function transcribeJobLyrics(
  jobId: string,
  clipId?: string
): Promise<{
  clip?: ClipCandidate;
  segments: TranscriptSegment[];
  cues: SubtitleCue[];
  message?: string;
}> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/transcribe-lyrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clipId ? { clipId } : {}),
  });
  return parseJsonOrThrow(res);
}

export async function retryYoutubeDownload(jobId: string): Promise<{ job: VideoJob }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry-youtube-download`, {
    method: 'POST',
  });
  return parseJsonOrThrow(res);
}

export async function uploadVideoWithProgress(
  file: File,
  title: string,
  onProgress: (percent: number) => void,
  options?: { focusPrompt?: string; attachToJobId?: string; recipeConfig?: RecipeConfig }
): Promise<{ message: string; job: VideoJob }> {
  onProgress(1);

  const initRes = await fetch('/api/videos/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      totalSize: file.size,
      title: title.trim(),
      focusPrompt: options?.focusPrompt?.trim() || undefined,
      attachToJobId: options?.attachToJobId || undefined,
      recipeConfig: options?.recipeConfig,
    }),
  });
  const initData = await parseJsonOrThrow<{ uploadId: string; chunkSize: number }>(initRes);

  const chunkSize = initData.chunkSize || 1024 * 1024;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

  try {
    for (let idx = 0; idx < totalChunks; idx++) {
      const start = idx * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const blob = file.slice(start, end);

      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const chunkRes = await fetch(
            `/api/videos/upload/${encodeURIComponent(initData.uploadId)}/chunk`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Chunk-Index': String(idx),
              },
              body: blob,
            }
          );
          await parseJsonOrThrow(chunkRes);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error('Chunk upload failed.');
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
      }

      if (lastErr) {
        throw lastErr;
      }

      const pct = Math.min(98, Math.round(((idx + 1) / totalChunks) * 98));
      onProgress(pct);
    }

    const completeRes = await fetch(
      `/api/videos/upload/${encodeURIComponent(initData.uploadId)}/complete`,
      { method: 'POST' }
    );
    const result = await parseJsonOrThrow<{ message: string; job: VideoJob }>(completeRes);
    onProgress(100);
    return result;
  } catch (err) {
    fetch(`/api/videos/upload/${encodeURIComponent(initData.uploadId)}`, {
      method: 'DELETE',
    }).catch(() => {});
    throw err;
  }
}

export async function fetchJobs(): Promise<{ jobs: VideoJob[] }> {
  const res = await fetch('/api/jobs');
  return parseJsonOrThrow(res);
}

export async function fetchJob(jobId: string): Promise<{ job: VideoJob }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  return parseJsonOrThrow(res);
}

export async function retryJob(jobId: string): Promise<{ job: VideoJob }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  });
  return parseJsonOrThrow(res);
}

export async function switchJobToManualMode(jobId: string): Promise<{ job: VideoJob }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/manual-mode`, {
    method: 'POST',
  });
  return parseJsonOrThrow(res);
}

export async function deleteJob(jobId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res);
}

export async function fetchTranscript(jobId: string): Promise<{
  jobId: string;
  segments: TranscriptSegment[];
}> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/transcript`);
  return parseJsonOrThrow(res);
}

export async function fetchClips(jobId: string): Promise<{
  jobId: string;
  clips: ClipCandidate[];
}> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/clips`);
  return parseJsonOrThrow(res);
}

export async function createCustomClip(
  jobId: string,
  payload: { start_seconds: number; end_seconds: number; title?: string }
): Promise<{ clip: ClipCandidate }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/clips/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function generateMoreClips(
  jobId: string,
  focusPrompt?: string
): Promise<{ addedClips: ClipCandidate[]; totalClips: number }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/clips/generate-more`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ focusPrompt }),
  });
  return parseJsonOrThrow(res);
}

export async function deleteClip(clipId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res);
}

export async function renderAllClips(
  jobId: string,
  force = false
): Promise<{ enqueuedCount: number; exports: ExportRecord[] }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/render-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchJobExports(jobId: string): Promise<{ exports: ExportRecord[] }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/exports`);
  return parseJsonOrThrow(res);
}

export async function fetchAllExports(): Promise<{ exports: ExportRecord[] }> {
  const res = await fetch('/api/exports');
  return parseJsonOrThrow(res);
}

export async function updateClip(
  clipId: string,
  payload: Partial<ClipCandidate> & {
    rebuild_cues_from_transcript?: boolean;
    apply_smart_cut?: boolean;
  }
): Promise<{ clip: ClipCandidate }> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function splitClipAtPlayhead(
  clipId: string,
  splitSeconds: number
): Promise<{ clips: [ClipCandidate, ClipCandidate] }> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ split_seconds: splitSeconds }),
  });
  return parseJsonOrThrow(res);
}

export async function restoreProjectsSnapshot(snapshot: {
  jobs: VideoJob[];
  transcripts: Record<string, TranscriptSegment[]>;
  clips: ClipCandidate[];
  exports: ExportRecord[];
}): Promise<{ restoredJobs: number; restoredClips: number; jobs: VideoJob[] }> {
  const res = await fetch('/api/projects/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  return parseJsonOrThrow(res);
}

export async function renderClip(clipId: string): Promise<{ export: ExportRecord }> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}/render`, {
    method: 'POST',
  });
  return parseJsonOrThrow(res);
}

export async function fetchAiModelSetting(): Promise<{
  defaultGeminiModel: string;
  effectiveModel: string;
}> {
  const res = await fetch('/api/settings/ai-model');
  return parseJsonOrThrow(res);
}

export async function saveAiModelSetting(defaultGeminiModel: string): Promise<{
  defaultGeminiModel: string;
  effectiveModel: string;
}> {
  const res = await fetch('/api/settings/ai-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultGeminiModel }),
  });
  return parseJsonOrThrow(res);
}

export async function saveYoutubeCookies(
  cookiesText: string
): Promise<{ configured: boolean; lineCount: number }> {
  const res = await fetch('/api/settings/youtube-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookiesText }),
  });
  return parseJsonOrThrow(res);
}

export async function clearYoutubeCookies(): Promise<{ configured: boolean }> {
  const res = await fetch('/api/settings/youtube-cookies', {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res);
}

export async function triggerCleanup(): Promise<{ removedOrphanedFiles: number }> {
  const res = await fetch('/api/maintenance/cleanup', { method: 'POST' });
  return parseJsonOrThrow(res);
}
