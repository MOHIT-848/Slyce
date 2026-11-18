import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileVideo,
  KeyRound,
  Link2,
  Play,
  Scissors,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeDownloadedJob,
  clearYoutubeCookies,
  downloadLinkAsMp4,
  fetchSamples,
  saveYoutubeCookies,
  startSampleProject,
  uploadVideoWithProgress,
} from '../../services/apiClient';
import {
  DEFAULT_RECIPE_CONFIG,
  PLAYBACK_SPEED_OPTIONS,
  RECIPE_OPTIONS,
  type AspectRatio,
  type HealthStatus,
  type RecipeConfig,
  type ReframeMode,
  type SampleVideoInfo,
  type TargetDurationPreset,
  type VideoJob,
} from '../../types/clipforge';
import { formatBytes, formatDurationShort } from '../../utils/time';
import { RecipeStudioPanel } from '../studio/RecipeStudioPanel';

interface VideoUploadPanelProps {
  health: HealthStatus | null;
  recipeConfig?: RecipeConfig;
  onRecipeChange?: (next: RecipeConfig) => void;
  onJobCreated: (job: VideoJob) => void;
  onRefreshHealth?: () => void;
}

interface SelectedFileMeta {
  file: File;
  previewUrl: string;
  duration: number | null;
  title: string;
}

type InputSourceTab = 'youtube' | 'upload';

const ACCEPTED_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi']);

export function VideoUploadPanel({
  health,
  recipeConfig = DEFAULT_RECIPE_CONFIG,
  onRecipeChange,
  onJobCreated,
  onRefreshHealth,
}: VideoUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceTab, setSourceTab] = useState<InputSourceTab>('youtube');

  // YouTube / Instagram Link Importer state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [importingYoutube, setImportingYoutube] = useState(false);
  const [downloadingMp4Only, setDownloadingMp4Only] = useState(false);
  const [downloadedJob, setDownloadedJob] = useState<{
    job: VideoJob;
    downloadUrl: string;
  } | null>(null);
  const [analyzingDownloaded, setAnalyzingDownloaded] = useState(false);

  // Optional YouTube / Instagram cookies helper
  const [showCookiesPanel, setShowCookiesPanel] = useState(false);
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesBusy, setCookiesBusy] = useState(false);
  const [cookiesMessage, setCookiesMessage] = useState<string | null>(null);

  const detectedPlatform = useMemo(() => {
    const raw = youtubeUrl.trim().toLowerCase();
    if (!raw) return null;
    if (raw.includes('instagram.com') || raw.includes('instagr.am')) return 'Instagram Reel / Video';
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) return 'YouTube Video / Shorts';
    return null;
  }, [youtubeUrl]);

  // Local file upload state (no file size or duration limits)
  const [selected, setSelected] = useState<SelectedFileMeta | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [permissionAccepted, setPermissionAccepted] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [samples, setSamples] = useState<SampleVideoInfo[]>([]);
  const [startingSampleId, setStartingSampleId] = useState<string | null>(null);

  useEffect(() => {
    fetchSamples()
      .then((res) => setSamples(res.samples))
      .catch(() => {
        // Ignore silent sample load failure
      });
  }, []);

  useEffect(() => {
    return () => {
      if (selected?.previewUrl) {
        URL.revokeObjectURL(selected.previewUrl);
      }
    };
  }, [selected]);

  function handleFileSelection(file: File | undefined | null) {
    setError(null);
    setStatusMessage(null);
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXTS.has(ext)) {
      setError('Unsupported file format. Accepted formats: MP4, MOV, WebM, MKV, M4V, AVI.');
      return;
    }

    if (selected?.previewUrl) {
      URL.revokeObjectURL(selected.previewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    const defaultTitle = file.name.replace(/\.[^/.]+$/, '');
    const meta: SelectedFileMeta = {
      file,
      previewUrl,
      duration: null,
      title: defaultTitle,
    };
    setSelected(meta);

    // Probe duration cleanly via offscreen video element (no duration limit enforced)
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = previewUrl;
    probe.onloadedmetadata = () => {
      const dur = Number.isFinite(probe.duration) ? probe.duration : null;
      setSelected((prev) => (prev && prev.previewUrl === previewUrl ? { ...prev, duration: dur } : prev));
    };
    probe.onerror = () => {
      // Server FFprobe handles container codecs like MKV/AVI even if browser preview doesn't
    };
  }

  function clearSelected() {
    if (selected?.previewUrl) {
      URL.revokeObjectURL(selected.previewUrl);
    }
    setSelected(null);
    setUploadPercent(0);
    setStatusMessage(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleDownloadMp4First() {
    setError(null);
    setStatusMessage(null);
    if (!youtubeUrl.trim()) {
      setError('Paste a YouTube or Instagram video link first.');
      return;
    }

    setDownloadingMp4Only(true);
    try {
      const selectedRecipe = RECIPE_OPTIONS.find((r) => r.id === recipeConfig.recipe);
      const effectiveFocus = focusPrompt.trim() || selectedRecipe?.focusHint || undefined;
      const res = await downloadLinkAsMp4({
        url: youtubeUrl.trim(),
        title: youtubeTitle.trim() || undefined,
        focusPrompt: effectiveFocus,
        recipeConfig,
        autoAnalyze: false,
      });
      setDownloadedJob({
        job: res.job,
        downloadUrl: res.downloadUrl || `/api/jobs/${encodeURIComponent(res.job.id)}/media?download=1`,
      });
      setStatusMessage(res.message);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to download MP4. Try pasting cookies below or switching to Upload Video File.'
      );
    } finally {
      setDownloadingMp4Only(false);
    }
  }

  async function handleAnalyzeDownloadedMp4() {
    if (!downloadedJob) return;
    setError(null);
    setAnalyzingDownloaded(true);
    try {
      const selectedRecipe = RECIPE_OPTIONS.find((r) => r.id === recipeConfig.recipe);
      const effectiveFocus = focusPrompt.trim() || selectedRecipe?.focusHint || undefined;
      const res = await analyzeDownloadedJob(downloadedJob.job.id, {
        focusPrompt: effectiveFocus,
        recipeConfig,
      });
      onJobCreated(res.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start AI clip extraction.');
      setAnalyzingDownloaded(false);
    }
  }

  async function handleYoutubeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);

    if (!youtubeUrl.trim()) {
      setError('Paste a YouTube or Instagram video link to begin.');
      return;
    }

    setImportingYoutube(true);
    try {
      const selectedRecipe = RECIPE_OPTIONS.find((r) => r.id === recipeConfig.recipe);
      const effectiveFocus = focusPrompt.trim() || selectedRecipe?.focusHint || undefined;
      const res = await downloadLinkAsMp4({
        url: youtubeUrl.trim(),
        title: youtubeTitle.trim() || undefined,
        focusPrompt: effectiveFocus,
        recipeConfig,
        autoAnalyze: true,
      });
      setStatusMessage(res.message);
      setTimeout(() => {
        onJobCreated(res.job);
      }, 250);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import link.');
      setImportingYoutube(false);
    }
  }

  async function handleSaveCookies() {
    setCookiesBusy(true);
    setCookiesMessage(null);
    setError(null);
    try {
      const res = await saveYoutubeCookies(cookiesText);
      setCookiesText('');
      setCookiesMessage(`Saved ${res.lineCount} YouTube cookie entries for yt-dlp downloads.`);
      onRefreshHealth?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cookies.');
    } finally {
      setCookiesBusy(false);
    }
  }

  async function handleClearCookies() {
    setCookiesBusy(true);
    setCookiesMessage(null);
    try {
      await clearYoutubeCookies();
      setCookiesMessage('Removed saved YouTube cookies.');
      onRefreshHealth?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove cookies.');
    } finally {
      setCookiesBusy(false);
    }
  }

  async function handleUpload() {
    if (!selected) return;
    if (!permissionAccepted) {
      setError('Please confirm you have permission to process this video before uploading.');
      return;
    }

    setUploading(true);
    setUploadPercent(0);
    setError(null);
    setStatusMessage(null);

    try {
      const selectedRecipe = RECIPE_OPTIONS.find((r) => r.id === recipeConfig.recipe);
      const effectiveFocus = focusPrompt.trim() || selectedRecipe?.focusHint || undefined;
      const res = await uploadVideoWithProgress(
        selected.file,
        selected.title,
        (pct) => setUploadPercent(pct),
        { focusPrompt: effectiveFocus, recipeConfig }
      );
      setStatusMessage(res.message || 'Video uploaded successfully. Ready for AI analysis.');
      setTimeout(() => {
        onJobCreated(res.job);
      }, 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload video.');
      setUploading(false);
    }
  }

  async function handleStartSample(sampleId: string, mode: 'ai' | 'demo') {
    setError(null);
    setStartingSampleId(`${sampleId}:${mode}`);
    try {
      const res = await startSampleProject(sampleId, mode, recipeConfig);
      onJobCreated(res.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch sample project.');
      setStartingSampleId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Interactive Recipe, Output, AI & Reframe, Captions & Auto Hook Configurator */}
      {onRecipeChange && (
        <RecipeStudioPanel
          value={recipeConfig}
          onChange={onRecipeChange}
          defaultExpanded={true}
        />
      )}

      {/* Main Source Input Card */}
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">
              Create Clips From YouTube, Instagram, or Video Upload
            </h2>
            <p className="text-sm text-[#94A3B8]">
              Download clean MP4 first with zero embed dependency · Unlimited duration &amp; clips
            </p>
          </div>
          {health && (
            <span className="text-xs text-[#94A3B8] font-mono tabular-nums whitespace-nowrap">
              FFmpeg {health.ffmpegAvailable ? 'Ready' : 'Unavailable'} · Gemini{' '}
              {health.geminiConfigured ? 'Connected' : 'Key Required'}
            </span>
          )}
        </div>

        {/* Source Switcher */}
        <div className="mt-5 inline-flex items-center gap-1 rounded-lg bg-[#080B14] p-1">
          <button
            type="button"
            onClick={() => {
              setSourceTab('youtube');
              setError(null);
            }}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              sourceTab === 'youtube'
                ? 'bg-[#7657FF] text-white'
                : 'text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            YouTube / Instagram MP4
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceTab('upload');
              setError(null);
            }}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              sourceTab === 'upload'
                ? 'bg-[#7657FF] text-white'
                : 'text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Video File
          </button>
        </div>

        {/* Tab 1: YouTube & Instagram Link -> Download MP4 First -> Extract Clips */}
        {sourceTab === 'youtube' && (
          <div className="mt-5 space-y-5">
            {downloadedJob ? (
              <div className="rounded-xl border border-[#20C7D9]/35 bg-[#101827] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[#20C7D9]">
                      Clean Local MP4 Downloaded ({downloadedJob.job.platform_label || 'Link'})
                    </div>
                    <h3 className="mt-0.5 font-display text-base font-bold text-[#F8FAFC]">
                      {downloadedJob.job.title}
                    </h3>
                    <p className="font-mono text-xs text-[#94A3B8] tabular-nums">
                      {downloadedJob.job.resolution} · {formatDurationShort(downloadedJob.job.duration)} · Zero YouTube embed dependency
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDownloadedJob(null);
                      setStatusMessage(null);
                    }}
                    className="rounded-lg border border-white/15 bg-[#080B14] px-3 py-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                  >
                    Import Another Link
                  </button>
                </div>

                {downloadedJob.job.source_video_url && (
                  <video
                    src={downloadedJob.job.source_video_url}
                    controls
                    className="aspect-video w-full max-h-[360px] rounded-lg border border-white/[0.08] bg-black object-contain"
                  />
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={analyzingDownloaded}
                    onClick={handleAnalyzeDownloadedMp4}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#7657FF] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4 text-[#20C7D9]" />
                    {analyzingDownloaded ? 'Starting AI & Lyrics Extraction...' : 'Extract AI Clips & Lyrics'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onJobCreated(downloadedJob.job)}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#20C7D9]/40 bg-[#20C7D9]/10 px-4 py-2.5 text-xs font-semibold text-[#20C7D9] hover:bg-[#20C7D9]/20 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Scissors className="h-4 w-4" />
                    Open MP4 in Clip Editor
                  </button>

                  <a
                    href={downloadedJob.downloadUrl}
                    download
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#151E2E] px-4 py-2.5 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 transition-colors whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 text-[#20C7D9]" />
                    Save .MP4 to Device
                  </a>
                </div>
              </div>
            ) : (
              <form onSubmit={handleYoutubeSubmit} className="space-y-5 rounded-xl border border-white/[0.08] bg-[#101827] p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                  <div className="md:col-span-8">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="youtube-url-input" className="block text-xs font-medium text-[#94A3B8]">
                        YouTube or Instagram Reel / Post URL
                      </label>
                      {detectedPlatform && (
                        <span className="font-mono text-[11px] text-[#20C7D9] whitespace-nowrap">
                          Detected: {detectedPlatform}
                        </span>
                      )}
                    </div>
                    <input
                      id="youtube-url-input"
                      type="url"
                      value={youtubeUrl}
                      disabled={importingYoutube || downloadingMp4Only}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=... or https://www.instagram.com/reel/..."
                      className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3.5 py-2.5 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
                    />
                    <p className="mt-1.5 text-xs text-[#94A3B8]">
                      Paste any YouTube (watch, Shorts, youtu.be) or Instagram (Reel, Post, TV) link. Download as a clean local MP4 first for copyright-free offline clipping.
                    </p>
                  </div>

                  <div className="md:col-span-4">
                    <label htmlFor="youtube-title-input" className="block text-xs font-medium text-[#94A3B8]">
                      Project Title (Optional)
                    </label>
                    <input
                      id="youtube-title-input"
                      type="text"
                      value={youtubeTitle}
                      disabled={importingYoutube || downloadingMp4Only}
                      onChange={(e) => setYoutubeTitle(e.target.value)}
                      placeholder="Auto-detected from link"
                      className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3.5 py-2.5 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="youtube-focus-input" className="block text-xs font-medium text-[#94A3B8]">
                    Clip Focus Instructions (Optional)
                  </label>
                  <input
                    id="youtube-focus-input"
                    type="text"
                    value={focusPrompt}
                    disabled={importingYoutube || downloadingMp4Only}
                    onChange={(e) => setFocusPrompt(e.target.value)}
                    placeholder="e.g. Extract song chorus lyrics, key highlights, or 30-60s viral moments"
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3.5 py-2 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
                  />
                </div>

                {/* Optional YouTube & Instagram Cookies Disclosure */}
                <div className="border-t border-white/[0.06] pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCookiesPanel((v) => !v)}
                    className="inline-flex items-center gap-2 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                  >
                    <KeyRound className="h-3.5 w-3.5 text-[#20C7D9]" />
                    <span>
                      YouTube / Instagram Cookies ({health?.youtubeCookiesConfigured ? 'Configured' : 'Optional for cloud IP sign-in / bot-check bypass'})
                    </span>
                    {showCookiesPanel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {showCookiesPanel && (
                    <div className="mt-3 space-y-3 rounded-lg border border-white/[0.08] bg-[#080B14] p-4">
                      <p className="text-xs leading-relaxed text-[#94A3B8]">
                        Cloud IPs sometimes trigger YouTube bot verification or Instagram login walls. Paste Netscape-format <code className="font-mono text-[#20C7D9]">cookies.txt</code> or JSON cookies here so <code className="font-mono text-[#20C7D9]">yt-dlp</code> downloads the clean raw MP4 directly to your studio.
                      </p>
                      <textarea
                        rows={3}
                        value={cookiesText}
                        onChange={(e) => setCookiesText(e.target.value)}
                        placeholder="# Netscape HTTP Cookie File..."
                        className="w-full rounded-lg border border-white/15 bg-[#101827] p-2.5 font-mono text-xs text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={cookiesBusy || !cookiesText.trim()}
                          onClick={handleSaveCookies}
                          className="rounded-lg bg-[#151E2E] border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:border-[#20C7D9]/50 disabled:opacity-50 cursor-pointer"
                        >
                          {cookiesBusy ? 'Saving...' : 'Save Cookies'}
                        </button>
                        {health?.youtubeCookiesConfigured && (
                          <button
                            type="button"
                            disabled={cookiesBusy}
                            onClick={handleClearCookies}
                            className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                          >
                            Clear Saved Cookies
                          </button>
                        )}
                        {cookiesMessage && <span className="text-xs text-emerald-300">{cookiesMessage}</span>}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={importingYoutube || downloadingMp4Only}
                    onClick={handleDownloadMp4First}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#7657FF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="h-4 w-4" />
                    {downloadingMp4Only ? 'Downloading Clean MP4...' : 'Download MP4 First (Clean Source)'}
                  </button>

                  <button
                    type="submit"
                    disabled={importingYoutube || downloadingMp4Only}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#151E2E] px-4 py-2.5 text-sm font-semibold text-[#F8FAFC] hover:border-[#20C7D9]/50 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Sparkles className="h-4 w-4 text-[#20C7D9]" />
                    {importingYoutube ? 'Importing & Auto-Clipping...' : 'Download & Auto-Clip Now'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Tab 2: Local File Upload (Unlimited Size & Duration) */}
        {sourceTab === 'upload' && (
          <>
            {!selected ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  handleFileSelection(e.dataTransfer.files?.[0]);
                }}
                className={`mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition-colors ${
                  dragActive
                    ? 'border-[#20C7D9] bg-[#20C7D9]/5'
                    : 'border-white/20 bg-[#101827] hover:border-white/35'
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7657FF]/15 text-[#7657FF]">
                  <Upload className="h-6 w-6" />
                </div>
                <p className="mt-4 text-sm font-medium text-[#F8FAFC]">
                  Drag and drop any video file here — no size or length limits
                </p>
                <p className="mt-1 text-xs text-[#94A3B8]">
                  Supports MP4, MOV, WebM, MKV, M4V, and AVI · Podcasts, streams, lectures, or multi-hour recordings
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp4,.mov,.webm,.mkv,.m4v,.avi,video/*"
                  onChange={(e) => handleFileSelection(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-5 rounded-lg border border-white/15 bg-[#151E2E] px-5 py-2.5 text-sm font-semibold text-[#F8FAFC] hover:border-white/30 hover:bg-[#1E293B] transition-colors cursor-pointer"
                >
                  Browse Video Files
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-white/[0.08] bg-[#101827] p-5">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-center">
                  <div className="md:col-span-5">
                    <video
                      src={selected.previewUrl}
                      controls
                      muted
                      className="aspect-video w-full rounded-lg border border-white/[0.08] bg-black object-contain"
                    />
                  </div>
                  <div className="md:col-span-7 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[#94A3B8]" htmlFor="project-title">
                        Project Title
                      </label>
                      <input
                        id="project-title"
                        type="text"
                        value={selected.title}
                        disabled={uploading}
                        onChange={(e) =>
                          setSelected((prev) => (prev ? { ...prev, title: e.target.value } : prev))
                        }
                        className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3.5 py-2 text-sm text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                      />
                    </div>

                      <div>
                        <label className="block text-xs font-medium text-[#94A3B8]" htmlFor="upload-focus-input">
                          Clip Focus Instructions (Optional)
                        </label>
                        <input
                          id="upload-focus-input"
                          type="text"
                          value={focusPrompt}
                          disabled={uploading}
                          onChange={(e) => setFocusPrompt(e.target.value)}
                          placeholder="e.g. Find every product demo, quote, or Q&A exchange"
                          className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3.5 py-2 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
                        />
                      </div>

                      {/* Quick Output Controls Right Next to Uploaded File */}
                      {onRecipeChange && (
                        <div className="space-y-3 rounded-lg border border-white/[0.08] bg-[#080B14]/70 p-3.5">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <span className="block text-[11px] font-medium text-[#94A3B8]">
                                Aspect Ratio
                              </span>
                              <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-md bg-[#101827] p-0.5">
                                {(['9:16', '1:1', '16:9'] as AspectRatio[]).map((ratio) => (
                                  <button
                                    key={ratio}
                                    type="button"
                                    disabled={uploading}
                                    onClick={() => onRecipeChange({ ...recipeConfig, aspectRatio: ratio })}
                                    className={`rounded py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                                      recipeConfig.aspectRatio === ratio
                                        ? 'bg-[#7657FF] text-white'
                                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                                    }`}
                                  >
                                    {ratio}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor="upload-duration-select"
                                className="block text-[11px] font-medium text-[#94A3B8]"
                              >
                                Target Duration
                              </label>
                              <select
                                id="upload-duration-select"
                                disabled={uploading}
                                value={recipeConfig.targetDuration}
                                onChange={(e) =>
                                  onRecipeChange({
                                    ...recipeConfig,
                                    targetDuration: e.target.value as TargetDurationPreset,
                                  })
                                }
                                className="mt-1.5 w-full rounded-md border border-white/15 bg-[#101827] px-2.5 py-1.5 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none cursor-pointer"
                              >
                                <option value="auto">Auto</option>
                                <option value="short_30">&lt; 30s (Quick)</option>
                                <option value="medium_60">30s – 60s (Standard)</option>
                                <option value="long_90">60s – 90s (Deep)</option>
                                <option value="custom">Custom min–max</option>
                              </select>
                            </div>

                            <div>
                              <span className="block text-[11px] font-medium text-[#94A3B8]">
                                Speed
                              </span>
                              <div className="mt-1.5 grid grid-cols-5 gap-0.5 rounded-md bg-[#101827] p-0.5">
                                {PLAYBACK_SPEED_OPTIONS.map((spd) => (
                                  <button
                                    key={spd}
                                    type="button"
                                    disabled={uploading}
                                    onClick={() => onRecipeChange({ ...recipeConfig, playbackSpeed: spd })}
                                    className={`rounded py-1 font-mono text-[10px] font-semibold transition-colors cursor-pointer ${
                                      Math.abs(recipeConfig.playbackSpeed - spd) < 0.01
                                        ? 'bg-[#20C7D9] text-[#080B14]'
                                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                                    }`}
                                  >
                                    {spd}x
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {recipeConfig.targetDuration === 'custom' && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-[11px] text-[#94A3B8]">Custom duration (sec):</span>
                              <input
                                type="number"
                                min={3}
                                max={600}
                                value={recipeConfig.customMinDuration}
                                onChange={(e) =>
                                  onRecipeChange({
                                    ...recipeConfig,
                                    customMinDuration: Math.max(3, Number(e.target.value) || 15),
                                  })
                                }
                                className="w-16 rounded border border-white/15 bg-[#101827] px-2 py-1 text-center font-mono text-xs text-[#F8FAFC] tabular-nums"
                              />
                              <span className="text-[#94A3B8]">to</span>
                              <input
                                type="number"
                                min={5}
                                max={3600}
                                value={recipeConfig.customMaxDuration}
                                onChange={(e) =>
                                  onRecipeChange({
                                    ...recipeConfig,
                                    customMaxDuration: Math.max(
                                      recipeConfig.customMinDuration + 2,
                                      Number(e.target.value) || 60
                                    ),
                                  })
                                }
                                className="w-16 rounded border border-white/15 bg-[#101827] px-2 py-1 text-center font-mono text-xs text-[#F8FAFC] tabular-nums"
                              />
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5 text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#94A3B8]">Reframe:</span>
                              {(['auto', 'subject', 'off'] as ReframeMode[]).map((rf) => (
                                <button
                                  key={rf}
                                  type="button"
                                  disabled={uploading}
                                  onClick={() => onRecipeChange({ ...recipeConfig, reframeMode: rf })}
                                  className={`rounded px-2 py-0.5 font-medium capitalize transition-colors cursor-pointer ${
                                    recipeConfig.reframeMode === rf
                                      ? 'bg-[#262C3A] text-[#F8FAFC]'
                                      : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                                  }`}
                                >
                                  {rf}
                                </button>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                              <label className="inline-flex items-center gap-1.5 text-[#CBD5E1] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={recipeConfig.smartCut}
                                  disabled={uploading}
                                  onChange={(e) =>
                                    onRecipeChange({ ...recipeConfig, smartCut: e.target.checked })
                                  }
                                  className="h-3.5 w-3.5 rounded accent-[#20C7D9]"
                                />
                                Smart cut
                              </label>
                              <label className="inline-flex items-center gap-1.5 text-[#CBD5E1] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={recipeConfig.subtleZoom}
                                  disabled={uploading}
                                  onChange={(e) =>
                                    onRecipeChange({ ...recipeConfig, subtleZoom: e.target.checked })
                                  }
                                  className="h-3.5 w-3.5 rounded accent-[#20C7D9]"
                                />
                                Subtle zoom
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#94A3B8]">
                        <span className="inline-flex items-center gap-1.5 text-[#F8FAFC] font-medium">
                          <FileVideo className="h-3.5 w-3.5 text-[#20C7D9]" />
                          {selected.file.name}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatBytes(selected.file.size)}</span>
                        {selected.duration !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatDurationShort(selected.duration)}
                            </span>
                          </>
                        )}
                      </div>

                      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-[#94A3B8] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permissionAccepted}
                          disabled={uploading}
                          onChange={(e) => setPermissionAccepted(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-white/25 bg-[#080B14] accent-[#7657FF]"
                        />
                        <span>
                          I confirm I own or have permission to process this footage, and acknowledge that extracted audio is
                          sent to Google Gemini for transcription and highlight extraction.
                        </span>
                      </label>

                    {uploading && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#94A3B8]">Streaming chunks to workspace...</span>
                          <span className="font-mono text-[#20C7D9] tabular-nums">{uploadPercent}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#080B14]">
                          <div
                            className="h-full bg-[#7657FF] transition-all duration-150"
                            style={{ width: `${uploadPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={handleUpload}
                        className="rounded-lg bg-[#7657FF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {uploading ? 'Uploading...' : 'Upload & Analyze Video'}
                      </button>
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={clearSelected}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#080B14] px-4 py-2.5 text-sm font-medium text-[#94A3B8] hover:text-[#F8FAFC] disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove File
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {statusMessage && (
          <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Team-Owned Sample Videos */}
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-[#F8FAFC]">
              Team-Owned Sample Videos
            </h3>
            <p className="text-sm text-[#94A3B8]">
              Test the end-to-end FFmpeg + vertical rendering pipeline with our prepared sample recordings.
            </p>
          </div>
          {!health?.geminiConfigured && (
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-300">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>Gemini key not detected — Demo Mode available</span>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {samples.map((sample) => {
            const busyAi = startingSampleId === `${sample.id}:ai`;
            const busyDemo = startingSampleId === `${sample.id}:demo`;
            const anyBusy = startingSampleId !== null;
            return (
              <div
                key={sample.id}
                className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#101827] overflow-hidden"
              >
                <div>
                  <div className="relative h-44 w-full bg-[#080B14]">
                    <img
                      src={sample.thumbnail_url}
                      alt={sample.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#101827] via-transparent to-transparent" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2 text-xs text-[#20C7D9]">
                      <span>{sample.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatDurationShort(sample.duration_seconds)}
                      </span>
                    </div>
                    <h4 className="mt-1.5 font-display text-base font-semibold text-[#F8FAFC]">
                      {sample.title}
                    </h4>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#94A3B8]">
                      {sample.description}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 border-t border-white/[0.08] px-5 py-3.5">
                  {health?.geminiConfigured && (
                    <button
                      type="button"
                      disabled={anyBusy}
                      onClick={() => handleStartSample(sample.id, 'ai')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {busyAi ? 'Preparing AI Pipeline...' : 'Run Full AI Pipeline'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={anyBusy}
                    onClick={() => handleStartSample(sample.id, 'demo')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#151E2E] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {busyDemo ? 'Loading Demo Mode...' : 'Demo Mode (Preloaded Transcript)'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
