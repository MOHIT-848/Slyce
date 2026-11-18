import {
  Download,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  Menu,
  Plus,
  Settings,
  Trash2,
  X,
  Search,
Grid2X2,
List,
ArrowUpDown,
Video,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipEditor } from './components/editor/ClipEditor';
import { ExportCenter } from './components/export/ExportCenter';
import { LandingPage } from './components/LandingPage';
import { HelpView, SettingsView } from './components/SettingsAndHelp';
import { TranscriptAndHighlights } from './components/clips/TranscriptAndHighlights';
import { DashboardView } from './components/dashboard/DashboardView';
import { VideoUploadPanel } from './components/upload/VideoUploadPanel';
import { ProcessingPipeline } from './components/video/ProcessingPipeline';
import {
  deleteJob,
  fetchAllExports,
  fetchClips,
  fetchHealth,
  fetchJob,
  fetchJobExports,
  fetchJobs,
  fetchTranscript,
  renderClip,
  restoreProjectsSnapshot,
  retryJob,
  switchJobToManualMode,
} from './services/apiClient';
import {
  DEFAULT_RECIPE_CONFIG,
  type ClipCandidate,
  type ExportRecord,
  type HealthStatus,
  type RecipeConfig,
  type TranscriptSegment,
  type VideoJob,
} from './types/clipforge';
import { formatDurationShort } from './utils/time';

type NavTab = 'dashboard' | 'new_project' | 'projects' | 'exports' | 'settings' | 'help' | 'project_detail';
type ProjectSubTab = 'pipeline' | 'highlights' | 'editor' | 'exports';

const UI_STATE_KEY = 'slyce_ui_state_v1';
const SAVED_PROJECTS_KEY = 'slyce_saved_projects_v1';

interface PersistedUiState {
  inWorkspace: boolean;
  activeNav: NavTab;
  activeJobId: string | null;
  projectTab: ProjectSubTab;
  selectedClipId: string | null;
  recipeConfig: RecipeConfig;
}

interface PersistedProjectsSnapshot {
  jobs: VideoJob[];
  transcripts: Record<string, TranscriptSegment[]>;
  clipsByJob: Record<string, ClipCandidate[]>;
  exports: ExportRecord[];
}

function readPersistedUiState(): Partial<PersistedUiState> {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedUiState>;
  } catch {
    return {};
  }
}

function readSavedProjects(): PersistedProjectsSnapshot {
  try {
    const raw = localStorage.getItem(SAVED_PROJECTS_KEY);
    if (!raw) return { jobs: [], transcripts: {}, clipsByJob: {}, exports: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedProjectsSnapshot>;
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      transcripts: parsed.transcripts && typeof parsed.transcripts === 'object' ? parsed.transcripts : {},
      clipsByJob: parsed.clipsByJob && typeof parsed.clipsByJob === 'object' ? parsed.clipsByJob : {},
      exports: Array.isArray(parsed.exports) ? parsed.exports : [],
    };
  } catch {
    return { jobs: [], transcripts: {}, clipsByJob: {}, exports: [] };
  }
}

function writeSavedProjects(snapshot: PersistedProjectsSnapshot): void {
  try {
    localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore localStorage quota exceeded
  }
}

export default function App() {
  const initialUi = useRef<Partial<PersistedUiState> | null>(null);
  if (initialUi.current === null) {
    initialUi.current = readPersistedUiState();
  }

  const [inWorkspace, setInWorkspace] = useState<boolean>(() => Boolean(initialUi.current?.inWorkspace));
  const [activeNav, setActiveNav] = useState<NavTab>(() => initialUi.current?.activeNav || 'dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [jobs, setJobs] = useState<VideoJob[]>(() => readSavedProjects().jobs);
  const [allExports, setAllExports] = useState<ExportRecord[]>(() => readSavedProjects().exports);

  // Active project workspace state
  const [activeJob, setActiveJob] = useState<VideoJob | null>(null);
  const [projectTab, setProjectTab] = useState<ProjectSubTab>(() => initialUi.current?.projectTab || 'pipeline');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [jobExports, setJobExports] = useState<ExportRecord[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => initialUi.current?.selectedClipId || null);
  const [renderingClipId, setRenderingClipId] = useState<string | null>(null);
  const [retryingJob, setRetryingJob] = useState(false);
  const [switchingManual, setSwitchingManual] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [recipeConfig, setRecipeConfig] = useState<RecipeConfig>(() => ({
    ...DEFAULT_RECIPE_CONFIG,
    ...(initialUi.current?.recipeConfig ?? {}),
  }));
  // My Projects page controls
const [projectSearch, setProjectSearch] = useState('');
const [projectStatusFilter, setProjectStatusFilter] = useState('all');
const [projectSort, setProjectSort] = useState('newest');
const [projectView, setProjectView] = useState<'grid' | 'list'>('grid');

  const restoreAttemptedRef = useRef(false);
  const pendingResumeJobIdRef = useRef<string | null>(initialUi.current?.activeJobId ?? null);

  const loadProjectDetails = useCallback(async (jobId: string) => {
    try {
      const [jobRes, txRes, clipRes, expRes] = await Promise.all([
        fetchJob(jobId),
        fetchTranscript(jobId),
        fetchClips(jobId),
        fetchJobExports(jobId),
      ]);
      setActiveJob(jobRes.job);
      setTranscript(txRes.segments);
      setClips(clipRes.clips);
      setJobExports(expRes.exports);
      return jobRes.job;
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to load project.');
      return null;
    }
  }, []);

  const loadGlobalData = useCallback(async () => {
    try {
      const [h, j, e] = await Promise.all([fetchHealth(), fetchJobs(), fetchAllExports()]);
      setHealth(h);
      let effectiveJobs = j.jobs;
      let effectiveExports = e.exports;

      // Re-hydrate any client-saved projects that were cleared by a server restart
      if (!restoreAttemptedRef.current) {
        restoreAttemptedRef.current = true;
        const saved = readSavedProjects();
        const serverIds = new Set(effectiveJobs.map((item) => item.id));
        const missingJobs = saved.jobs.filter((sj) => !serverIds.has(sj.id));
        if (missingJobs.length > 0) {
          const missingIds = new Set(missingJobs.map((m) => m.id));
          const missingTranscripts: Record<string, TranscriptSegment[]> = {};
          const missingClips: ClipCandidate[] = [];
          for (const id of missingIds) {
            if (Array.isArray(saved.transcripts[id])) {
              missingTranscripts[id] = saved.transcripts[id];
            }
            if (Array.isArray(saved.clipsByJob[id])) {
              missingClips.push(...saved.clipsByJob[id]);
            }
          }
          const missingExports = saved.exports.filter((ex) => missingIds.has(ex.job_id));
          try {
            const restored = await restoreProjectsSnapshot({
              jobs: missingJobs,
              transcripts: missingTranscripts,
              clips: missingClips,
              exports: missingExports,
            });
            effectiveJobs = restored.jobs;
            const refreshedExp = await fetchAllExports().catch(() => null);
            if (refreshedExp) effectiveExports = refreshedExp.exports;
          } catch {
            // Keep server state if restore fails transiently
          }
        }
      }

      setJobs(effectiveJobs);
      setAllExports(effectiveExports);

      // Resume previously active project across page reloads / server restarts
      if (pendingResumeJobIdRef.current) {
        const targetId = pendingResumeJobIdRef.current;
        pendingResumeJobIdRef.current = null;
        const target = effectiveJobs.find((item) => item.id === targetId);
        if (target) {
          setActiveJob(target);
          loadProjectDetails(target.id);
        } else if (activeNav === 'project_detail') {
          setActiveNav('projects');
        }
      }
    } catch {
      // Ignore transient poll failure
    }
  }, [activeNav, loadProjectDetails]);

  useEffect(() => {
    loadGlobalData();
  }, [loadGlobalData]);

  // Persist UI session state cleanly across browser/server restarts
  useEffect(() => {
    try {
      const payload: PersistedUiState = {
        inWorkspace,
        activeNav,
        activeJobId: activeJob?.id ?? pendingResumeJobIdRef.current ?? null,
        projectTab,
        selectedClipId,
        recipeConfig,
      };
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage error
    }
  }, [inWorkspace, activeNav, activeJob?.id, projectTab, selectedClipId, recipeConfig]);

  // Keep saved project snapshots synchronized in localStorage
  useEffect(() => {
    if (jobs.length === 0 && !activeJob) return;
    const prev = readSavedProjects();
    const nextTranscripts = { ...prev.transcripts };
    const nextClipsByJob = { ...prev.clipsByJob };
    if (activeJob) {
      nextTranscripts[activeJob.id] = transcript;
      nextClipsByJob[activeJob.id] = clips;
    }
    writeSavedProjects({
      jobs,
      transcripts: nextTranscripts,
      clipsByJob: nextClipsByJob,
      exports: allExports,
    });
  }, [jobs, allExports, activeJob, transcript, clips]);

  // Poll active project job status while analyzing or while any export is rendering
  useEffect(() => {
    if (!inWorkspace || !activeJob) return;

    const jobBusy = activeJob.status !== 'ready' && activeJob.status !== 'failed';
    const exportBusy = jobExports.some(
      (e) => e.render_status === 'queued' || e.render_status === 'rendering'
    );

    if (!jobBusy && !exportBusy) return;

    const timer = setInterval(async () => {
      const updated = await loadProjectDetails(activeJob.id);
      if (updated && updated.status === 'ready' && projectTab === 'pipeline') {
        setProjectTab('highlights');
      }
      loadGlobalData();
    }, 1500);

    return () => clearInterval(timer);
  }, [inWorkspace, activeJob, jobExports, projectTab, loadProjectDetails, loadGlobalData]);

  function openProject(job: VideoJob) {
    setGlobalError(null);
    setActiveJob(job);
    setSelectedClipId(null);
    setActiveNav('project_detail');
    setProjectTab(job.status === 'ready' ? 'highlights' : 'pipeline');
    loadProjectDetails(job.id);
    setMobileMenuOpen(false);
  }

  async function handleJobCreated(job: VideoJob) {
    setGlobalError(null);
    await loadGlobalData();
    openProject(job);
  }

  async function handleDeleteProject(jobId: string) {
    try {
      await deleteJob(jobId);
      const prev = readSavedProjects();
      delete prev.transcripts[jobId];
      delete prev.clipsByJob[jobId];
      writeSavedProjects({
        jobs: prev.jobs.filter((j) => j.id !== jobId),
        transcripts: prev.transcripts,
        clipsByJob: prev.clipsByJob,
        exports: prev.exports.filter((ex) => ex.job_id !== jobId),
      });
      if (activeJob?.id === jobId) {
        setActiveJob(null);
        setClips([]);
        setTranscript([]);
        setJobExports([]);
        setActiveNav('dashboard');
      }
      await loadGlobalData();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to delete project.');
    }
  }

  async function handleRetryJob() {
    if (!activeJob) return;
    setRetryingJob(true);
    setGlobalError(null);
    try {
      const res = await retryJob(activeJob.id);
      setActiveJob(res.job);
      setProjectTab('pipeline');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to retry job.');
    } finally {
      setRetryingJob(false);
    }
  }

  async function handleManualMode() {
    if (!activeJob) return;
    setSwitchingManual(true);
    setGlobalError(null);
    try {
      const res = await switchJobToManualMode(activeJob.id);
      setActiveJob(res.job);
      await Promise.all([loadProjectDetails(activeJob.id), loadGlobalData()]);
      setProjectTab('highlights');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to switch to manual clipping mode.');
    } finally {
      setSwitchingManual(false);
    }
  }

  async function handleQuickRender(clip: ClipCandidate) {
    setGlobalError(null);
    setRenderingClipId(clip.id);
    try {
      await renderClip(clip.id);
      if (activeJob) {
        await loadProjectDetails(activeJob.id);
      }
      setProjectTab('exports');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to enqueue render.');
    } finally {
      setRenderingClipId(null);
    }
  }

  if (!inWorkspace) {
    return (
      <LandingPage
        recipeConfig={recipeConfig}
        onRecipeChange={setRecipeConfig}
        onStartCreating={() => {
          setInWorkspace(true);
          setActiveNav('new_project');
        }}
        onOpenSamples={() => {
          setInWorkspace(true);
          setActiveNav('new_project');
        }}
      />
    );
  }

  const editingClip = clips.find((c) => c.id === selectedClipId) ?? clips[0] ?? null;

// Filter and sort projects
const filteredProjects = jobs
  .filter((job) => {
    // Search by project title or ID
    const matchesSearch =
      job.title.toLowerCase().includes(projectSearch.toLowerCase()) ||
      job.id.toLowerCase().includes(projectSearch.toLowerCase());

    // Filter by project status
    const matchesStatus =
      projectStatusFilter === 'all' ||
      (projectStatusFilter === 'ready' && job.status === 'ready') ||
      (projectStatusFilter === 'failed' && job.status === 'failed') ||
      (projectStatusFilter === 'processing' &&
        !['ready', 'failed'].includes(job.status));

    return matchesSearch && matchesStatus;
  })
  .sort((a, b) => {
    switch (projectSort) {
      case 'name':
        return a.title.localeCompare(b.title);

      case 'duration':
        return b.duration - a.duration;

      case 'oldest':
      case 'newest': {
        // Supports either common API timestamp naming convention
        const getDate = (job: typeof a) => {
          const item = job as typeof job & {
            created_at?: string;
            createdAt?: string;
          };

          return new Date(
            item.created_at ?? item.createdAt ?? 0
          ).getTime();
        };

        return projectSort === 'newest'
          ? getDate(b) - getDate(a)
          : getDate(a) - getDate(b);
      }

      default:
        return 0;
    }
  });


  const navItems: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'new_project', label: 'New Project', icon: Plus },
    { id: 'projects', label: 'My Projects', icon: FolderOpen },
    { id: 'exports', label: 'Recent Exports', icon: Download },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'help', label: 'Help', icon: HelpCircle },
  ];

  return (
    <div className="min-h-screen bg-[#080B14] text-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#101827] px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setInWorkspace(false)}
          className="group inline-flex items-center gap-2 font-display text-base font-extrabold tracking-tight text-[#F8FAFC] cursor-pointer"
        >
          <img
            src="/src/assets/images/slyce_logo_mark_1794936097205.jpg"
            alt="SLYCE logo"
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded-md border border-white/15 object-cover transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-3"
          />
          <span className="transition-colors group-hover:text-[#20C7D9]">SLYCE</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="rounded-lg border border-white/10 p-2 text-[#F8FAFC]"
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      
{/* SLYCE PREMIUM SIDEBAR V2 */}
<aside
  className={`${
    mobileMenuOpen ? 'flex' : 'hidden'
  } lg:flex w-full lg:w-[280px] shrink-0 flex-col justify-between
  min-h-[calc(100vh-57px)] lg:min-h-screen lg:sticky lg:top-0
  border-r border-white/[0.07]
  bg-[#0C1220] relative overflow-hidden`}
>
  {/* Ambient background glow */}
  <div className="absolute top-0 left-0 w-full h-64
    bg-gradient-to-b from-[#7657FF]/[0.09] to-transparent
    pointer-events-none" />

  <div className="relative z-10 p-5">

    {/* BRAND LOGO */}
    <button
      type="button"
      onClick={() => setInWorkspace(false)}
      className="group hidden lg:flex items-center gap-3
        w-full mb-10 text-left cursor-pointer"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-xl
          bg-[#7657FF] blur-lg opacity-30
          group-hover:opacity-60 transition-opacity" />
        <img
          src="/src/assets/images/slyce_logo_mark_1794936097205.jpg"
          alt="SLYCE"
          referrerPolicy="no-referrer"
          className="relative h-10 w-10 rounded-xl
            border border-white/15 object-cover
            transition-transform duration-300
            group-hover:scale-105 group-hover:rotate-3"
        />
      </div>

      <div>
        <span className="text-xl font-extrabold tracking-tight
          text-white font-display group-hover:text-[#20C7D9]
          transition-colors">
          SLYCE
        </span>
        <p className="text-[9px] tracking-[0.24em]
          text-slate-500 uppercase font-semibold">
          AI Video Studio
        </p>
      </div>
    </button>

    {/* NAVIGATION LABEL */}
    <div className="mb-3 px-3 flex items-center justify-between">
      <span className="text-[10px] font-bold tracking-[0.2em]
        uppercase text-slate-500">
        Workspace
      </span>
      <span className="h-1.5 w-1.5 rounded-full bg-[#20C7D9]
        shadow-[0_0_8px_#20C7D9]" />
    </div>

    {/* NAVIGATION */}
    <nav className="space-y-1.5">
      {navItems.map((item) => {
        const Icon = item.icon;

        const isActive =
          activeNav === item.id ||
          (activeNav === 'project_detail' && item.id === 'projects');

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveNav(item.id);
              setMobileMenuOpen(false);
            }}
            className={`group relative flex w-full items-center
              gap-3.5 rounded-xl px-3.5 py-3
              text-sm font-medium cursor-pointer
              transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-[#7657FF]/20 to-[#20C7D9]/[0.06] text-white border border-[#7657FF]/25 shadow-[0_5px_20px_rgba(118,87,255,0.08)]'
                  : 'border border-transparent text-slate-400 hover:text-white hover:bg-white/[0.045] hover:translate-x-1'
              }`}
          >
            {/* Active indicator */}
            {isActive && (
              <span className="absolute left-0 top-2.5 bottom-2.5
                w-[3px] rounded-full
                bg-gradient-to-b from-[#7657FF] to-[#20C7D9]
                shadow-[0_0_10px_#7657FF]" />
            )}

            <span className={`flex h-9 w-9 items-center
              justify-center rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-[#7657FF]/20 text-[#A99AFF]'
                  : 'bg-white/[0.035] text-slate-500 group-hover:text-[#20C7D9] group-hover:bg-[#20C7D9]/10'
              }`}>
              <Icon className="h-[18px] w-[18px] shrink-0" />
            </span>

            <span className="flex-1 text-left whitespace-nowrap">
              {item.label}
            </span>

            {isActive && (
              <span className="h-1.5 w-1.5 rounded-full
                bg-[#20C7D9] shadow-[0_0_8px_#20C7D9]" />
            )}
          </button>
        );
      })}
    </nav>

    {/* CURRENT PROJECT */}
    {activeJob && (
      <div className="mt-9">
        <div className="mb-3 flex items-center justify-between px-2">
          <span className="text-[10px] font-bold tracking-[0.18em]
            uppercase text-slate-500">
            Active Project
          </span>
          <span className="text-[10px] text-slate-600">01</span>
        </div>

        <button
          type="button"
          onClick={() => {
            setActiveNav('project_detail');
            setMobileMenuOpen(false);
          }}
          className="group w-full rounded-2xl border
            border-white/[0.07] bg-gradient-to-br
            from-[#151E30] to-[#101827] p-4 text-left
            hover:border-[#7657FF]/40
            hover:shadow-[0_8px_25px_rgba(118,87,255,0.10)]
            transition-all duration-300 cursor-pointer"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center
              rounded-lg bg-[#7657FF]/15 text-[#A99AFF]">
              <FolderOpen className="h-4 w-4" />
            </div>

            <span className={`rounded-full px-2 py-1 text-[9px]
              font-bold uppercase tracking-wider ${
                activeJob.status === 'ready'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : activeJob.status === 'failed'
                    ? 'bg-rose-500/10 text-rose-400'
                    : 'bg-amber-500/10 text-amber-400'
              }`}>
              {activeJob.status}
            </span>
          </div>

          <p className="truncate text-xs font-bold text-white
            group-hover:text-[#20C7D9] transition-colors">
            {activeJob.title}
          </p>

          <p className="mt-2 font-mono text-[11px]
            text-slate-400 tabular-nums">
            {activeJob.status === 'ready'
              ? `${clips.length} clips ready`
              : activeJob.status === 'failed'
                ? 'Processing failed'
                : `${activeJob.progress}% processing`}
          </p>

          {activeJob.status !== 'ready' &&
            activeJob.status !== 'failed' && (
              <div className="mt-3 h-1 w-full overflow-hidden
                rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full
                    bg-gradient-to-r from-[#7657FF] to-[#20C7D9]
                    transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, activeJob.progress))}%`
                  }}
                />
              </div>
            )}
        </button>
      </div>
    )}
  </div>

  {/* SIDEBAR FOOTER */}
  <div className="relative z-10 border-t border-white/[0.07] p-5">
    <button
      type="button"
      onClick={() => setInWorkspace(false)}
      className="group flex w-full items-center gap-3
        rounded-xl px-3 py-3 text-xs font-medium
        text-slate-500 hover:text-white
        hover:bg-white/[0.04] transition-all cursor-pointer"
    >
      <span className="flex h-8 w-8 items-center justify-center
        rounded-lg bg-white/[0.04]
        group-hover:bg-[#7657FF]/15
        group-hover:text-[#A99AFF] transition-all">
        <LayoutDashboard className="h-4 w-4" />
      </span>

      <span>Back to Overview</span>

      <span className="ml-auto opacity-0
        group-hover:opacity-100 transition-opacity">
        →
      </span>
    </button>

    <div className="mt-4 flex items-center justify-between
      px-3 text-[9px] tracking-wider text-slate-600">
      <span>SLYCE STUDIO</span>
      <span>V2.0</span>
    </div>
  </div>
</aside>
{/* END SIDEBAR V2 */}


      {/* Main Content Viewport */}
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {globalError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
              <span>{globalError}</span>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="text-rose-300 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeNav === 'dashboard' && (
            <DashboardView
              jobs={jobs}
              exportsList={allExports}
              onNewProject={() => setActiveNav('new_project')}
              onOpenProject={openProject}
              onDeleteProject={handleDeleteProject}
              onViewAllExports={() => setActiveNav('exports')}
            />
          )}

          {activeNav === 'new_project' && (
            <VideoUploadPanel
              health={health}
              recipeConfig={recipeConfig}
              onRecipeChange={setRecipeConfig}
              onJobCreated={handleJobCreated}
              onRefreshHealth={loadGlobalData}
            />
          )}

          
{activeNav === 'projects' && (
  <div className="space-y-8 animate-caption-fade">

    {/* Page Header */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#A78BFA]">
          <span className="h-2 w-2 rounded-full bg-[#20C7D9]" />
          Your Workspace
        </div>

        <h1 className="mt-3 font-display text-3xl font-bold text-white">
          My Projects
        </h1>

        <p className="mt-2 text-sm text-[#94A3B8]">
          Manage, revisit and organize your video creations.
        </p>
      </div>

      <button
        onClick={() => setActiveNav('new_project')}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7657FF] to-[#9B5CFF] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition-all hover:-translate-y-1 hover:shadow-purple-500/40"
      >
        <Plus className="h-4 w-4" />
        Create Project
      </button>
    </div>

    {/* Project Statistics */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

      {[
        {
          label: 'Total Projects',
          value: jobs.length,
          icon: FolderOpen,
          color: 'text-purple-400',
          bg: 'bg-purple-500/10'
        },
        {
          label: 'Completed',
          value: jobs.filter(j => j.status === 'ready').length,
          icon: LayoutDashboard,
          color: 'text-emerald-400',
          bg: 'bg-emerald-500/10'
        },
        {
          label: 'Processing',
          value: jobs.filter(j =>
            !['ready', 'failed'].includes(j.status)
          ).length,
          icon: Download,
          color: 'text-cyan-400',
          bg: 'bg-cyan-500/10'
        },
        {
          label: 'Failed',
          value: jobs.filter(j => j.status === 'failed').length,
          icon: Trash2,
          color: 'text-rose-400',
          bg: 'bg-rose-500/10'
        }
      ].map((stat) => {
        const Icon = stat.icon;

        return (
          <div
            key={stat.label}
            className="slyce-hover-card rounded-2xl border border-white/[0.07] bg-[#111827] p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#94A3B8]">
                {stat.label}
              </span>

              <div className={`rounded-xl p-2 ${stat.bg}`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </div>

            <p className="mt-4 font-display text-3xl font-bold text-white tabular-nums">
              {stat.value}
            </p>
          </div>
        );
      })}
    </div>

    {/* Projects Library */}
    <div className="rounded-2xl border border-white/[0.07] bg-[#111827] p-5 sm:p-7">

      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-white">
            Project Library
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            All your uploaded and processed videos in one place.
          </p>
        </div>

        <span className="rounded-full border border-white/10 bg-[#080B14] px-3 py-1.5 text-xs text-[#94A3B8]">
          {jobs.length} Projects
        </span>
      </div>
      {/* Search and Filters */}

{/* Search, Filters and View Controls */}
<div className="mb-6 flex flex-col gap-3">

  <div className="flex flex-col gap-3 md:flex-row md:items-center">

    {/* Search Bar */}
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />

      <input
        type="text"
        placeholder="Search projects..."
        value={projectSearch}
        onChange={(e) => setProjectSearch(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#101827] py-3 pl-10 pr-4 text-sm text-white outline-none focus:border-purple-500"
      />
    </div>

    {/* Status Filter */}
    <select
      value={projectStatusFilter}
      onChange={(e) => setProjectStatusFilter(e.target.value)}
      className="rounded-xl border border-white/10 bg-[#101827] px-4 py-3 text-sm text-white"
    >
      <option value="all">All Projects</option>
      <option value="ready">Completed</option>
      <option value="processing">Processing</option>
      <option value="failed">Failed</option>
    </select>

    {/* Sort Projects */}
    <select
      value={projectSort}
      onChange={(e) => setProjectSort(e.target.value)}
      className="rounded-xl border border-white/10 bg-[#101827] px-4 py-3 text-sm text-white"
    >
      <option value="name">Name A-Z</option>
      <option value="duration">Longest Duration</option>
      <option value="newest">Newest First</option>
      <option value="oldest">Oldest First</option>
    </select>

    {/* Grid and List View */}
    <div className="flex gap-1 rounded-xl border border-white/10 bg-[#101827] p-1">

      <button
        onClick={() => setProjectView('grid')}
        className={`rounded-lg p-2 ${
          projectView === 'grid'
            ? 'bg-purple-600 text-white'
            : 'text-gray-400 hover:text-white'
        }`}
        title="Grid View"
      >
        <Grid2X2 size={18} />
      </button>

      <button
        onClick={() => setProjectView('list')}
        className={`rounded-lg p-2 ${
          projectView === 'list'
            ? 'bg-purple-600 text-white'
            : 'text-gray-400 hover:text-white'
        }`}
        title="List View"
      >
        <List size={18} />
      </button>

    </div>

  </div>
</div>


      {filteredProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 rounded-2xl bg-purple-500/10 p-5">
            <FolderOpen className="h-9 w-9 text-purple-400" />
          </div>

          <h3 className="text-lg font-bold text-white">
            Your library is empty
          </h3>

          <p className="mt-2 max-w-sm text-sm text-[#64748B]">
            Start your first video project and let SLYCE
            transform long videos into engaging clips.
          </p>

          <button
            onClick={() => setActiveNav('new_project')}
            className="mt-6 rounded-xl bg-[#7657FF] px-5 py-3 text-sm font-semibold text-white hover:bg-[#6444F5]"
          >
            <Plus className="mr-2 inline h-4 w-4" />
            Create First Project
          </button>
        </div>
      ) : (
      <div
  className={
    projectView === 'grid'
      ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'
      : 'flex flex-col gap-4'
  }
>

        {filteredProjects.map((job) => (
          
            
<div
  key={job.id}
  className={`slyce-hover-card group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0B1220] ${
    projectView === 'list'
      ? 'flex flex-row items-stretch'
      : 'flex flex-col'
  }`}
>

              {/* Thumbnail Placeholder */}
            
<div
  className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#24204B] via-[#17243D] to-[#0B1220] ${
    projectView === 'list'
      ? 'w-40 min-w-40 min-h-36 self-stretch'
      : 'h-36 w-full'
  }`}



>
  {/* Real Video Thumbnail */}
{job.thumbnail_url && (
  <img
    src={job.thumbnail_url}
    alt={job.title}
    className="absolute inset-0 h-full w-full object-cover"
    loading="lazy"
  />
)}

                <div className="absolute inset-0 opacity-30"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at 50% 50%, #7657FF 0%, transparent 65%)'
                  }}
                />

                
{!job.thumbnail_url && (
  <div className="relative rounded-full border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
    <FolderOpen className="h-7 w-7 text-purple-300" />
  </div>
)}


               
<span
  className={`absolute left-4 top-4 rounded-md border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-[10px] text-[#CBD5E1] ${
    projectView === 'list' ? 'hidden' : ''
  }`}
>
  VIDEO PROJECT
</span>


                <span className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  job.status === 'ready'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : job.status === 'failed'
                    ? 'bg-rose-500/15 text-rose-400'
                    : 'bg-cyan-500/15 text-cyan-400'
                }`}>
                  {job.status.toUpperCase()}
                </span>
              </div>

              {/* Project Details */}
             
<div
  className={`p-5 flex-1 min-w-0 ${
    projectView === 'list'
      ? 'flex flex-col justify-center'
      : ''
  }`}
>


                <h3 className="truncate text-base font-bold text-white">
                  {job.title}
                </h3>

                <p className="mt-2 truncate font-mono text-[10px] text-[#64748B]">
                  ID: {job.id}
                </p>

                <div className="mt-4 flex items-center justify-between text-xs text-[#94A3B8]">
                  <span>Duration</span>
                  <span className="font-mono text-white">
                    {formatDurationShort(job.duration)}
                  </span>
                </div>

                {job.status !== 'ready' && job.status !== 'failed' && (
                  <div className="mt-3">
                    <div className="mb-2 flex justify-between text-[11px]">
                      <span className="text-[#94A3B8]">Processing</span>
                      <span className="text-cyan-400">
                        {job.progress}%
                      </span>
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400 transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(0, job.progress))}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-5 flex items-center gap-2 border-t border-white/[0.07] pt-4">

                  <button
                    onClick={() => openProject(job)}
                    className="flex-1 rounded-lg bg-[#7657FF] py-2.5 text-xs font-semibold text-white transition-all hover:bg-[#6444F5]"
                  >
                    Open Project
                  </button>

                  <button
                   onClick={() => handleDeleteProject(job.id)}
                    title="Delete project"
                    className="rounded-lg border border-white/10 p-2.5 text-[#94A3B8] transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                </div>
              </div>
            </div>
          ))}

        </div>
      )}
    </div>
  </div>
)}

          {activeNav === 'settings' && (
            <SettingsView health={health} onRefreshHealth={loadGlobalData} />
          )}

          {activeNav === 'help' && <HelpView />}

          {activeNav === 'project_detail' && activeJob && (
            <div className="space-y-6">
              {/* Project Sub-Navigation */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                    <button
                      type="button"
                      onClick={() => setActiveNav('projects')}
                      className="hover:text-[#F8FAFC] cursor-pointer"
                    >
                      Projects
                    </button>
                    <span aria-hidden="true">/</span>
                    <span className="text-[#F8FAFC] font-medium">{activeJob.title}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#101827] p-1">
                  {(
                    [
                      ['pipeline', 'Pipeline'],
                      ['highlights', `Transcript & Highlights (${clips.length})`],
                      ['editor', 'Clip Editor'],
                      ['exports', `Exports (${jobExports.length})`],
                    ] as Array<[ProjectSubTab, string]>
                  ).map(([tabId, label]) => (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => setProjectTab(tabId)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        projectTab === tabId
                          ? 'bg-[#7657FF] text-white'
                          : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {projectTab === 'pipeline' && (
                <ProcessingPipeline
                  job={activeJob}
                  onRetry={handleRetryJob}
                  onManualMode={handleManualMode}
                  onDelete={() => handleDeleteProject(activeJob.id)}
                  retrying={retryingJob}
                  switchingManual={switchingManual}
                />
              )}

              {projectTab === 'highlights' && (
                <TranscriptAndHighlights
                  job={activeJob}
                  transcript={transcript}
                  clips={clips}
                  onEditClip={(clip) => {
                    setSelectedClipId(clip.id);
                    setProjectTab('editor');
                  }}
                  onQuickRender={handleQuickRender}
                  onClipsChanged={async () => {
                    await loadProjectDetails(activeJob.id);
                  }}
                  onJobUpdated={(updated) => {
                    setActiveJob(updated);
                    if (updated.status !== 'ready' && updated.status !== 'failed') {
                      setProjectTab('pipeline');
                    } else {
                      loadProjectDetails(updated.id);
                    }
                    loadGlobalData();
                  }}
                  onGoToExports={() => setProjectTab('exports')}
                  onRetryAnalysis={handleRetryJob}
                  retryingAnalysis={retryingJob}
                  renderingClipId={renderingClipId}
                />
              )}

              {projectTab === 'editor' && (
                editingClip ? (
                  <ClipEditor
                    job={activeJob}
                    clip={editingClip}
                    existingExport={jobExports.find((e) => e.clip_id === editingClip.id)}
                    onBack={() => setProjectTab('highlights')}
                    onClipUpdated={(updated) => {
                      setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
                    }}
                    onRenderRequested={handleQuickRender}
                    onProjectRefreshed={async () => {
                      await loadProjectDetails(activeJob.id);
                    }}
                  />
                ) : (
                  <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-10 text-center text-sm text-[#94A3B8]">
                    Select a highlight candidate once analysis finishes to open the Clip Editor.
                  </div>
                )
              )}

              {projectTab === 'exports' && (
                <ExportCenter exportsList={jobExports} title={`Exports — ${activeJob.title}`} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
