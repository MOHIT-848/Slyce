import { CheckCircle2, Cpu, KeyRound, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  clearYoutubeCookies,
  fetchAiModelSetting,
  saveAiModelSetting,
  saveYoutubeCookies,
  triggerCleanup,
} from '../services/apiClient';
import type { HealthStatus } from '../types/clipforge';

interface SettingsViewProps {
  health: HealthStatus | null;
  onRefreshHealth: () => void;
}

export function SettingsView({ health, onRefreshHealth }: SettingsViewProps) {
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const [defaultModel, setDefaultModel] = useState('default');
  const [modelBusy, setModelBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);

  const [cookiesText, setCookiesText] = useState('');
  const [cookiesBusy, setCookiesBusy] = useState(false);
  const [cookiesStatus, setCookiesStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchAiModelSetting()
      .then((res) => setDefaultModel(res.defaultGeminiModel || 'default'))
      .catch(() => {});
  }, []);

  async function handleModelChange(nextModel: string) {
    setDefaultModel(nextModel);
    setModelBusy(true);
    setModelStatus(null);
    try {
      const res = await saveAiModelSetting(nextModel);
      setModelStatus(`Saved default model (${res.effectiveModel}).`);
      onRefreshHealth();
    } catch (err) {
      setModelStatus(err instanceof Error ? err.message : 'Failed to save model.');
    } finally {
      setModelBusy(false);
    }
  }

  async function handleCleanup() {
    setCleaning(true);
    setCleanupStatus(null);
    try {
      const res = await triggerCleanup();
      setCleanupStatus(`Cleanup completed: removed ${res.removedOrphanedFiles} orphaned temporary file(s).`);
    } catch (err) {
      setCleanupStatus(err instanceof Error ? err.message : 'Cleanup failed.');
    } finally {
      setCleaning(false);
    }
  }

  async function handleSaveCookies() {
    setCookiesBusy(true);
    setCookiesStatus(null);
    try {
      const res = await saveYoutubeCookies(cookiesText);
      setCookiesText('');
      setCookiesStatus(`Saved ${res.lineCount} YouTube cookie entries.`);
      onRefreshHealth();
    } catch (err) {
      setCookiesStatus(err instanceof Error ? err.message : 'Failed to save cookies.');
    } finally {
      setCookiesBusy(false);
    }
  }

  async function handleClearCookies() {
    setCookiesBusy(true);
    setCookiesStatus(null);
    try {
      await clearYoutubeCookies();
      setCookiesStatus('Cleared saved YouTube cookies.');
      onRefreshHealth();
    } catch (err) {
      setCookiesStatus(err instanceof Error ? err.message : 'Failed to clear cookies.');
    } finally {
      setCookiesBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-[#F8FAFC]">
              Runtime Diagnostics & Configuration
            </h1>
            <p className="mt-1 text-sm text-[#94A3B8]">
              Live verification of server-side media binaries, YouTube downloader, Gemini connectivity, and unlimited mode.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshHealth}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 cursor-pointer shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Status
          </button>
        </div>

        {health ? (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['FFmpeg Binary', health.ffmpegAvailable, 'Video cutting & 9:16 encoding'],
              ['FFprobe Binary', health.ffprobeAvailable, 'Duration, codec & stream inspection'],
              ['H.264 Codec (libx264)', health.libx264Available, 'MP4 browser & mobile playback'],
              ['Subtitle Filter (libass)', health.subtitlesFilterAvailable, 'Styled caption burn-in'],
              ['YouTube Downloader (yt-dlp)', health.ytDlpAvailable, 'Auto-bootstrapped YouTube MP4 fetcher'],
              ['Gemini API Configured', health.geminiConfigured, `Model: ${health.geminiModel}`],
            ].map(([label, ok, desc]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-white/[0.08] bg-[#101827] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#F8FAFC]">{label}</span>
                  {ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-amber-400" />
                  )}
                </div>
                <p className="mt-1.5 text-xs text-[#94A3B8]">{String(desc)}</p>
              </div>
            ))}

            <div className="rounded-lg border border-white/[0.08] bg-[#101827] p-4 sm:col-span-2 lg:col-span-3">
              <div className="text-xs font-semibold text-[#F8FAFC]">Clipping & Upload Mode</div>
              <p className="mt-1.5 font-mono text-xs text-[#20C7D9] tabular-nums">
                Unlimited Upload Size · Unlimited Video Duration · Unlimited AI & Custom Clips
              </p>
              <p className="mt-1 text-[11px] text-[#94A3B8]">{health.queueMode}</p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-[#94A3B8]">Loading server diagnostics...</p>
        )}
      </div>

      {/* Default Gemini Model Selector */}
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#20C7D9]">
              <Cpu className="h-5 w-5" />
              <h2 className="font-display text-base font-semibold text-[#F8FAFC]">
                Default Gemini Model
              </h2>
            </div>
            <p className="mt-1 text-sm text-[#94A3B8]">
              Used automatically when Recipe settings leave Gemini model set to “Default (Settings)”.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <select
              aria-label="Default Gemini model"
              disabled={modelBusy}
              value={defaultModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none cursor-pointer"
            >
              <option value="default">Environment Default (gemini-4-hydrogen)</option>
              <option value="gemini-4-hydrogen">gemini-4-hydrogen</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
            </select>
          </div>
        </div>
        {modelStatus && <p className="text-xs text-[#20C7D9]">{modelStatus}</p>}
      </div>

      {/* Optional YouTube Cookies Configuration */}
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[#20C7D9]">
            <KeyRound className="h-5 w-5" />
            <h2 className="font-display text-base font-semibold text-[#F8FAFC]">
              YouTube Download Cookies (Optional)
            </h2>
          </div>
          <span className="font-mono text-xs text-[#94A3B8]">
            {health?.youtubeCookiesConfigured ? 'Cookies Saved' : 'Not Configured'}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-[#94A3B8]">
          When running on cloud servers, YouTube sometimes requests bot verification before allowing direct MP4 downloads. Paste either JSON cookies (e.g. from Chrome <strong className="text-[#F8FAFC]">Cookie-Editor</strong>) or Netscape-format <code className="font-mono text-[#20C7D9]">cookies.txt</code> below to let <code className="font-mono text-[#20C7D9]">yt-dlp</code> fetch the full MP4 directly for 9:16 rendering.
        </p>
        <textarea
          rows={4}
          value={cookiesText}
          onChange={(e) => setCookiesText(e.target.value)}
          placeholder='Paste Cookie-Editor JSON array [{"domain":".youtube.com",...}] or # Netscape HTTP Cookie File...'
          className="w-full rounded-lg border border-white/15 bg-[#101827] p-3 font-mono text-xs text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={cookiesBusy || !cookiesText.trim()}
            onClick={handleSaveCookies}
            className="rounded-lg bg-[#7657FF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 cursor-pointer"
          >
            {cookiesBusy ? 'Saving...' : 'Save YouTube Cookies'}
          </button>
          {health?.youtubeCookiesConfigured && (
            <button
              type="button"
              disabled={cookiesBusy}
              onClick={handleClearCookies}
              className="rounded-lg border border-rose-500/30 bg-[#101827] px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 cursor-pointer"
            >
              Remove Saved Cookies
            </button>
          )}
          {cookiesStatus && <span className="text-xs text-[#20C7D9]">{cookiesStatus}</span>}
        </div>
      </div>

      {/* Privacy & Storage Controls */}
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6 space-y-4">
        <div className="flex items-center gap-2 text-[#20C7D9]">
          <ShieldCheck className="h-5 w-5" />
          <h2 className="font-display text-base font-semibold text-[#F8FAFC]">
            Privacy Safeguards & Temporary Storage Cleanup
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-[#94A3B8]">
          Uploaded and downloaded videos are stored temporarily on local disk for FFmpeg processing and deleted whenever
          you remove a project. Extracted audio is sent server-side to Google Gemini exclusively for transcription and
          highlight analysis. API keys remain strictly server-side.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={cleaning}
            onClick={handleCleanup}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-4 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {cleaning ? 'Cleaning...' : 'Clean Up Orphaned Temp Files'}
          </button>
          {cleanupStatus && <span className="text-xs text-[#20C7D9]">{cleanupStatus}</span>}
        </div>
      </div>
    </div>
  );
}

export function HelpView() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-6 space-y-4">
        <h1 className="font-display text-xl font-bold text-[#F8FAFC]">
          SLYCE — User Guide & Unlimited Workflow
        </h1>
        <p className="text-sm leading-relaxed text-[#94A3B8]">
          SLYCE turns any YouTube video link or uploaded video file into unlimited 9:16 vertical clips with
          explainable selection rationale, custom Recipes, Brand Kits, Auto Hooks, editable captions, and downloadable MP4 + SRT files.
        </p>

        <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
          <div className="rounded-lg border border-white/[0.08] bg-[#101827] p-4 space-y-2">
            <h2 className="font-display text-sm font-semibold text-[#F8FAFC]">
              Unlimited Clipping & Custom Cuts
            </h2>
            <p className="text-xs leading-relaxed text-[#94A3B8]">
              There are no limits on file size, video duration, or number of clips. After initial AI discovery, click
              “Find More AI Clips” with any topic prompt or use “Custom Clip” to carve out as many timestamp ranges as
              you want.
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-[#101827] p-4 space-y-2">
            <h2 className="font-display text-sm font-semibold text-[#F8FAFC]">
              Explainable Scoring Formula
            </h2>
            <p className="text-xs leading-relaxed text-[#94A3B8]">
              Clip score = 30% Completeness + 25% Hook Strength + 20% Useful Information + 15% Emotional/Expressive
              Emphasis + 10% Duration Fit. Scores rank candidates by structural clarity—they never predict viral views.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
