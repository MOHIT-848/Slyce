import { AlertTriangle, CheckCircle2, Download, FileText, Film, Loader2, Play, X } from 'lucide-react';
import { useState } from 'react';
import type { ExportRecord } from '../../types/clipforge';
import { formatBytes, formatDurationShort } from '../../utils/time';

interface ExportCenterProps {
  exportsList: ExportRecord[];
  title?: string;
  emptyMessage?: string;
}

export function ExportCenter({
  exportsList,
  title = 'Export Center',
  emptyMessage = 'No clips have been rendered yet. Select a candidate clip and click Render 9:16 MP4.',
}: ExportCenterProps) {
  const [previewExport, setPreviewExport] = useState<ExportRecord | null>(null);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[#F8FAFC]">{title}</h2>
            <p className="text-xs text-[#94A3B8]">
              Download real FFmpeg-encoded 9:16, 1:1, and 16:9 MP4 videos and synchronized SubRip (.srt) caption tracks.
            </p>
          </div>
          <span className="font-mono text-xs text-[#20C7D9] tabular-nums">
            {exportsList.length} {exportsList.length === 1 ? 'export' : 'exports'}
          </span>
        </div>

        {exportsList.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-white/15 bg-[#101827] p-10 text-center">
            <Film className="mx-auto h-8 w-8 text-[#94A3B8]" />
            <p className="mt-3 text-sm font-medium text-[#F8FAFC]">No exports ready yet</p>
            <p className="mt-1 text-xs text-[#94A3B8]">{emptyMessage}</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {exportsList.map((exp) => {
              const isReady = exp.render_status === 'completed';
              const isFailed = exp.render_status === 'failed';
              const isBusy = exp.render_status === 'queued' || exp.render_status === 'rendering';

              return (
                <div
                  key={exp.id}
                  className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-[#101827] p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {isReady ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Completed
                        </span>
                      ) : isFailed ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#20C7D9]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {exp.render_status === 'queued' ? 'Queued' : 'Rendering 9:16 MP4...'}
                        </span>
                      )}
                      <span aria-hidden="true" className="text-[#94A3B8]">·</span>
                      <span className="font-mono text-[#F8FAFC] tabular-nums">{exp.resolution}</span>
                      <span aria-hidden="true" className="text-[#94A3B8]">·</span>
                      <span className="font-mono text-[#94A3B8] tabular-nums">{exp.aspect_ratio}</span>
                      <span aria-hidden="true" className="text-[#94A3B8]">·</span>
                      <span className="font-mono text-[#94A3B8] tabular-nums">
                        {formatDurationShort(exp.duration)}
                      </span>
                      {isReady && (
                        <>
                          <span aria-hidden="true" className="text-[#94A3B8]">·</span>
                          <span className="font-mono text-[#94A3B8] tabular-nums">
                            {formatBytes(exp.file_size_bytes)}
                          </span>
                        </>
                      )}
                    </div>

                    <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
                      {exp.clip_title}
                    </h3>
                    <p className="font-mono text-xs text-[#94A3B8]">
                      {exp.filename} · {exp.has_burned_subtitles ? `Burned subtitles (${exp.subtitle_style.replace('_', ' ')})` : 'Clean video (SRT separate)'} · {exp.framing_mode === 'blurred_background' ? 'Blurred fill' : exp.framing_mode === 'subject_crop' ? 'Subject crop' : 'Auto center crop'}
                    </p>
                    {isFailed && exp.error_message && (
                      <p className="text-xs text-rose-300">{exp.error_message}</p>
                    )}
                  </div>

                  {isReady && (
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewExport(exp)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#151E2E] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-[#20C7D9]/50 transition-colors cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5 text-[#20C7D9]" />
                        Preview Output
                      </button>
                      <a
                        href={`/api/exports/${encodeURIComponent(exp.id)}?format=mp4&download=1`}
                        download={exp.filename}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download MP4
                      </a>
                      <a
                        href={`/api/exports/${encodeURIComponent(exp.id)}?format=srt&download=1`}
                        download={exp.srt_filename}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#151E2E] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 transition-colors"
                      >
                        <FileText className="h-3.5 w-3.5 text-[#20C7D9]" />
                        Download SRT ({formatBytes(exp.srt_size_bytes)})
                      </a>
                    </div>
                  )}

                  {isBusy && (
                    <div className="text-xs text-[#94A3B8] shrink-0">
                      Encoding H.264/AAC...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline Rendered Vertical MP4 Verification Modal */}
      {previewExport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div
            className={`w-full rounded-xl border border-white/15 bg-[#151E2E] p-5 ${
              previewExport.aspect_ratio === '16:9' ? 'max-w-2xl' : 'max-w-md'
            }`}
          >
            <div className="flex items-start justify-between gap-3 pb-3">
              <div>
                <h3 className="font-display text-sm font-bold text-[#F8FAFC]">
                  {previewExport.clip_title}
                </h3>
                <p className="font-mono text-xs text-[#94A3B8] tabular-nums">
                  Rendered File · {previewExport.aspect_ratio} ({previewExport.resolution}) · {formatBytes(previewExport.file_size_bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewExport(null)}
                className="rounded-lg border border-white/10 p-1.5 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className={`mx-auto max-h-[65vh] w-full overflow-hidden rounded-lg border border-white/10 bg-black ${
                previewExport.aspect_ratio === '16:9'
                  ? 'aspect-video max-w-[540px]'
                  : previewExport.aspect_ratio === '1:1'
                    ? 'aspect-square max-w-[380px]'
                    : 'aspect-[9/16] max-w-[320px]'
              }`}
            >
              <video
                src={`/api/exports/${encodeURIComponent(previewExport.id)}?format=mp4`}
                controls
                autoPlay
                className="h-full w-full object-contain"
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2.5">
              <a
                href={`/api/exports/${encodeURIComponent(previewExport.id)}?format=srt&download=1`}
                download={previewExport.srt_filename}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC]"
              >
                <FileText className="h-3.5 w-3.5 text-[#20C7D9]" />
                SRT
              </a>
              <a
                href={`/api/exports/${encodeURIComponent(previewExport.id)}?format=mp4&download=1`}
                download={previewExport.filename}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-4 py-2 text-xs font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Download MP4
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
