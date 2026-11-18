import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Film,
  Layers,
  Music,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  analyzeDownloadedJob,
  createCustomClip,
  deleteClip,
  generateMoreClips,
  renderAllClips,
  transcribeJobLyrics,
} from '../../services/apiClient';
import type { ClipCandidate, TranscriptSegment, VideoJob } from '../../types/clipforge';
import { formatDurationShort, formatTimestamp } from '../../utils/time';
import { YoutubeMp4UnlockPanel } from '../video/YoutubeMp4UnlockPanel';

interface TranscriptAndHighlightsProps {
  job: VideoJob;
  transcript: TranscriptSegment[];
  clips: ClipCandidate[];
  onEditClip: (clip: ClipCandidate) => void;
  onQuickRender: (clip: ClipCandidate) => void;
  onClipsChanged: () => Promise<void> | void;
  onJobUpdated?: (job: VideoJob) => void;
  onGoToExports: () => void;
  onRetryAnalysis?: () => void;
  retryingAnalysis?: boolean;
  renderingClipId: string | null;
}

export function TranscriptAndHighlights({
  job,
  transcript,
  clips,
  onEditClip,
  onQuickRender,
  onClipsChanged,
  onJobUpdated,
  onGoToExports,
  onRetryAnalysis,
  retryingAnalysis = false,
  renderingClipId,
}: TranscriptAndHighlightsProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(clips[0]?.id ?? null);

  // YouTube embed seek state (when direct server MP4 download was blocked)
  const [embedStartSec, setEmbedStartSec] = useState(0);
  const [embedKey, setEmbedKey] = useState(0);

  // Custom clip creation state
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customStart, setCustomStart] = useState(0);
  const [customEnd, setCustomEnd] = useState(() => Math.min(30, job.duration > 5 ? job.duration : 30));
  const [creatingCustom, setCreatingCustom] = useState(false);

  // AI Generate More Clips state
  const [morePrompt, setMorePrompt] = useState('');
  const [generatingMore, setGeneratingMore] = useState(false);

  // Batch render, lyrics & delete state
  const [renderingAll, setRenderingAll] = useState(false);
  const [extractingLyrics, setExtractingLyrics] = useState(false);
  const [runningAiAnalyze, setRunningAiAnalyze] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const filteredSegments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return transcript;
    return transcript.filter((s) => s.text.toLowerCase().includes(q));
  }, [transcript, searchQuery]);

  function seekSourceVideo(seconds: number) {
    const target = Math.max(0, seconds);
    if (videoRef.current) {
      videoRef.current.currentTime = target;
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked; seeking still works
      });
    } else if (job.youtube_video_id) {
      setEmbedStartSec(Math.floor(target));
      setEmbedKey((k) => k + 1);
    }
  }

  async function handleCreateCustomClip(e: React.FormEvent) {
    e.preventDefault();
    setActionErr(null);
    setActionMsg(null);
    setCreatingCustom(true);
    try {
      const res = await createCustomClip(job.id, {
        start_seconds: customStart,
        end_seconds: customEnd,
        title: customTitle.trim() || undefined,
      });
      await onClipsChanged();
      setCustomTitle('');
      setShowCustomForm(false);
      setActionMsg(`Added custom clip "${res.clip.title}".`);
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Failed to create custom clip.');
    } finally {
      setCreatingCustom(false);
    }
  }

  async function handleGenerateMore() {
    setActionErr(null);
    setActionMsg(null);
    setGeneratingMore(true);
    try {
      const res = await generateMoreClips(job.id, morePrompt.trim() || undefined);
      await onClipsChanged();
      setMorePrompt('');
      setActionMsg(
        res.addedClips.length > 0
          ? `Found ${res.addedClips.length} additional clip(s). Total clips: ${res.totalClips}.`
          : 'No additional non-overlapping highlights found for that prompt. Try a custom clip range or different focus.'
      );
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Failed to generate additional clips.');
    } finally {
      setGeneratingMore(false);
    }
  }

  async function handleRenderAll() {
    setActionErr(null);
    setActionMsg(null);
    setRenderingAll(true);
    try {
      const res = await renderAllClips(job.id);
      await onClipsChanged();
      if (res.enqueuedCount === 0) {
        setActionMsg('All clips are already rendered or queued.');
      } else {
        setActionMsg(`Queued ${res.enqueuedCount} clip(s) for MP4 + SRT rendering.`);
        onGoToExports();
      }
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Failed to queue batch render.');
    } finally {
      setRenderingAll(false);
    }
  }

  async function handleDeleteClip(clipId: string) {
    setActionErr(null);
    setDeletingClipId(clipId);
    try {
      await deleteClip(clipId);
      await onClipsChanged();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Failed to delete clip.');
    } finally {
      setDeletingClipId(null);
    }
  }

  async function handleExtractLyrics() {
    setActionErr(null);
    setActionMsg(null);
    setExtractingLyrics(true);
    try {
      const res = await transcribeJobLyrics(job.id);
      await onClipsChanged();
      if (res.segments.length === 0) {
        setActionMsg('No clear sung lyrics detected in this audio track.');
      } else {
        setActionMsg(`Extracted ${res.segments.length} synced song lyrics lines!`);
      }
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Failed to extract song lyrics.');
    } finally {
      setExtractingLyrics(false);
    }
  }

  async function handleRunAiHighlights() {
    setActionErr(null);
    setActionMsg(null);
    setRunningAiAnalyze(true);
    try {
      const res = await analyzeDownloadedJob(job.id);
      onJobUpdated?.(res.job);
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Failed to start AI highlight analysis.');
      setRunningAiAnalyze(false);
    }
  }

  const hasLocalVideo = Boolean(job.source_video_url) && !job.youtube_download_blocked;
  const sourceHeaderLabel =
    job.source_type === 'instagram'
      ? 'Instagram Source MP4'
      : job.source_type === 'youtube'
        ? 'YouTube Source MP4'
        : 'Source Video';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Column: Source Video + Searchable Timestamped Transcript */}
      <div className="lg:col-span-5 space-y-5">
        <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
              {sourceHeaderLabel}
            </h3>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                {job.resolution} · {formatDurationShort(job.duration)}
              </span>
              {hasLocalVideo && (
                <a
                  href={`/api/jobs/${encodeURIComponent(job.id)}/media?download=1`}
                  download
                  className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-[#101827] px-2.5 py-1 text-[11px] font-semibold text-[#20C7D9] hover:border-[#20C7D9]/45 whitespace-nowrap"
                >
                  <Download className="h-3 w-3" />
                  Save .MP4
                </a>
              )}
            </div>
          </div>

          {hasLocalVideo && job.source_video_url ? (
            <video
              ref={videoRef}
              src={job.source_video_url}
              controls
              className="aspect-video w-full rounded-lg border border-white/[0.08] bg-black"
            />
          ) : job.youtube_video_id ? (
            <iframe
              key={embedKey}
              src={`https://www.youtube.com/embed/${job.youtube_video_id}?start=${embedStartSec}&autoplay=${embedKey > 0 ? 1 : 0}`}
              title={job.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="aspect-video w-full rounded-lg border border-white/[0.08] bg-black"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-[#080B14] text-xs text-[#94A3B8]">
              Source video unavailable
            </div>
          )}

          {!hasLocalVideo && (
            <YoutubeMp4UnlockPanel
              job={job}
              onUnlocked={async () => {
                await onClipsChanged();
                setActionMsg('Source MP4 is ready! You can now render 9:16 MP4 clips with custom fonts and transitions.');
              }}
            />
          )}
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
                Timestamped Transcript &amp; Lyrics
              </h3>
              <p className="text-xs text-[#94A3B8]">
                {transcript.length} segments · Click any timestamp to jump player
              </p>
            </div>
            {hasLocalVideo && job.metadata?.hasAudio !== false && (
              <button
                type="button"
                disabled={extractingLyrics}
                onClick={handleExtractLyrics}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#20C7D9]/40 bg-[#20C7D9]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#20C7D9] hover:bg-[#20C7D9]/20 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Music className="h-3.5 w-3.5" />
                {extractingLyrics ? 'Detecting Lyrics...' : 'Extract Song Lyrics'}
              </button>
            )}
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search spoken transcript..."
              className="w-full rounded-lg border border-white/10 bg-[#080B14] py-2 pl-9 pr-3 text-xs text-[#F8FAFC] placeholder-[#94A3B8] focus:border-[#7657FF] focus:outline-none"
            />
          </div>

          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {filteredSegments.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#94A3B8]">
                No transcript segments match your filter.
              </p>
            ) : (
              filteredSegments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => seekSourceVideo(seg.start_seconds)}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#101827] p-3 text-left hover:border-[#20C7D9]/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-[#20C7D9] tabular-nums">
                      {formatTimestamp(seg.start_seconds)} – {formatTimestamp(seg.end_seconds)}
                    </span>
                    {seg.speaker_label && (
                      <span className="text-[#94A3B8]">{seg.speaker_label}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#F8FAFC]">{seg.text}</p>
                  {seg.confidence_note && (
                    <p className="mt-1 text-[11px] text-amber-300">{seg.confidence_note}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Unlimited Clips Toolbar + Candidates */}
      <div className="lg:col-span-7 space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#151E2E] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-lg font-bold text-[#F8FAFC]">
                Clips & Highlights ({clips.length})
              </h3>
              <p className="text-xs text-[#94A3B8]">
                Unlimited clipping — create custom cuts, find more AI moments, or batch render.
                {typeof job.processing_time_ms === 'number' && job.processing_time_ms > 0 && (
                  <span className="ml-2 font-mono text-[#20C7D9] tabular-nums">
                    · Analyzed in {(job.processing_time_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {hasLocalVideo && transcript.length === 0 && onJobUpdated && (
                <button
                  type="button"
                  disabled={runningAiAnalyze}
                  onClick={handleRunAiHighlights}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#20C7D9]/45 bg-[#20C7D9]/15 px-3.5 py-2 text-xs font-semibold text-[#20C7D9] hover:bg-[#20C7D9]/25 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {runningAiAnalyze ? 'Starting AI...' : 'Run AI Highlights & Lyrics'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCustomForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-[#20C7D9]/50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[#20C7D9]" />
                Custom Clip
              </button>
              {hasLocalVideo && clips.length > 0 && (
                <button
                  type="button"
                  disabled={renderingAll}
                  onClick={handleRenderAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5" />
                  {renderingAll ? 'Queuing...' : 'Render All MP4s'}
                </button>
              )}
            </div>
          </div>

          {/* Non-blocking Fallback Notice (e.g. non-speech AMV, no audio, or Gemini high demand) */}
          {job.ai_warning && (
            <div className="flex flex-col gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <span className="leading-relaxed">{job.ai_warning}</span>
              </div>
              {onRetryAnalysis && (
                <button
                  type="button"
                  disabled={retryingAnalysis}
                  onClick={onRetryAnalysis}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${retryingAnalysis ? 'animate-spin' : ''}`} />
                  {retryingAnalysis ? 'Retrying AI...' : 'Retry AI Analysis'}
                </button>
              )}
            </div>
          )}

          {/* Generate More AI Clips Bar */}
          {transcript.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-white/[0.08] pt-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={morePrompt}
                disabled={generatingMore}
                onChange={(e) => setMorePrompt(e.target.value)}
                placeholder="Optional focus (e.g. 'more tech tips', 'funny stories', or leave blank for more highlights)..."
                className="flex-1 rounded-lg border border-white/10 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
              />
              <button
                type="button"
                disabled={generatingMore}
                onClick={handleGenerateMore}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#7657FF]/50 bg-[#7657FF]/15 px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:bg-[#7657FF]/25 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#20C7D9]" />
                {generatingMore ? 'Finding More Clips...' : 'Find More AI Clips'}
              </button>
            </div>
          ) : (
            <div className="border-t border-white/[0.08] pt-3 text-xs text-[#94A3B8]">
              Scene-cut &amp; manual timeline mode active (no spoken transcript detected). Click <strong className="text-[#F8FAFC]">Custom Clip</strong> above to create unlimited cuts or render the auto-prepared clips below.
            </div>
          )}

          {/* Custom Clip Creation Drawer */}
          {showCustomForm && (
            <form
              onSubmit={handleCreateCustomClip}
              className="space-y-3 rounded-lg border border-[#20C7D9]/30 bg-[#101827] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F8FAFC]">
                  Create Unlimited Custom Clip
                </span>
                {videoRef.current && (
                  <button
                    type="button"
                    onClick={() => {
                      const t = Number((videoRef.current?.currentTime ?? 0).toFixed(1));
                      setCustomStart(t);
                      setCustomEnd(Math.min(job.duration || t + 30, Number((t + 30).toFixed(1))));
                    }}
                    className="text-[11px] text-[#20C7D9] hover:underline cursor-pointer"
                  >
                    Set Start to Current Playhead
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-[#94A3B8]">Clip Title</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Optional clip title"
                    className="mt-1 w-full rounded border border-white/15 bg-[#080B14] px-2.5 py-1.5 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8]">Start (sec)</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={job.duration > 0 ? job.duration : undefined}
                    value={customStart}
                    onChange={(e) => setCustomStart(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-white/15 bg-[#080B14] px-2.5 py-1.5 font-mono text-xs text-[#F8FAFC] tabular-nums focus:border-[#7657FF] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8]">End (sec)</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={job.duration > 0 ? job.duration : undefined}
                    value={customEnd}
                    onChange={(e) => setCustomEnd(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-white/15 bg-[#080B14] px-2.5 py-1.5 font-mono text-xs text-[#F8FAFC] tabular-nums focus:border-[#7657FF] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomForm(false)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingCustom}
                  className="rounded-lg bg-[#7657FF] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 cursor-pointer"
                >
                  {creatingCustom ? 'Adding...' : 'Add Clip'}
                </button>
              </div>
            </form>
          )}
        </div>

        {actionMsg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
            {actionMsg}
          </div>
        )}

        {actionErr && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actionErr}</span>
          </div>
        )}

        {clips.length === 0 ? (
          <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-10 text-center text-sm text-[#94A3B8]">
            No highlight candidates yet. Click “Custom Clip” or “Find More AI Clips” to add clips.
          </div>
        ) : (
          clips.map((clip, index) => {
            const clipDur = Math.max(0, clip.end_seconds - clip.start_seconds);
            const isExpanded = expandedScoreId === clip.id;
            const isRenderingThis = renderingClipId === clip.id || clip.status === 'rendering';

            return (
              <div
                key={clip.id}
                className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
                      <span className="font-mono text-[#20C7D9] tabular-nums">
                        Clip {String(index + 1).padStart(2, '0')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => seekSourceVideo(clip.start_seconds)}
                        className="font-mono text-[#F8FAFC] hover:text-[#20C7D9] underline decoration-white/20 cursor-pointer tabular-nums"
                      >
                        {formatTimestamp(clip.start_seconds)} – {formatTimestamp(clip.end_seconds)}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{clipDur.toFixed(1)}s</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize text-[#94A3B8]">
                        {clip.status === 'rendered' ? 'Exported MP4 Ready' : clip.status}
                      </span>
                      {clip.effects?.motionAnimation && clip.effects.motionAnimation !== 'none' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#CBD5E1]">
                            {clip.effects.motionAnimation === 'viral_dynamic'
                              ? 'Viral Dynamic'
                              : clip.effects.motionAnimation.replace(/_/g, ' ')}
                          </span>
                        </>
                      )}
                      {clip.effects?.introTransition && clip.effects.introTransition !== 'none' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#CBD5E1]">
                            {clip.effects.introTransition === 'flash_cut'
                              ? 'Flash Cut'
                              : clip.effects.introTransition.replace(/_/g, ' ')}
                          </span>
                        </>
                      )}
                      {clip.effects?.autoHookEnabled && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#20C7D9]">Auto Hook</span>
                        </>
                      )}
                    </div>

                    <h4 className="font-display text-base font-bold text-[#F8FAFC]">
                      {clip.title}
                    </h4>
                    <p className="text-xs text-[#20C7D9]">Opening hook: “{clip.hook || clip.summary}”</p>
                  </div>

                  {/* Explainable Score Summary */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-[11px] text-[#94A3B8]">Rubric Score</div>
                      <div className="font-mono text-2xl font-bold text-[#F8FAFC] tabular-nums">
                        {clip.score}
                        <span className="text-xs font-normal text-[#94A3B8]">/100</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Why selected + Transcript Evidence */}
                <div className="mt-4 space-y-2.5 rounded-lg border border-white/[0.06] bg-[#101827] p-3.5">
                  <div className="flex items-start gap-2 text-xs text-[#F8FAFC]">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7657FF]" />
                    <span>
                      <strong className="font-semibold">Why selected:</strong> {clip.selection_reason}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[#94A3B8]">
                    “{clip.transcript_excerpt}”
                  </p>
                </div>

                {/* Expandable 5-factor score breakdown */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setExpandedScoreId(isExpanded ? null : clip.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                  >
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isExpanded ? 'Hide score breakdown' : 'View 5-factor score breakdown'}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-3 rounded-lg border border-white/[0.06] bg-[#080B14] p-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        {[
                          ['Completeness (30%)', clip.score_breakdown.completeness],
                          ['Hook (25%)', clip.score_breakdown.hook_strength],
                          ['Utility (20%)', clip.score_breakdown.useful_information],
                          ['Emphasis (15%)', clip.score_breakdown.emotional_emphasis],
                          ['Fit (10%)', clip.score_breakdown.duration_fit],
                        ].map(([label, val]) => (
                          <div key={String(label)}>
                            <div className="text-[11px] text-[#94A3B8]">{label}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                              {val}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-[#94A3B8] border-t border-white/[0.06] pt-2.5">
                        {clip.score_breakdown.explanation}
                      </p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => onEditClip(clip)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Edit Clip & Captions
                    </button>
                    {hasLocalVideo && (
                      <button
                        type="button"
                        disabled={isRenderingThis}
                        onClick={() => onQuickRender(clip)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-4 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-[#20C7D9]/50 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <Film className="h-3.5 w-3.5 text-[#20C7D9]" />
                        {isRenderingThis
                          ? `Rendering ${clip.aspect_ratio ?? '9:16'}...`
                          : `Render ${clip.aspect_ratio ?? '9:16'} MP4`}
                      </button>
                    )}
                    <a
                      href={`/api/clips/${encodeURIComponent(clip.id)}/srt`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-[#20C7D9]" />
                      SRT
                    </a>
                  </div>

                  <button
                    type="button"
                    disabled={deletingClipId === clip.id}
                    onClick={() => handleDeleteClip(clip.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#101827] p-2 text-[#94A3B8] hover:text-rose-400 disabled:opacity-50 transition-colors cursor-pointer"
                    aria-label={`Delete ${clip.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
