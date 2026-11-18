import { AlertTriangle, Check, Loader2, RefreshCw, Scissors, Trash2 } from 'lucide-react';
import { PIPELINE_STAGES, type VideoJob } from '../../types/clipforge';
import { formatBytes, formatDurationShort } from '../../utils/time';

interface ProcessingPipelineProps {
  job: VideoJob;
  onRetry: () => void;
  onManualMode?: () => void;
  onDelete: () => void;
  retrying?: boolean;
  switchingManual?: boolean;
}

export function ProcessingPipeline({
  job,
  onRetry,
  onManualMode,
  onDelete,
  retrying = false,
  switchingManual = false,
}: ProcessingPipelineProps) {
  const isFailed = job.status === 'failed';
  const isReady = job.status === 'ready';
  const canManualClip = Boolean(job.source_video_url || job.youtube_video_id);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
              <span className="font-mono text-[#20C7D9]">{job.id}</span>
              <span aria-hidden="true">·</span>
              <span>{job.original_filename}</span>
              {job.is_demo_mode && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-amber-300">DEMO MODE (Preloaded Transcript)</span>
                </>
              )}
            </div>
            <h2 className="mt-1.5 font-display text-xl font-bold text-[#F8FAFC]">{job.title}</h2>
            <p className="mt-1 text-sm text-[#94A3B8]">{job.stage_message}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {isFailed && canManualClip && onManualMode && (
              <button
                type="button"
                disabled={switchingManual || retrying}
                onClick={onManualMode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#20C7D9]/40 bg-[#20C7D9]/15 px-4 py-2 text-xs font-semibold text-[#20C7D9] hover:bg-[#20C7D9]/25 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Scissors className="h-3.5 w-3.5" />
                {switchingManual ? 'Opening...' : 'Clip Manually (Skip AI)'}
              </button>
            )}
            {(isFailed || (isReady && Boolean(job.ai_warning))) && (
              <button
                type="button"
                disabled={retrying || switchingManual}
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Retrying...' : 'Retry AI Analysis'}
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-medium text-[#94A3B8] hover:border-rose-500/40 hover:text-rose-300 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Project
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#94A3B8]">
              {isFailed
                ? `Stopped at stage ${job.current_stage}`
                : isReady
                  ? 'Analysis complete — ready for review and vertical rendering'
                  : `Stage ${job.current_stage} of 8 active`}
            </span>
            <span className="font-mono font-semibold text-[#F8FAFC] tabular-nums">
              {job.progress}%
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#080B14]">
            <div
              className={`h-full transition-all duration-300 ${
                isFailed ? 'bg-rose-500' : isReady ? 'bg-emerald-500' : 'bg-[#7657FF]'
              }`}
              style={{ width: `${Math.max(4, job.progress)}%` }}
            />
          </div>
        </div>

        {/* Video Inspection Metadata */}
        {job.metadata && (
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/[0.08] pt-5 sm:grid-cols-5">
            <div>
              <div className="text-xs text-[#94A3B8]">Duration</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                {formatDurationShort(job.metadata.duration)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#94A3B8]">Resolution</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                {job.metadata.width}×{job.metadata.height}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#94A3B8]">Frame Rate</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                {job.metadata.fps} fps
              </div>
            </div>
            <div>
              <div className="text-xs text-[#94A3B8]">Audio Stream</div>
              <div className="mt-1 text-sm font-semibold text-[#F8FAFC]">
                {job.metadata.hasAudio ? 'Present' : 'Missing'}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#94A3B8]">File Size</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                {formatBytes(job.metadata.fileSizeBytes)}
              </div>
            </div>
          </div>
        )}

        {isFailed && job.error_message && (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="font-semibold">Processing Error</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-200/90">{job.error_message}</p>
            </div>
          </div>
        )}

        {isReady && job.ai_warning && (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div>
              <p className="font-semibold">Fallback Clipping Applied (Ready to Edit &amp; Export)</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/90">{job.ai_warning}</p>
            </div>
          </div>
        )}
      </div>

      {/* 8-Stage Pipeline Tracker */}
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6">
        <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
          8-Stage Processing Pipeline
        </h3>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE_STAGES.map((item) => {
            const completed =
              job.current_stage > item.stage ||
              (isReady && item.stage <= 6) ||
              (job.current_stage === 8 && item.stage === 8);
            const active = !isFailed && !isReady && job.current_stage === item.stage;
            const failedHere = isFailed && job.current_stage === item.stage;

            return (
              <div
                key={item.stage}
                className={`rounded-lg border p-3.5 transition-colors ${
                  failedHere
                    ? 'border-rose-500/40 bg-rose-500/10'
                    : active
                      ? 'border-[#7657FF]/60 bg-[#7657FF]/10'
                      : completed
                        ? 'border-emerald-500/30 bg-[#101827]'
                        : 'border-white/[0.06] bg-[#101827]/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                    0{item.stage}
                  </span>
                  {failedHere ? (
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                  ) : completed ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#20C7D9]" />
                  ) : (
                    <span className="text-[11px] text-[#94A3B8]">Pending</span>
                  )}
                </div>
                <p className="mt-2 text-xs font-semibold text-[#F8FAFC]">{item.label}</p>
                <p className="mt-1 text-[11px] leading-snug text-[#94A3B8]">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
