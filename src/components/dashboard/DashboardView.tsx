import { useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, CheckCircle2, Clock3, Film, FolderOpen,
  LayoutGrid, ListFilter, Play, Plus, Search, Sparkles, Trash2, Upload,
  Video, Youtube, Zap, Clapperboard, Activity,
} from 'lucide-react';
import type { ExportRecord, VideoJob } from '../../types/clipforge';
import { formatBytes, formatDurationShort } from '../../utils/time';

interface DashboardViewProps {
  jobs: VideoJob[];
  exportsList: ExportRecord[];
  onNewProject: () => void;
  onOpenProject: (job: VideoJob) => void;
  onDeleteProject: (jobId: string) => void;
  onViewAllExports: () => void;
}

type Filter = 'all' | 'ready' | 'processing' | 'failed';

function getStatus(job: VideoJob) {
  if (job.status === 'ready') return { label: 'Ready', tone: 'text-emerald-300 bg-emerald-400/10 border-emerald-300/20', dot: 'bg-emerald-400' };
  if (job.status === 'failed') return { label: 'Failed', tone: 'text-rose-300 bg-rose-400/10 border-rose-300/20', dot: 'bg-rose-400' };
  return { label: `Processing ${Math.max(0, Math.min(100, job.progress))}%`, tone: 'text-cyan-200 bg-cyan-400/10 border-cyan-300/20', dot: 'bg-cyan-300 animate-pulse' };
}

function sourceLabel(job: VideoJob) {
  if (job.source_type === 'youtube') return 'YouTube';
  if (job.source_type === 'instagram') return 'Instagram';
  if (job.source_type === 'sample') return 'Sample';
  return 'Local upload';
}

function updatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function Metric({
  label, value, caption, icon: Icon, color,
}: {
  label: string; value: number; caption: string;
  icon: typeof Video; color: 'violet' | 'cyan' | 'green' | 'orange';
}) {
  const colors = {
    violet: 'bg-violet-400/10 text-violet-200 ring-violet-300/15',
    cyan: 'bg-cyan-400/10 text-cyan-200 ring-cyan-300/15',
    green: 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/15',
    orange: 'bg-orange-400/10 text-orange-200 ring-orange-300/15',
  };
  return (
    <article className="rounded-2xl border border-white/[0.075] bg-[#111827] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:bg-[#151e2d] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${colors[color]}`}><Icon size={17} /></span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <strong className="font-display text-3xl font-semibold tracking-tight text-white">{value}</strong>
        <span className="pb-1 text-[11px] text-slate-500">{caption}</span>
      </div>
    </article>
  );
}

export function DashboardView({
  jobs, exportsList, onNewProject, onOpenProject, onDeleteProject, onViewAllExports,
}: DashboardViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');

  const completedExports = exportsList.filter((item) => item.render_status === 'completed');
  const activeJobs = jobs.filter((job) => job.status !== 'ready' && job.status !== 'failed');
  const activeRenders = exportsList.filter((item) => item.render_status === 'rendering' || item.render_status === 'queued');
  const readyJobs = jobs.filter((job) => job.status === 'ready').length;

  const visibleJobs = useMemo(() => jobs.filter((job) => {
    const matchesQuery = job.title.toLowerCase().includes(query.toLowerCase());
    const matchesFilter =
      filter === 'all' ||
      (filter === 'ready' && job.status === 'ready') ||
      (filter === 'failed' && job.status === 'failed') ||
      (filter === 'processing' && job.status !== 'ready' && job.status !== 'failed');
    return matchesQuery && matchesFilter;
  }).slice(0, 6), [jobs, query, filter]);

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All projects' },
    { id: 'ready', label: 'Ready' },
    { id: 'processing', label: 'Processing' },
    { id: 'failed', label: 'Failed' },
  ];

  return (
    <main className="space-y-7 pb-10">
      {/* New dashboard header */}
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" />
            Creator workspace
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-[34px]">Good to see you<span className="text-violet-300">.</span></h1>
          <p className="mt-2 text-sm text-slate-400">Your content studio is ready. What are we creating today?</p>
        </div>
        <button type="button" onClick={onNewProject} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#090d18] shadow-lg shadow-white/5 transition hover:-translate-y-0.5 hover:bg-violet-100">
          <Plus size={17} /> New project
        </button>
      </header>

      {/* Primary action panel */}
      <section className="relative isolate overflow-hidden rounded-[26px] border border-violet-300/15 bg-[#12152a] p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_15%,rgba(124,92,255,.28),transparent_35%),radial-gradient(ellipse_at_5%_100%,rgba(34,211,238,.12),transparent_38%)]" />
        <div className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full border border-violet-200/10" />
        <div className="pointer-events-none absolute -right-4 -top-12 -z-10 h-52 w-52 rounded-full border border-cyan-200/10" />
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_310px]">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200/20 bg-violet-200/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-violet-200"><Sparkles size={13} /> AI-powered video workflow</span>
            <h2 className="mt-5 max-w-lg font-display text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">From long-form video to <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-200 bg-clip-text text-transparent">scroll-stopping clips.</span></h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-slate-400">Upload a recording or bring a YouTube link. Find the strongest moments, refine your clips and export in a few steps.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={onNewProject} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:-translate-y-0.5 hover:brightness-110"><Upload size={16} /> Start creating <ArrowRight size={15} /></button>
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3.5 py-3 text-xs text-slate-300"><Zap size={15} className="text-cyan-300" /> Local + YouTube sources</span>
            </div>
          </div>
          <div className="relative mx-auto hidden h-52 w-full max-w-[290px] lg:block">
            <div className="absolute right-3 top-5 h-40 w-52 rotate-6 rounded-2xl border border-cyan-200/20 bg-[#0b1220] shadow-2xl" />
            <div className="absolute left-2 top-0 h-44 w-56 -rotate-3 rounded-2xl border border-violet-200/20 bg-[#1b1a35] p-3 shadow-2xl shadow-violet-950/40">
              <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-widest text-slate-500"><span>Preview frame</span><span className="text-emerald-300">● Ready</span></div>
              <div className="mt-3 flex h-24 items-center justify-center rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_35%,rgba(139,92,246,.55),transparent_55%),linear-gradient(145deg,#28304b,#0d1422)]">
                <span className="grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur"><Play size={17} fill="currentColor" /></span>
              </div>
              <div className="mt-3 flex gap-1"><i className="h-1.5 flex-1 rounded-full bg-violet-400" /><i className="h-1.5 w-8 rounded-full bg-cyan-300" /><i className="h-1.5 w-5 rounded-full bg-white/10" /></div>
            </div>
            <div className="absolute -bottom-1 right-0 flex items-center gap-2 rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 shadow-xl">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200"><Activity size={16} /></span>
              <span><b className="block text-[11px] text-white">Smart highlights</b><small className="text-[9px] text-slate-500">AI-assisted discovery</small></span>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="font-display text-base font-semibold text-white">Workspace activity</h2><p className="mt-1 text-xs text-slate-500">A quick snapshot of your production pipeline.</p></div>
          <span className="hidden items-center gap-1.5 text-[10px] text-slate-500 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live data</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total projects" value={jobs.length} caption="in library" icon={FolderOpen} color="violet" />
          <Metric label="Ready to publish" value={completedExports.length} caption="completed exports" icon={CheckCircle2} color="green" />
          <Metric label="AI in progress" value={activeJobs.length} caption="active jobs" icon={Video} color="cyan" />
          <Metric label="Queued renders" value={activeRenders.length} caption="waiting or rendering" icon={Clock3} color="orange" />
        </div>
      </section>

      {/* Project library */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.075] bg-[#0f1725]">
        <div className="border-b border-white/[0.07] p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Your library</div><h2 className="mt-1 font-display text-xl font-semibold text-white">Recent projects</h2><p className="mt-1 text-xs text-slate-500">Pick up where you left off.</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-[#090f1b] px-3 py-2.5 sm:w-56">
                <Search size={15} className="shrink-0 text-slate-500" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." className="w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-600" />
              </label>
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#090f1b] p-1">
                {filters.map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`rounded-lg px-2.5 py-2 text-[10px] font-semibold transition ${filter === item.id ? 'bg-violet-500/20 text-violet-200' : 'text-slate-500 hover:text-slate-200'}`}>{item.label}</button>)}
              </div>
              <div className="flex rounded-xl border border-white/10 bg-[#090f1b] p-1">
                <button type="button" aria-label="Grid view" onClick={() => setLayout('grid')} className={`rounded-lg p-2 ${layout === 'grid' ? 'bg-white/10 text-white' : 'text-slate-500'}`}><LayoutGrid size={15} /></button>
                <button type="button" aria-label="List view" onClick={() => setLayout('list')} className={`rounded-lg p-2 ${layout === 'list' ? 'bg-white/10 text-white' : 'text-slate-500'}`}><ListFilter size={15} /></button>
              </div>
            </div>
          </div>
        </div>

        {visibleJobs.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/10 text-violet-200"><Clapperboard size={25} /></span>
            <h3 className="mt-4 font-display text-base font-semibold text-white">{jobs.length === 0 ? 'Your studio is ready' : 'No matching projects'}</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{jobs.length === 0 ? 'Create your first project using a local video or a YouTube link.' : 'Try another search or change the status filter.'}</p>
            {jobs.length === 0 && <button type="button" onClick={onNewProject} className="mt-5 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-500"><Plus size={14} className="mr-1 inline" /> Create first project</button>}
          </div>
        ) : (
          <div className={layout === 'grid' ? 'grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5' : 'divide-y divide-white/[0.06]'}>
            {visibleJobs.map((job) => {
              const status = getStatus(job);
              const progress = Math.max(0, Math.min(100, job.progress));
              return (
                <article key={job.id} className={layout === 'grid' ? 'group overflow-hidden rounded-xl border border-white/[0.08] bg-[#141e2e] transition duration-200 hover:-translate-y-1 hover:border-violet-300/30 hover:shadow-xl hover:shadow-violet-950/20' : 'group flex flex-col gap-3 px-4 py-4 transition hover:bg-white/[0.025] sm:flex-row sm:items-center sm:justify-between'}>
                  <button type="button" onClick={() => onOpenProject(job)} className={layout === 'grid' ? 'block w-full text-left' : 'flex min-w-0 flex-1 items-center gap-4 text-left'}>
                    <div className={layout === 'grid' ? 'relative flex h-36 items-center justify-center overflow-hidden bg-[#20243b]' : 'relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#20243b]'}>
                      {job.thumbnail_url ? <img src={job.thumbnail_url} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(139,92,246,.35),transparent_60%),linear-gradient(135deg,#20243b,#111827)]" />}
                      {!job.thumbnail_url && (job.source_type === 'youtube' ? <Youtube className="relative h-7 w-7 text-rose-200" /> : <Film className="relative h-7 w-7 text-violet-200" />)}
                      <span className="absolute bottom-2 left-2 rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur">{sourceLabel(job)}</span>
                      <span className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><Play size={13} fill="currentColor" /></span>
                    </div>
                    <div className={layout === 'grid' ? 'p-4' : 'min-w-0 flex-1'}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold ${status.tone}`}><i className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span>
                        {job.is_demo_mode && <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[9px] font-semibold text-amber-200">Demo</span>}
                      </div>
                      <h3 className="truncate text-sm font-semibold text-white group-hover:text-violet-200">{job.title}</h3>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-slate-500"><span>{job.resolution || 'Resolution pending'}</span>{job.duration > 0 && <span>· {formatDurationShort(job.duration)}</span>}<span>· {updatedLabel(job.updated_at)}</span></div>
                      {job.status !== 'ready' && job.status !== 'failed' && <div className="mt-3"><div className="mb-1 flex justify-between gap-2 text-[9px] text-slate-500"><span className="truncate">{job.stage_message || 'Processing video'}</span><b className="text-cyan-200">{progress}%</b></div><div className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-300 transition-all" style={{ width: `${progress}%` }} /></div></div>}
                    </div>
                  </button>
                  <div className={layout === 'grid' ? 'flex items-center justify-between border-t border-white/[0.06] px-4 py-3' : 'flex shrink-0 items-center gap-2 pl-28 sm:pl-0'}>
                    <span className="text-[10px] text-slate-600">Project workspace</span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => onOpenProject(job)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold text-slate-200 transition hover:border-violet-300/30 hover:bg-violet-400/10">Open project <ArrowRight size={12} className="ml-1 inline" /></button>
                      <button type="button" onClick={() => onDeleteProject(job.id)} title="Delete project" aria-label={`Delete project ${job.title}`} className="rounded-lg p-2 text-slate-600 transition hover:bg-rose-400/10 hover:text-rose-300"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {jobs.length > visibleJobs.length && <div className="border-t border-white/[0.06] px-5 py-3 text-center text-[10px] text-slate-500">Showing {visibleJobs.length} matching projects · {jobs.length} total</div>}
      </section>

      {/* Export activity */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.075] bg-[#0f1725]">
        <div className="flex flex-col justify-between gap-3 border-b border-white/[0.07] px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">Delivery</div><h2 className="mt-1 font-display text-lg font-semibold text-white">Recent exports</h2><p className="mt-1 text-xs text-slate-500">Finished clips, ready for your next platform.</p></div>
          <button type="button" onClick={onViewAllExports} className="inline-flex items-center gap-2 self-start rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-200 sm:self-auto">Open export center <ArrowRight size={14} /></button>
        </div>
        {completedExports.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-6"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><Film size={18} /></span><div><p className="text-sm font-medium text-slate-200">No exports yet</p><p className="mt-1 text-xs text-slate-500">Your completed clips will appear here.</p></div></div>
        ) : (
          <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
            {completedExports.slice(0, 4).map((exp) => (
              <article key={exp.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#141e2e] p-3 transition hover:border-cyan-300/20">
                <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200"><Film size={17} /></span><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{exp.clip_title}</p><p className="mt-1 truncate text-[10px] text-slate-500">{exp.resolution} · {formatDurationShort(exp.duration)} · {formatBytes(exp.file_size_bytes)}</p></div></div>
                <a href={`/api/exports/${encodeURIComponent(exp.id)}?format=mp4&download=1`} download={exp.filename} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10"><ArrowDownToLine size={13} className="text-cyan-300" /> MP4</a>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="flex items-center justify-center gap-2 pb-1 text-[10px] text-slate-600"><Sparkles size={12} className="text-violet-400" /> {readyJobs} {readyJobs === 1 ? 'project' : 'projects'} ready · Keep creating</p>
    </main>
  );
}
