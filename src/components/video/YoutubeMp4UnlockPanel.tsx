import { KeyRound, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  retryYoutubeDownload,
  saveYoutubeCookies,
  uploadVideoWithProgress,
} from '../../services/apiClient';
import type { VideoJob } from '../../types/clipforge';

interface YoutubeMp4UnlockPanelProps {
  job: VideoJob;
  onUnlocked: () => Promise<void> | void;
  compact?: boolean;
}

export function YoutubeMp4UnlockPanel({
  job,
  onUnlocked,
  compact = false,
}: YoutubeMp4UnlockPanelProps) {
  const attachFileRef = useRef<HTMLInputElement | null>(null);

  const [showCookieBox, setShowCookieBox] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [busyCookieFetch, setBusyCookieFetch] = useState(false);
  const [retryingYt, setRetryingYt] = useState(false);
  const [attachingPct, setAttachingPct] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleSaveCookiesAndFetch() {
    if (!cookieInput.trim()) return;
    setErrMsg(null);
    setFeedback(null);
    setBusyCookieFetch(true);
    try {
      await saveYoutubeCookies(cookieInput);
      setCookieInput('');
      await retryYoutubeDownload(job.id);
      setShowCookieBox(false);
      setFeedback('YouTube MP4 fetched successfully! 9:16 MP4 rendering is now unlocked.');
      await onUnlocked();
    } catch (err) {
      setErrMsg(
        err instanceof Error
          ? err.message
          : 'Could not download MP4 with those cookies. Try refreshing your YouTube cookies or attaching an MP4 file.'
      );
    } finally {
      setBusyCookieFetch(false);
    }
  }

  async function handleRetryExistingCookies() {
    setErrMsg(null);
    setFeedback(null);
    setRetryingYt(true);
    try {
      await retryYoutubeDownload(job.id);
      setFeedback('YouTube MP4 downloaded! 9:16 MP4 rendering is now active.');
      await onUnlocked();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Download retry failed.');
    } finally {
      setRetryingYt(false);
    }
  }

  async function handleAttachLocalVideo(file: File | undefined | null) {
    if (!file) return;
    setErrMsg(null);
    setFeedback(null);
    setAttachingPct(1);
    try {
      await uploadVideoWithProgress(
        file,
        job.title,
        (pct) => setAttachingPct(pct),
        { attachToJobId: job.id }
      );
      setFeedback('Local MP4 attached! All clips can now render to 9:16 MP4.');
      await onUnlocked();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to attach video file.');
    } finally {
      setAttachingPct(null);
      if (attachFileRef.current) attachFileRef.current.value = '';
    }
  }

  const platformName = job.source_type === 'instagram' ? 'Instagram' : 'YouTube';

  return (
    <div
      className={`space-y-3 rounded-xl border border-[#20C7D9]/25 bg-[#101827] ${
        compact ? 'p-3.5' : 'p-4'
      }`}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#F8FAFC]">
            {platformName} Cloud Preview Active
          </span>
          <span className="font-mono text-[11px] text-[#20C7D9] whitespace-nowrap">
            Unlock {job.recipe_config?.aspectRatio || '9:16'} MP4 Export
          </span>
        </div>
        <p className="text-xs leading-relaxed text-[#94A3B8]">
          Your clips, custom fonts, animations, and subtitles are live. Because {platformName} sometimes requires sign-in on shared cloud servers before serving raw MP4 streams, unlock full MP4 export below by pasting cookies (JSON or <code className="font-mono text-[#20C7D9]">cookies.txt</code>) or attaching a local MP4 file.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowCookieBox((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#20C7D9]/40 bg-[#20C7D9]/10 px-3 py-1.5 text-xs font-semibold text-[#20C7D9] hover:bg-[#20C7D9]/20 transition-colors whitespace-nowrap cursor-pointer"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {showCookieBox ? 'Hide Cookie Input' : 'Paste YouTube Cookies'}
        </button>

        <button
          type="button"
          disabled={retryingYt || busyCookieFetch}
          onClick={handleRetryExistingCookies}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#151E2E] px-3 py-1.5 text-xs font-medium text-[#F8FAFC] hover:border-white/30 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {retryingYt ? 'Fetching MP4...' : 'Retry Fetch'}
        </button>

        <input
          ref={attachFileRef}
          type="file"
          accept=".mp4,.mov,.webm,.mkv,.m4v,.avi,video/*"
          onChange={(e) => handleAttachLocalVideo(e.target.files?.[0])}
          className="hidden"
        />
        <button
          type="button"
          disabled={attachingPct !== null}
          onClick={() => attachFileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Upload className="h-3.5 w-3.5" />
          {attachingPct !== null ? `Attaching (${attachingPct}%)...` : 'Attach Local MP4'}
        </button>
      </div>

      {showCookieBox && (
        <div className="space-y-2 border-t border-white/[0.08] pt-3">
          <p className="text-[11px] leading-relaxed text-[#94A3B8]">
            Export cookies while signed in on youtube.com (using Cookie-Editor JSON export or Get cookies.txt LOCALLY) and paste them here:
          </p>
          <textarea
            rows={3}
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            placeholder='Paste JSON cookies [{"domain":".youtube.com",...}] or Netscape cookies.txt...'
            className="w-full rounded-lg border border-white/15 bg-[#080B14] p-2.5 font-mono text-[11px] text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busyCookieFetch || !cookieInput.trim()}
              onClick={handleSaveCookiesAndFetch}
              className="rounded-lg bg-[#20C7D9] px-3.5 py-1.5 text-xs font-semibold text-[#080B14] hover:opacity-90 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {busyCookieFetch ? 'Saving & Downloading MP4...' : 'Save Cookies & Download MP4'}
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <p className="text-xs font-medium text-emerald-300">{feedback}</p>
      )}
      {errMsg && (
        <p className="text-xs leading-relaxed text-rose-300">{errMsg}</p>
      )}
    </div>
  );
}
