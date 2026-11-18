import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Film,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Wand2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { updateClip } from '../../services/apiClient';
import {
  ASPECT_RATIO_CONFIG,
  AUTO_HOOK_STYLE_CARDS,
  CAPTION_FONT_OPTIONS,
  DEFAULT_CLIP_EFFECTS,
  applySmartCutToCueText,
  framingToReframeMode,
  getAspectRatioForResolution,
  reframeModeToFraming,
  type AspectRatio,
  type AutoHookStyle,
  type CaptionAnimation,
  type CaptionFontWeight,
  type ClipCandidate,
  type ClipEffects,
  type ExportRecord,
  type ExportResolution,
  type FramingMode,
  type IntroTransition,
  type MotionAnimation,
  type OutroTransition,
  type ReframeMode,
  type SubtitleCue,
  type SubtitlePosition,
  type SubtitleSettings,
  type SubtitleStyleId,
  type VideoJob,
  type VisualFilterPreset,
} from '../../types/clipforge';
import { formatTimestamp } from '../../utils/time';
import { YoutubeMp4UnlockPanel } from '../video/YoutubeMp4UnlockPanel';

interface ClipEditorProps {
  job: VideoJob;
  clip: ClipCandidate;
  existingExport?: ExportRecord;
  onBack: () => void;
  onClipUpdated: (clip: ClipCandidate) => void;
  onRenderRequested: (clip: ClipCandidate) => void;
  onProjectRefreshed?: () => Promise<void> | void;
}

type EditorTab = 'cut' | 'typography' | 'effects' | 'cues';

const COLOR_SWATCHES = ['#FFFFFF', '#FFD920', '#20C7D9', '#4ADE80', '#FB7185', '#A78BFA'];
const OUTLINE_SWATCHES = ['#080B14', '#000000', '#1E1B4B', '#FFFFFF'];

function getCssFontFamily(fontFamily?: string): string {
  const found = CAPTION_FONT_OPTIONS.find((f) => f.value === fontFamily);
  if (found) return found.cssFamily;
  if (fontFamily && fontFamily.trim()) return `"${fontFamily.trim()}", "Noto Sans", sans-serif`;
  return '"Noto Sans Display", "Noto Sans", sans-serif';
}

function getDefaultStyleDefaults(style: SubtitleStyleId): Partial<SubtitleSettings> {
  if (style === 'bold_creator') {
    return {
      fontFamily: 'Noto Sans Display',
      fontWeight: 'extrabold',
      textColor: '#FFD920',
      outlineColor: '#000000',
      outlineWidth: 5,
    };
  }
  if (style === 'minimal_clean') {
    return {
      fontFamily: 'Noto Sans',
      fontWeight: 'normal',
      textColor: '#F8FAFC',
      outlineColor: '#101827',
      outlineWidth: 2,
    };
  }
  if (style === 'word_cut') {
    return {
      fontFamily: 'Noto Sans Display',
      fontWeight: 'extrabold',
      uppercase: false,
      textColor: '#FFFFFF',
      outlineColor: '#080B14',
      outlineWidth: 3.5,
      animation: 'pop',
    };
  }
  if (style === 'marker_sweep') {
    return {
      fontFamily: 'Liberation Sans',
      fontWeight: 'extrabold',
      uppercase: true,
      textColor: '#FFFFFF',
      outlineColor: '#7657FF',
      outlineWidth: 4,
      animation: 'typewriter',
    };
  }
  if (style === 'negative_keywords') {
    return {
      fontFamily: 'Noto Sans Display',
      fontWeight: 'extrabold',
      uppercase: true,
      textColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 4.5,
      animation: 'fade',
    };
  }
  if (style === 'karaoke') {
    return {
      fontFamily: 'Noto Sans Display',
      fontWeight: 'extrabold',
      uppercase: true,
      textColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 5.5,
      animation: 'typewriter',
    };
  }
  return {
    fontFamily: 'Noto Sans Display',
    fontWeight: 'bold',
    textColor: '#FFFFFF',
    outlineColor: '#080B14',
    outlineWidth: 3.5,
  };
}

export function ClipEditor({
  job,
  clip,
  existingExport,
  onBack,
  onClipUpdated,
  onRenderRequested,
  onProjectRefreshed,
}: ClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  const [activeTab, setActiveTab] = useState<EditorTab>('typography');

  const [title, setTitle] = useState(clip.title);
  const [startSec, setStartSec] = useState(clip.start_seconds);
  const [endSec, setEndSec] = useState(clip.end_seconds);
  const [framingMode, setFramingMode] = useState<FramingMode>(clip.framing_mode);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    () => clip.aspect_ratio ?? getAspectRatioForResolution(clip.export_resolution)
  );
  const [resolution, setResolution] = useState<ExportResolution>(clip.export_resolution);
  const [settings, setSettings] = useState<SubtitleSettings>(() => ({
    ...getDefaultStyleDefaults(clip.subtitle_settings.style),
    animation: 'none',
    ...clip.subtitle_settings,
  }));
  const [effects, setEffects] = useState<ClipEffects>(() => ({
    ...DEFAULT_CLIP_EFFECTS,
    ...(clip.effects ?? {}),
  }));
  const [cues, setCues] = useState<SubtitleCue[]>(clip.subtitle_cues);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.start_seconds);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const hasLocalVideo = Boolean(job.source_video_url) && !job.youtube_download_blocked;
  const maxDur = job.duration > 0 ? job.duration : 86400;
  const clipDuration = Math.max(1, endSec - startSec);
  const playbackSpeed = Math.max(0.5, Math.min(2.0, Number(effects.playbackSpeed) || 1));
  const outputDuration = clipDuration / playbackSpeed;
  const relativeTime = Math.max(0, Math.min(clipDuration, currentTime - startSec));

  // Sync state when switching between clips
  useEffect(() => {
    const resolvedRatio = clip.aspect_ratio ?? getAspectRatioForResolution(clip.export_resolution);
    setTitle(clip.title);
    setStartSec(clip.start_seconds);
    setEndSec(clip.end_seconds);
    setFramingMode(clip.framing_mode);
    setAspectRatio(resolvedRatio);
    setResolution(clip.export_resolution);
    setSettings({
      ...getDefaultStyleDefaults(clip.subtitle_settings.style),
      animation: 'none',
      ...clip.subtitle_settings,
    });
    setEffects({
      ...DEFAULT_CLIP_EFFECTS,
      ...(clip.effects ?? {}),
    });
    setCues(clip.subtitle_cues);
    setCurrentTime(clip.start_seconds);
    setSaveMessage(null);
    setError(null);
    setConfirmOverwrite(false);
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.currentTime = clip.start_seconds;
      videoRef.current.pause();
    }
  }, [clip.id]);

  // Apply live playbackSpeed directly to preview video elements
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
    if (bgVideoRef.current) {
      bgVideoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, hasLocalVideo]);

  // Simulated playhead clock when previewing without a downloaded MP4 (e.g., YouTube embed mode)
  useEffect(() => {
    if (hasLocalVideo || !isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 0.08 * playbackSpeed;
        return next >= endSec ? startSec : next;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [hasLocalVideo, isPlaying, startSec, endSec, playbackSpeed]);

  const activeCue = useMemo(() => {
    return cues.find((c) => relativeTime >= c.start_seconds && relativeTime <= c.end_seconds) ?? null;
  }, [cues, relativeTime]);

  // Compute live CSS filter & motion transforms matching server FFmpeg output
  const stageVisualStyle = useMemo(() => {
    const progress = clipDuration > 0 ? Math.max(0, Math.min(1, relativeTime / clipDuration)) : 0;

    // 1. Visual Color Look
    let filterStr = '';
    if (effects.visualPreset === 'cinematic_contrast') {
      filterStr = 'contrast(1.12) saturate(0.9) brightness(0.98)';
    } else if (effects.visualPreset === 'vivid_social') {
      filterStr = 'contrast(1.08) saturate(1.28) brightness(1.02)';
    } else if (effects.visualPreset === 'warm_film') {
      filterStr = 'contrast(1.05) saturate(1.1) sepia(0.16)';
    } else if (effects.visualPreset === 'monochrome') {
      filterStr = 'grayscale(1) contrast(1.12)';
    }

    // 2. Opacity / Blur / Transform from Intro + Outro + Motion
    let opacity = 1;
    let blurPx = 0;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;

    // Motion animation
    if (effects.motionAnimation === 'subtle_zoom') {
      scale *= 1 + 0.05 * progress;
    } else if (effects.motionAnimation === 'ken_burns_zoom_in') {
      scale *= 1 + 0.12 * progress;
    } else if (effects.motionAnimation === 'ken_burns_zoom_out') {
      scale *= 1.12 - 0.12 * progress;
    } else if (effects.motionAnimation === 'subtle_pan') {
      scale *= 1.1;
      translateX += Math.sin(relativeTime * 0.75) * 14;
    } else if (effects.motionAnimation === 'pulse_zoom') {
      scale *= 1.04 + 0.04 * Math.sin(relativeTime * 4.2);
    } else if (effects.motionAnimation === 'viral_dynamic') {
      scale *= 1 + 0.08 * progress;
      translateX += Math.sin(relativeTime * 1.4) * 6;
    }

    // Intro transition
    const introDur = Math.max(0.2, Math.min(clipDuration * 0.4, effects.introDuration));
    if (effects.introTransition === 'flash_cut' && relativeTime < 0.24) {
      const flashMult = 1 + 0.45 * (1 - relativeTime / 0.24);
      filterStr = `${filterStr} brightness(${flashMult.toFixed(2)})`.trim();
    } else if (relativeTime < introDur) {
      const p = relativeTime / introDur;
      if (effects.introTransition === 'fade_in') {
        opacity = Math.min(opacity, p);
      } else if (effects.introTransition === 'blur_reveal') {
        opacity = Math.min(opacity, Math.min(1, p * 1.4));
        blurPx += (1 - p) * 10;
      } else if (effects.introTransition === 'zoom_in') {
        opacity = Math.min(opacity, Math.min(1, p * 1.8));
        scale *= 1.16 - 0.16 * p;
      } else if (effects.introTransition === 'slide_up') {
        opacity = Math.min(opacity, Math.min(1, p * 1.8));
        translateY += (1 - p) * 32;
      }
    }

    // Outro transition
    const outroDur = Math.max(0.2, Math.min(clipDuration * 0.4, effects.outroDuration));
    const timeRemaining = Math.max(0, clipDuration - relativeTime);
    if (timeRemaining < outroDur) {
      const p = timeRemaining / outroDur; // 1 -> 0
      if (effects.outroTransition === 'fade_out') {
        opacity = Math.min(opacity, p);
      } else if (effects.outroTransition === 'blur_out') {
        opacity = Math.min(opacity, Math.min(1, p * 1.4));
        blurPx += (1 - p) * 10;
      } else if (effects.outroTransition === 'zoom_out') {
        opacity = Math.min(opacity, p);
        scale *= 1 + 0.12 * (1 - p);
      }
    }

    if (blurPx > 0.1) {
      filterStr = `${filterStr} blur(${blurPx.toFixed(1)}px)`.trim();
    }

    return {
      opacity,
      filter: filterStr || undefined,
      transform: `translate3d(${translateX.toFixed(1)}px, ${translateY.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
    };
  }, [effects, relativeTime, clipDuration]);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    if (bgVideoRef.current && Math.abs(bgVideoRef.current.currentTime - v.currentTime) > 0.15) {
      bgVideoRef.current.currentTime = v.currentTime;
    }
    setCurrentTime(v.currentTime);
    if (v.currentTime >= endSec) {
      v.currentTime = startSec;
      if (bgVideoRef.current) bgVideoRef.current.currentTime = startSec;
    }
  }

  function togglePlay() {
    if (!hasLocalVideo) {
      setIsPlaying((p) => !p);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < startSec || v.currentTime >= endSec) {
        v.currentTime = startSec;
      }
      if (bgVideoRef.current) {
        bgVideoRef.current.currentTime = v.currentTime;
        bgVideoRef.current.play().catch(() => {});
      }
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      v.pause();
      bgVideoRef.current?.pause();
      setIsPlaying(false);
    }
  }

  function seekToRelative(relSec: number) {
    const target = Math.max(startSec, Math.min(endSec, startSec + relSec));
    if (videoRef.current) {
      videoRef.current.currentTime = target;
    }
    if (bgVideoRef.current) {
      bgVideoRef.current.currentTime = target;
    }
    setCurrentTime(target);
  }

  function validateBounds(s: number, e: number): string | null {
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Timestamps must be valid numbers.';
    if (s < 0) return 'Start time cannot be less than 0 seconds.';
    if (e > maxDur) return `End time cannot exceed source video duration (${maxDur.toFixed(1)}s).`;
    if (e - s < 2) return 'Clip duration must be at least 2 seconds.';
    return null;
  }

  async function persistChanges(
    rebuildFromTranscript = false,
    applySmartCut = false
  ): Promise<ClipCandidate | null> {
    setError(null);
    setSaveMessage(null);
    const validationErr = validateBounds(startSec, endSec);
    if (validationErr) {
      setError(validationErr);
      return null;
    }
    if (!title.trim()) {
      setError('Clip title cannot be empty.');
      return null;
    }

    setSaving(true);
    try {
      const res = await updateClip(clip.id, {
        title: title.trim(),
        start_seconds: Number(startSec.toFixed(2)),
        end_seconds: Number(endSec.toFixed(2)),
        framing_mode: framingMode,
        aspect_ratio: aspectRatio,
        export_resolution: resolution,
        subtitle_settings: settings,
        effects,
        subtitle_cues: rebuildFromTranscript || applySmartCut ? undefined : cues,
        rebuild_cues_from_transcript: rebuildFromTranscript,
        apply_smart_cut: applySmartCut,
      });
      onClipUpdated(res.clip);
      setStartSec(res.clip.start_seconds);
      setEndSec(res.clip.end_seconds);
      if (rebuildFromTranscript || applySmartCut) {
        setCues(res.clip.subtitle_cues);
      }
      setSaveMessage(
        applySmartCut
          ? 'Applied Smart Cut: trimmed silence edges and cleaned filler words from captions.'
          : rebuildFromTranscript
            ? 'Saved boundaries and rebuilt subtitle cues from transcript.'
            : 'Saved output format, speed, transitions, and caption styling.'
      );
      return res.clip;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save clip edits.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  function handleAspectRatioChange(nextRatio: AspectRatio) {
    setAspectRatio(nextRatio);
    const currentHighOrFast =
      resolution === ASPECT_RATIO_CONFIG[aspectRatio].fastRes ? 'fastRes' : 'highRes';
    setResolution(ASPECT_RATIO_CONFIG[nextRatio][currentHighOrFast]);
  }

  function applyDurationPreset(seconds: number | 'full') {
    if (seconds === 'full') {
      const fullEnd = job.duration > 2 ? Number(job.duration.toFixed(2)) : Math.max(endSec, startSec + 60);
      setStartSec(0);
      setEndSec(fullEnd);
      return;
    }
    const clampedEnd = Math.min(maxDur, Number((startSec + seconds).toFixed(2)));
    if (clampedEnd - startSec < 2 && maxDur >= seconds) {
      const adjustedStart = Math.max(0, Number((maxDur - seconds).toFixed(2)));
      setStartSec(adjustedStart);
      setEndSec(Number(maxDur.toFixed(2)));
    } else {
      setEndSec(Math.max(startSec + 2, clampedEnd));
    }
  }

  async function handleRenderClick() {
    if (existingExport && existingExport.render_status === 'completed' && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    const saved = await persistChanges(false);
    if (saved) {
      onRenderRequested(saved);
    }
  }

  function addCue() {
    const lastEnd = cues.length > 0 ? cues[cues.length - 1].end_seconds : 0;
    const nextStart = Math.min(Math.max(0, clipDuration - 2), lastEnd);
    const nextEnd = Math.min(clipDuration, nextStart + 2.5);
    setCues([
      ...cues,
      {
        id: `cue-${Date.now()}`,
        start_seconds: Number(nextStart.toFixed(2)),
        end_seconds: Number(nextEnd.toFixed(2)),
        text: 'New caption line',
      },
    ]);
  }

  function updateCueField(id: string, field: keyof SubtitleCue, value: string | number) {
    setCues((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  function removeCue(id: string) {
    setCues((prev) => prev.filter((c) => c.id !== id));
  }

  function applyStylePreset(styleId: SubtitleStyleId) {
    const defaults = getDefaultStyleDefaults(styleId);
    setSettings((prev) => ({
      ...prev,
      style: styleId,
      fontFamily: defaults.fontFamily ?? prev.fontFamily,
      fontWeight: defaults.fontWeight ?? prev.fontWeight,
      uppercase: defaults.uppercase ?? prev.uppercase,
      textColor: defaults.textColor ?? prev.textColor,
      outlineColor: defaults.outlineColor ?? prev.outlineColor,
      outlineWidth: defaults.outlineWidth ?? prev.outlineWidth,
      animation: defaults.animation ?? prev.animation,
    }));
  }

  function applyViralProPreset() {
    setSettings((prev) => ({
      ...prev,
      style: 'word_cut',
      fontFamily: 'Noto Sans Display',
      fontWeight: 'extrabold',
      uppercase: false,
      textColor: '#FFFFFF',
      outlineColor: '#080B14',
      outlineWidth: 3.5,
      animation: 'viral_bounce',
      burnIn: true,
    }));
    setEffects((prev) => ({
      ...prev,
      introTransition: 'flash_cut',
      introDuration: 0.3,
      motionAnimation: 'viral_dynamic',
      visualPreset: 'vivid_social',
      smartCut: true,
      autoHookEnabled: true,
      autoHookStyle: 'statement',
      renderSpeed: 'fast',
    }));
    setSaveMessage('Applied Viral Pro Preset (Viral Bounce captions + Flash Cut + Viral Dynamic motion).');
  }

  const captionPositionClass =
    settings.position === 'top'
      ? 'top-[12%]'
      : settings.position === 'center'
        ? 'top-1/2 -translate-y-1/2'
        : 'bottom-[12%]';

  const captionAnimClass =
    settings.animation === 'fade'
      ? 'animate-caption-fade'
      : settings.animation === 'pop'
        ? 'animate-caption-pop'
        : settings.animation === 'viral_bounce'
          ? 'animate-caption-bounce'
          : settings.animation === 'slide_up'
            ? 'animate-caption-slide-up'
            : '';

  const previewFontCss = getCssFontFamily(settings.fontFamily);
  const previewWeight =
    settings.fontWeight === 'normal'
      ? 400
      : settings.fontWeight === 'extrabold'
        ? 800
        : 700;
  const outlineCol = settings.outlineColor || '#080B14';
  const strokePx = Math.max(0, Math.min(4, (settings.outlineWidth ?? 3.5) * 0.45));

  function renderAnimatedCaptionText(cue: SubtitleCue) {
    const cleaned = effects.smartCut ? applySmartCutToCueText(cue.text) : cue.text;
    const raw = settings.uppercase ? cleaned.toUpperCase() : cleaned;
    const words = raw.split(/\s+/).filter(Boolean);
    const cueLen = Math.max(0.3, cue.end_seconds - cue.start_seconds);
    const frac = Math.max(0, Math.min(1, (relativeTime - cue.start_seconds) / cueLen));
    const activeIdx = Math.min(words.length - 1, Math.max(0, Math.floor(frac * words.length)));

    if (settings.style === 'marker_sweep') {
      return words.map((w, idx) => (
        <span
          key={`${cue.id}-ms-${idx}`}
          className={
            idx === activeIdx
              ? 'mx-0.5 inline-block rounded bg-[#8B6FFF] px-1.5 py-0.5 text-[#080B14] transition-all duration-100'
              : 'mx-0.5 inline-block'
          }
        >
          {w}
        </span>
      ));
    }

    if (settings.style === 'negative_keywords') {
      const splitPoint = Math.max(1, Math.ceil(words.length / 2));
      return words.map((w, idx) => (
        <span
          key={`${cue.id}-nk-${idx}`}
          style={{
            color: idx >= splitPoint ? '#D49879' : settings.textColor || '#FFFFFF',
          }}
        >
          {w}
          {idx < words.length - 1 ? ' ' : ''}
        </span>
      ));
    }

    if (settings.style === 'karaoke') {
      const litCount = Math.max(1, Math.ceil(frac * words.length));
      return words.map((w, idx) => (
        <span
          key={`${cue.id}-kr-${idx}`}
          style={{
            color: idx < litCount ? '#20C7D9' : settings.textColor || '#FFFFFF',
            transition: 'color 90ms ease-out',
          }}
        >
          {w}
          {idx < words.length - 1 ? ' ' : ''}
        </span>
      ));
    }

    if (settings.animation !== 'typewriter') {
      return raw;
    }
    const litCount = Math.max(1, Math.ceil(frac * words.length));
    return words.map((w, idx) => (
      <span
        key={`${cue.id}-w-${idx}`}
        style={{ opacity: idx < litCount ? 1 : 0.32, transition: 'opacity 100ms ease-out' }}
      >
        {w}
        {idx < words.length - 1 ? ' ' : ''}
      </span>
    ));
  }

  const showAutoHookOverlay = Boolean(effects.autoHookEnabled) && relativeTime <= 3.5;
  const resolvedHookHeadline = (effects.autoHookText || title || clip.hook || clip.title).trim();

  return (
    <div className="space-y-5">
      {/* Studio Top Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-[#151E2E] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3 py-2 text-xs font-medium text-[#F8FAFC] hover:border-white/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Clips
          </button>
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-bold text-[#F8FAFC]">
              {title || clip.title}
            </h2>
            <p className="font-mono text-xs text-[#94A3B8] tabular-nums">
              {formatTimestamp(startSec)} – {formatTimestamp(endSec)} · {outputDuration.toFixed(1)}s out ({playbackSpeed}x) · {aspectRatio} · {settings.fontFamily || 'Noto Sans Display'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href={`/api/clips/${encodeURIComponent(clip.id)}/srt`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 transition-colors whitespace-nowrap"
          >
            Export .SRT
          </a>
          <a
            href={`/api/clips/${encodeURIComponent(clip.id)}/ass`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3 py-2 text-xs font-semibold text-[#20C7D9] hover:border-[#20C7D9]/40 transition-colors whitespace-nowrap"
          >
            Export .ASS
          </a>
          <button
            type="button"
            disabled={saving}
            onClick={() => persistChanges(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#101827] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Studio Edits'}
          </button>
          <button
            type="button"
            disabled={saving || !hasLocalVideo}
            onClick={handleRenderClick}
            title={
              hasLocalVideo
                ? `Render ${aspectRatio} MP4 with speed, framing, transitions & captions`
                : `Unlock MP4 export below preview to render ${aspectRatio} MP4 files`
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#7657FF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6444F5] disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Film className="h-3.5 w-3.5" />
            Render {aspectRatio} MP4
          </button>
        </div>
      </div>

      {/* Re-render overwrite confirmation */}
      {confirmOverwrite && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-200">
            An exported file already exists ({existingExport?.filename}). Re-rendering will replace the previous MP4 and SRT export with your new typography and effects.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmOverwrite(false)}
              className="rounded-lg border border-white/15 bg-[#101827] px-3 py-1.5 text-xs font-medium text-[#F8FAFC] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRenderClick}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-[#080B14] cursor-pointer"
            >
              Confirm Replace & Render
            </button>
          </div>
        </div>
      )}

      {saveMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Live Multi-Aspect Stage + Scrubber */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex flex-col items-center rounded-xl border border-white/[0.08] bg-[#151E2E] p-5">
            <div className="mb-3 flex w-full items-center justify-between text-xs text-[#94A3B8]">
              <span>
                Live {aspectRatio} Stage ({resolution})
              </span>
              <span className="font-mono text-[#20C7D9] tabular-nums">
                +{(relativeTime / playbackSpeed).toFixed(1)}s / {outputDuration.toFixed(1)}s ({playbackSpeed}x)
              </span>
            </div>

            {/* Dynamic Aspect Viewport (9:16, 1:1, 16:9) with live transitions, motion, look filter & animated captions */}
            <div
              className={`relative w-full overflow-hidden rounded-xl border border-white/15 bg-black ${ASPECT_RATIO_CONFIG[aspectRatio].previewAspectClass}`}
            >
              <div
                className="h-full w-full transition-none"
                style={stageVisualStyle}
              >
                {hasLocalVideo && job.source_video_url ? (
                  <>
                    {framingMode === 'blurred_background' && (
                      <video
                        ref={bgVideoRef}
                        src={job.source_video_url}
                        muted
                        playsInline
                        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-75"
                      />
                    )}
                    <video
                      ref={videoRef}
                      src={job.source_video_url}
                      playsInline
                      onTimeUpdate={handleTimeUpdate}
                      onPause={() => setIsPlaying(false)}
                      onPlay={() => setIsPlaying(true)}
                      className={
                        framingMode === 'blurred_background'
                          ? 'relative z-10 h-full w-full object-contain'
                          : framingMode === 'subject_crop'
                            ? 'relative z-10 h-full w-full object-cover scale-[1.16]'
                            : 'relative z-10 h-full w-full object-cover'
                      }
                    />
                  </>
                ) : job.youtube_video_id ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${job.youtube_video_id}?start=${Math.floor(startSec)}&end=${Math.ceil(endSec)}`}
                    title={title || clip.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="relative z-10 h-full w-full border-0"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#94A3B8]">
                    Video unavailable
                  </div>
                )}
              </div>

              {/* Auto Hook Opening Headline Overlay (0s - 3.5s) */}
              {showAutoHookOverlay && resolvedHookHeadline && (
                <div className="pointer-events-none absolute inset-x-4 top-[10%] z-20 flex justify-center animate-caption-slide-up">
                  {effects.autoHookStyle === 'editorial' && (
                    <div className="max-w-[90%] text-center drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]">
                      <span className="font-editorial text-lg font-semibold leading-tight text-[#D9F94D]">
                        {resolvedHookHeadline}
                      </span>
                    </div>
                  )}
                  {effects.autoHookStyle === 'statement' && (
                    <div className="max-w-[90%] rounded-lg bg-black/55 px-3 py-1.5 text-left backdrop-blur-xs">
                      <span className="font-display text-sm font-extrabold leading-tight text-white">
                        {resolvedHookHeadline}
                      </span>
                    </div>
                  )}
                  {(effects.autoHookStyle === 'classic' || !effects.autoHookStyle) && (
                    <div className="max-w-[90%] rounded-md bg-white px-3 py-1.5 text-center shadow-lg">
                      <span className="font-display text-xs font-extrabold uppercase tracking-tight text-[#080B14]">
                        {resolvedHookHeadline}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Safe Margin Live Subtitle Overlay */}
              {settings.burnIn && activeCue && (
                <div
                  key={activeCue.id}
                  className={`pointer-events-none absolute left-[7.5%] right-[7.5%] z-20 flex justify-center text-center ${captionPositionClass} ${captionAnimClass}`}
                >
                  <span
                    className={`leading-snug ${
                      settings.style === 'minimal_clean' ? 'bg-[#080B14]/85 px-3 py-1 rounded' : ''
                    }`}
                    style={{
                      fontFamily: previewFontCss,
                      fontWeight: previewWeight,
                      fontStyle: settings.italic ? 'italic' : 'normal',
                      color: settings.textColor || '#FFFFFF',
                      fontSize: `${Math.max(12, Math.round(settings.fontSize * 0.56))}px`,
                      WebkitTextStroke:
                        settings.style === 'minimal_clean' ||
                        settings.style === 'marker_sweep' ||
                        strokePx <= 0
                          ? undefined
                          : `${strokePx}px ${outlineCol}`,
                      paintOrder: 'stroke fill',
                      textShadow:
                        settings.style === 'minimal_clean'
                          ? undefined
                          : `0 2px 6px rgba(0,0,0,0.92)`,
                    }}
                  >
                    {renderAnimatedCaptionText(activeCue)}
                  </span>
                </div>
              )}
            </div>

            {/* Scrubber & Playback Controls */}
            <div className="mt-4 w-full max-w-[295px] space-y-2.5">
              <div>
                <input
                  type="range"
                  min={0}
                  max={clipDuration}
                  step={0.1}
                  value={relativeTime}
                  onChange={(e) => seekToRelative(Number(e.target.value))}
                  aria-label="Scrub clip timeline preview"
                  className="w-full accent-[#20C7D9] cursor-pointer"
                />
                <div className="flex justify-between font-mono text-[10px] text-[#94A3B8] tabular-nums">
                  <span>Intro: {effects.introTransition.replace('_', ' ')}</span>
                  <span>Outro: {effects.outroTransition.replace('_', ' ')}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#101827] border border-white/15 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 whitespace-nowrap cursor-pointer"
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {isPlaying
                    ? 'Pause'
                    : hasLocalVideo
                      ? 'Play Clip Preview'
                      : 'Simulate Caption & FX Preview'}
                </button>
                <button
                  type="button"
                  onClick={() => seekToRelative(0)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#101827] px-3 py-2 text-xs text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                  title="Restart from clip start"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {!hasLocalVideo && (
            <YoutubeMp4UnlockPanel
              compact
              job={job}
              onUnlocked={async () => {
                if (onProjectRefreshed) await onProjectRefreshed();
                setSaveMessage('Source MP4 is now attached! Click "Render 9:16 MP4" above to export.');
              }}
            />
          )}
        </div>

        {/* Right Column: Segmented Studio Controls */}
        <div className="lg:col-span-7 space-y-5">
          {/* Segmented Studio Navigation Tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-[#101827] p-1 sm:grid-cols-4">
            {(
              [
                ['typography', 'Captions & Font', TypeIcon],
                ['effects', 'Transitions & FX', Wand2],
                ['cut', 'Output, Cut & Speed', Scissors],
                ['cues', `Cues (${cues.length})`, Sparkles],
              ] as Array<[EditorTab, string, typeof TypeIcon]>
            ).map(([tabId, label, Icon]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === tabId
                    ? 'bg-[#7657FF] text-white'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* TAB 1: Manual Font, Typography, Colors & Caption Animations */}
          {activeTab === 'typography' && (
            <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
                    Manual Caption Typography & Animation
                  </h3>
                  <p className="text-xs text-[#94A3B8]">
                    Select custom fonts, colors, outlines, and motion synced to live preview & MP4 burn-in.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={applyViralProPreset}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#7657FF]/45 bg-[#7657FF]/15 px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:bg-[#7657FF]/25 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Zap className="h-3.5 w-3.5 text-[#20C7D9]" />
                    Apply Viral Pro Preset
                  </button>
                  <label className="flex items-center gap-2 text-xs text-[#F8FAFC] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.burnIn}
                      onChange={(e) => setSettings({ ...settings, burnIn: e.target.checked })}
                      className="h-4 w-4 rounded accent-[#7657FF]"
                    />
                    Burn captions into MP4
                  </label>
                </div>
              </div>

              {/* Starter Preset + Caption Animation */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-[#94A3B8]" htmlFor="caption-preset-select">
                    Style Preset
                  </label>
                  <select
                    id="caption-preset-select"
                    value={settings.style}
                    onChange={(e) => applyStylePreset(e.target.value as SubtitleStyleId)}
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                  >
                    <option value="word_cut">Word Cut (Stacked Impact)</option>
                    <option value="marker_sweep">Marker Sweep (Violet Highlight)</option>
                    <option value="negative_keywords">Negative Keywords (Two-Tone)</option>
                    <option value="karaoke">Karaoke (Word Highlight Sweep)</option>
                    <option value="classic_white">Classic White (Crisp Outline)</option>
                    <option value="bold_creator">Bold Creator (Gold Impact)</option>
                    <option value="minimal_clean">Minimal Clean (Boxed Strip)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-[#94A3B8]" htmlFor="caption-anim-select">
                    Caption Animation
                  </label>
                  <select
                    id="caption-anim-select"
                    value={settings.animation || 'none'}
                    onChange={(e) =>
                      setSettings({ ...settings, animation: e.target.value as CaptionAnimation })
                    }
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                  >
                    <option value="none">Static Cut (No Animation)</option>
                    <option value="viral_bounce">Viral Bounce (TikTok Pop)</option>
                    <option value="pop">Elastic Pop Bounce</option>
                    <option value="fade">Smooth Fade In / Out</option>
                    <option value="slide_up">Slide Up Reveal</option>
                    <option value="typewriter">Word-by-Word Karaoke</option>
                  </select>
                </div>
              </div>

              {/* Manual Font Family Selector Grid */}
              <div className="space-y-2 border-t border-white/[0.08] pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#94A3B8]">Caption Font Family</span>
                  <span className="font-mono text-[11px] text-[#20C7D9]">
                    {settings.fontFamily || 'Noto Sans Display'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CAPTION_FONT_OPTIONS.map((font) => {
                    const selected = (settings.fontFamily || 'Noto Sans Display') === font.value;
                    return (
                      <button
                        key={font.value}
                        type="button"
                        onClick={() => setSettings({ ...settings, fontFamily: font.value })}
                        className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#7657FF] bg-[#7657FF]/15 text-[#F8FAFC]'
                            : 'border-white/[0.08] bg-[#101827] text-[#94A3B8] hover:border-white/20 hover:text-[#F8FAFC]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div
                            className="truncate text-sm text-[#F8FAFC]"
                            style={{ fontFamily: font.cssFamily, fontWeight: 700 }}
                          >
                            {font.label}
                          </div>
                          <div className="text-[11px] text-[#94A3B8]">{font.category}</div>
                        </div>
                        <span
                          className="ml-2 shrink-0 text-sm text-[#20C7D9]"
                          style={{ fontFamily: font.cssFamily, fontWeight: 700 }}
                        >
                          Aa
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Weight, Italic, Uppercase, Size & Position */}
              <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-3">
                <div>
                  <span className="block text-xs text-[#94A3B8]">Font Weight</span>
                  <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-[#080B14] p-1">
                    {(
                      [
                        ['normal', 'Regular'],
                        ['bold', 'Bold'],
                        ['extrabold', 'Heavy'],
                      ] as Array<[CaptionFontWeight, string]>
                    ).map(([w, lbl]) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setSettings({ ...settings, fontWeight: w })}
                        className={`rounded py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                          (settings.fontWeight || 'bold') === w
                            ? 'bg-[#7657FF] text-white'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs text-[#94A3B8]">Text Transform</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-[#080B14] p-1">
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, italic: !settings.italic })}
                      className={`rounded py-1 text-[11px] font-medium italic transition-colors cursor-pointer ${
                        settings.italic
                          ? 'bg-[#20C7D9] text-[#080B14] font-semibold'
                          : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      Italic
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, uppercase: !settings.uppercase })}
                      className={`rounded py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                        settings.uppercase
                          ? 'bg-[#20C7D9] text-[#080B14] font-semibold'
                          : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      ALL CAPS
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[#94A3B8]" htmlFor="caption-pos-select">
                    Vertical Position
                  </label>
                  <select
                    id="caption-pos-select"
                    value={settings.position}
                    onChange={(e) =>
                      setSettings({ ...settings, position: e.target.value as SubtitlePosition })
                    }
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                  >
                    <option value="bottom">Bottom Safe Zone</option>
                    <option value="center">Center Frame</option>
                    <option value="top">Top Safe Zone</option>
                  </select>
                </div>
              </div>

              {/* Font Size + Color + Outline Controls */}
              <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                    <span>Font Size</span>
                    <span className="font-mono text-[#F8FAFC] tabular-nums">{settings.fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={18}
                    max={48}
                    value={settings.fontSize}
                    onChange={(e) =>
                      setSettings({ ...settings, fontSize: Number(e.target.value) })
                    }
                    className="mt-2.5 w-full accent-[#7657FF]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                    <span>Outline Stroke Width</span>
                    <span className="font-mono text-[#F8FAFC] tabular-nums">
                      {(settings.outlineWidth ?? 3.5).toFixed(1)}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={0.5}
                    value={settings.outlineWidth ?? 3.5}
                    onChange={(e) =>
                      setSettings({ ...settings, outlineWidth: Number(e.target.value) })
                    }
                    className="mt-2.5 w-full accent-[#20C7D9]"
                  />
                </div>

                <div>
                  <span className="block text-xs text-[#94A3B8]">Caption Text Color</span>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {COLOR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setSettings({ ...settings, textColor: hex })}
                        aria-label={`Set caption color ${hex}`}
                        className={`h-6 w-6 rounded-md border transition-transform cursor-pointer ${
                          (settings.textColor || '#FFFFFF').toUpperCase() === hex
                            ? 'border-[#20C7D9] scale-110'
                            : 'border-white/20'
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                    <input
                      type="color"
                      value={settings.textColor || '#FFFFFF'}
                      onChange={(e) => setSettings({ ...settings, textColor: e.target.value })}
                      aria-label="Custom caption text color"
                      className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent p-0"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-xs text-[#94A3B8]">Outline Color</span>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {OUTLINE_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setSettings({ ...settings, outlineColor: hex })}
                        aria-label={`Set outline color ${hex}`}
                        className={`h-6 w-6 rounded-md border transition-transform cursor-pointer ${
                          (settings.outlineColor || '#080B14').toUpperCase() === hex
                            ? 'border-[#20C7D9] scale-110'
                            : 'border-white/20'
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                    <input
                      type="color"
                      value={settings.outlineColor || '#080B14'}
                      onChange={(e) => setSettings({ ...settings, outlineColor: e.target.value })}
                      aria-label="Custom outline color"
                      className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent p-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Video Transitions, Motion Animations & Color Looks */}
          {activeTab === 'effects' && (
            <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
                    Video Transitions, Motion & Color Grading
                  </h3>
                  <p className="text-xs text-[#94A3B8]">
                    Preview smooth intro/outro transitions, continuous camera motion, and color looks live and bake them directly into exported 9:16 MP4s via FFmpeg.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={applyViralProPreset}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#7657FF]/45 bg-[#7657FF]/15 px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:bg-[#7657FF]/25 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Zap className="h-3.5 w-3.5 text-[#20C7D9]" />
                  Apply Viral Pro Preset
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-white/[0.06] bg-[#101827] p-4 space-y-3">
                  <label className="block text-xs font-semibold text-[#F8FAFC]" htmlFor="intro-fx-select">
                    Intro Transition
                  </label>
                  <select
                    id="intro-fx-select"
                    value={effects.introTransition}
                    onChange={(e) =>
                      setEffects({ ...effects, introTransition: e.target.value as IntroTransition })
                    }
                    className="w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                  >
                    <option value="none">None (Hard Cut)</option>
                    <option value="flash_cut">Viral Flash Cut Opener</option>
                    <option value="fade_in">Smooth Fade In (+ Audio)</option>
                    <option value="zoom_in">Punch Zoom In Settle</option>
                    <option value="slide_up">Slide Up Frame Reveal</option>
                    <option value="blur_reveal">Blur Focus Reveal</option>
                  </select>
                  <div>
                    <div className="flex justify-between text-[11px] text-[#94A3B8]">
                      <span>Intro Duration</span>
                      <span className="font-mono text-[#20C7D9] tabular-nums">
                        {effects.introDuration.toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={2.0}
                      step={0.1}
                      value={effects.introDuration}
                      onChange={(e) =>
                        setEffects({ ...effects, introDuration: Number(e.target.value) })
                      }
                      className="mt-1.5 w-full accent-[#7657FF]"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.06] bg-[#101827] p-4 space-y-3">
                  <label className="block text-xs font-semibold text-[#F8FAFC]" htmlFor="outro-fx-select">
                    Outro Transition
                  </label>
                  <select
                    id="outro-fx-select"
                    value={effects.outroTransition}
                    onChange={(e) =>
                      setEffects({ ...effects, outroTransition: e.target.value as OutroTransition })
                    }
                    className="w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                  >
                    <option value="none">None (Hard Cut)</option>
                    <option value="fade_out">Smooth Fade Out (+ Audio)</option>
                    <option value="zoom_out">Zoom Pull Out Fade</option>
                    <option value="blur_out">Soft Blur Out</option>
                  </select>
                  <div>
                    <div className="flex justify-between text-[11px] text-[#94A3B8]">
                      <span>Outro Duration</span>
                      <span className="font-mono text-[#20C7D9] tabular-nums">
                        {effects.outroDuration.toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={2.0}
                      step={0.1}
                      value={effects.outroDuration}
                      onChange={(e) =>
                        setEffects({ ...effects, outroDuration: Number(e.target.value) })
                      }
                      className="mt-1.5 w-full accent-[#7657FF]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-2">
                <div>
                  <span className="block text-xs font-semibold text-[#F8FAFC]">
                    Continuous Camera Animation
                  </span>
                  <div className="mt-2 space-y-1.5">
                    {(
                      [
                        ['none', 'Static Camera', 'Original locked framing'],
                        ['viral_dynamic', 'Viral Dynamic Push + Drift', 'Continuous 8% zoom push with gentle horizontal drift'],
                        ['subtle_zoom', 'Subtle Zoom (1.0 → 1.05x)', 'Gentle Ken Burns push across the clip'],
                        ['ken_burns_zoom_in', 'Ken Burns Zoom In', 'Strong 12% push-in across clip'],
                        ['ken_burns_zoom_out', 'Ken Burns Zoom Out', 'Gradual 12% pull-back reveal'],
                        ['subtle_pan', 'Smooth Horizontal Pan', 'Gentle drifting motion wave'],
                        ['pulse_zoom', 'Subtle Energy Pulse', 'Gentle rhythmic breathing zoom'],
                      ] as Array<[MotionAnimation, string, string]>
                    ).map(([id, name, desc]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setEffects({ ...effects, motionAnimation: id })}
                        className={`w-full rounded-lg border px-3.5 py-2 text-left transition-colors cursor-pointer ${
                          effects.motionAnimation === id
                            ? 'border-[#7657FF] bg-[#7657FF]/15 text-[#F8FAFC]'
                            : 'border-white/[0.06] bg-[#101827] text-[#94A3B8] hover:border-white/20'
                        }`}
                      >
                        <div className="text-xs font-semibold text-[#F8FAFC]">{name}</div>
                        <div className="text-[11px] text-[#94A3B8]">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-[#F8FAFC]">
                    Color Look Preset
                  </span>
                  <div className="mt-2 space-y-1.5">
                    {(
                      [
                        ['natural', 'Natural Source', 'Unmodified original colors'],
                        ['cinematic_contrast', 'Cinematic Contrast', 'Deep shadows & filmic contrast'],
                        ['vivid_social', 'Vivid Social', 'Boosted saturation & pop for Reels/Shorts'],
                        ['warm_film', 'Warm Studio Film', 'Golden highlights & soft contrast'],
                        ['monochrome', 'High-Contrast Noir', 'Crisp black & white grade'],
                      ] as Array<[VisualFilterPreset, string, string]>
                    ).map(([id, name, desc]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setEffects({ ...effects, visualPreset: id })}
                        className={`w-full rounded-lg border px-3.5 py-2 text-left transition-colors cursor-pointer ${
                          effects.visualPreset === id
                            ? 'border-[#20C7D9] bg-[#20C7D9]/15 text-[#F8FAFC]'
                            : 'border-white/[0.06] bg-[#101827] text-[#94A3B8] hover:border-white/20'
                        }`}
                      >
                        <div className="text-xs font-semibold text-[#F8FAFC]">{name}</div>
                        <div className="text-[11px] text-[#94A3B8]">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Auto Hook Opening Headline Card */}
              <div className="border-t border-white/[0.08] pt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="block text-xs font-semibold text-[#F8FAFC]">
                      Auto Hook Opening Headline (0s – 3.5s)
                    </span>
                    <span className="text-[11px] text-[#94A3B8]">
                      Display an opening hook headline across the first 3.5 seconds of your vertical clip.
                    </span>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#F8FAFC] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(effects.autoHookEnabled)}
                      onChange={(e) =>
                        setEffects({ ...effects, autoHookEnabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-[#7657FF]"
                    />
                    Enable Auto Hook
                  </label>
                </div>

                {effects.autoHookEnabled && (
                  <div className="space-y-3 rounded-lg border border-white/[0.06] bg-[#101827] p-4">
                    <div>
                      <label className="block text-xs text-[#94A3B8]" htmlFor="auto-hook-text">
                        Opening Hook Headline Text
                      </label>
                      <input
                        id="auto-hook-text"
                        type="text"
                        value={effects.autoHookText ?? ''}
                        onChange={(e) => setEffects({ ...effects, autoHookText: e.target.value })}
                        placeholder={title || clip.hook || 'Enter opening hook headline...'}
                        className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:border-[#7657FF] focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {AUTO_HOOK_STYLE_CARDS.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() =>
                            setEffects({ ...effects, autoHookStyle: card.id as AutoHookStyle })
                          }
                          className={`slyce-hover-card rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                            (effects.autoHookStyle ?? 'editorial') === card.id
                              ? 'border-[#7657FF] bg-[#7657FF]/15 text-[#F8FAFC]'
                              : 'border-white/[0.08] bg-[#080B14] text-[#94A3B8] hover:text-[#F8FAFC]'
                          }`}
                        >
                          {card.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Output Format, Duration, Speed, Boundaries & Reframing */}
          {activeTab === 'cut' && (
            <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-5 space-y-5">
              <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
                Output Aspect Ratio, Duration, Speed & Reframing
              </h3>

              <div>
                <label className="block text-xs text-[#94A3B8]" htmlFor="clip-title-input">
                  Clip Title
                </label>
                <input
                  id="clip-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#080B14] px-3.5 py-2 text-sm text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                />
              </div>

              {/* Quick Duration Presets + Source Boundaries */}
              <div className="space-y-3 border-t border-white/[0.08] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-[#94A3B8]">Quick Duration Preset</span>
                  <div className="inline-flex flex-wrap gap-1 rounded-lg bg-[#080B14] p-1">
                    {[15, 30, 45, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => applyDurationPreset(sec)}
                        className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                          Math.abs(clipDuration - sec) < 1
                            ? 'bg-[#7657FF] text-white'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => applyDurationPreset('full')}
                      className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-[#20C7D9] hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      Full Video
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-[#94A3B8]" htmlFor="clip-start-input">
                      Start Time (seconds{job.duration > 0 ? `, max ${maxDur.toFixed(1)}s` : ''})
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id="clip-start-input"
                        type="number"
                        step="0.5"
                        min={0}
                        max={job.duration > 0 ? maxDur : undefined}
                        value={startSec}
                        onChange={(e) => setStartSec(Number(e.target.value))}
                        className="w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 font-mono text-sm text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => setStartSec(Number(currentTime.toFixed(2)))}
                        className="rounded-lg border border-white/15 bg-[#101827] px-2.5 py-2 text-[11px] text-[#20C7D9] hover:border-[#20C7D9]/40 whitespace-nowrap cursor-pointer"
                      >
                        Use Playhead
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[#94A3B8]" htmlFor="clip-end-input">
                      End Time (seconds{job.duration > 0 ? `, max ${maxDur.toFixed(1)}s` : ''})
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id="clip-end-input"
                        type="number"
                        step="0.5"
                        min={0}
                        max={job.duration > 0 ? maxDur : undefined}
                        value={endSec}
                        onChange={(e) => setEndSec(Number(e.target.value))}
                        className="w-full rounded-lg border border-white/15 bg-[#080B14] px-3 py-2 font-mono text-sm text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => setEndSec(Number(currentTime.toFixed(2)))}
                        className="rounded-lg border border-white/15 bg-[#101827] px-2.5 py-2 text-[11px] text-[#20C7D9] hover:border-[#20C7D9]/40 whitespace-nowrap cursor-pointer"
                      >
                        Use Playhead
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => persistChanges(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#20C7D9] hover:underline cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Save boundaries & re-sync captions from transcript
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => persistChanges(false, true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#20C7D9]/35 bg-[#20C7D9]/10 px-3 py-1.5 text-xs font-semibold text-[#20C7D9] hover:bg-[#20C7D9]/20 disabled:opacity-50 cursor-pointer"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    Trim Silence & Clean Fillers Now
                  </button>
                </div>
              </div>

              {/* Aspect Ratio + Resolution + Playback Speed */}
              <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-2">
                <div>
                  <span className="block text-xs text-[#94A3B8]">Output Aspect Ratio</span>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded-lg bg-[#080B14] p-1">
                    {(['9:16', '1:1', '16:9'] as AspectRatio[]).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => handleAspectRatioChange(ratio)}
                        className={`rounded-md py-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                          aspectRatio === ratio
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
                  <span className="block text-xs text-[#94A3B8]">Export Resolution</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-lg bg-[#080B14] p-1">
                    {(
                      [
                        ASPECT_RATIO_CONFIG[aspectRatio].highRes,
                        ASPECT_RATIO_CONFIG[aspectRatio].fastRes,
                      ] as ExportResolution[]
                    ).map((resOpt) => (
                      <button
                        key={resOpt}
                        type="button"
                        onClick={() => setResolution(resOpt)}
                        className={`rounded-md py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
                          resolution === resOpt
                            ? 'bg-[#7657FF] text-white'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        {resOpt.replace('x', '×')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Speed + Reframe + Smart Cut & Subtle Zoom switches */}
              <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                    <span>Playback & Export Speed</span>
                    <span className="font-mono text-[#20C7D9] tabular-nums">
                      {playbackSpeed}x ({outputDuration.toFixed(1)}s out)
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-6 gap-1 rounded-lg bg-[#080B14] p-1">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => setEffects({ ...effects, playbackSpeed: spd })}
                        className={`rounded-md py-1.5 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                          Math.abs(playbackSpeed - spd) < 0.01
                            ? 'bg-[#20C7D9] text-[#080B14]'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs text-[#94A3B8]">Reframe Crop Mode</span>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded-lg bg-[#080B14] p-1">
                    {(
                      [
                        ['auto', 'Auto'],
                        ['subject', 'Subject'],
                        ['off', 'Off (Blur)'],
                      ] as Array<[ReframeMode, string]>
                    ).map(([rfMode, label]) => {
                      const active = framingToReframeMode(framingMode) === rfMode;
                      return (
                        <button
                          key={rfMode}
                          type="button"
                          onClick={() => setFramingMode(reframeModeToFraming(rfMode))}
                          className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            active
                              ? 'bg-[#7657FF] text-white'
                              : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] pt-3 text-xs">
                <div className="flex flex-wrap items-center gap-6">
                  <label className="inline-flex items-center gap-2 text-[#F8FAFC] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(effects.smartCut)}
                      onChange={(e) => setEffects({ ...effects, smartCut: e.target.checked })}
                      className="h-4 w-4 rounded accent-[#20C7D9]"
                    />
                    <span>Smart cut (clean filler words & silence)</span>
                  </label>

                  <label className="inline-flex items-center gap-2 text-[#F8FAFC] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        effects.motionAnimation === 'subtle_zoom' ||
                        effects.motionAnimation === 'viral_dynamic'
                      }
                      onChange={(e) =>
                        setEffects({
                          ...effects,
                          motionAnimation: e.target.checked ? 'viral_dynamic' : 'none',
                        })
                      }
                      className="h-4 w-4 rounded accent-[#20C7D9]"
                    />
                    <span>Viral dynamic motion (1.0 → 1.08x push + drift)</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[#94A3B8]">Render Speed</span>
                  <div className="inline-flex rounded-lg bg-[#080B14] p-0.5 border border-white/[0.08]">
                    {(
                      [
                        ['fast', 'Fast 10x'],
                        ['quality', 'Studio Quality'],
                      ] as Array<['fast' | 'quality', string]>
                    ).map(([modeId, lbl]) => (
                      <button
                        key={modeId}
                        type="button"
                        onClick={() => setEffects({ ...effects, renderSpeed: modeId })}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                          (effects.renderSpeed ?? 'fast') === modeId
                            ? 'bg-[#7657FF] text-white'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Subtitle Cue Timing List */}
          {activeTab === 'cues' && (
            <div className="rounded-xl border border-white/[0.08] bg-[#151E2E] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#F8FAFC]">
                    Subtitle Cues ({cues.length})
                  </h3>
                  <p className="text-xs text-[#94A3B8]">
                    Timing is relative to clip start (0.0s). Click Jump to preview exact cue timing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addCue}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#101827] px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:border-white/30 whitespace-nowrap cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5 text-[#20C7D9]" />
                  Add Cue
                </button>
              </div>

              <div className="max-h-[440px] space-y-2.5 overflow-y-auto pr-1">
                {cues.length === 0 ? (
                  <p className="py-10 text-center text-xs text-[#94A3B8]">
                    No subtitle cues yet. Click “Add Cue” or re-sync from transcript in Cut & Framing.
                  </p>
                ) : (
                  cues.map((cue) => (
                    <div
                      key={cue.id}
                      className="rounded-lg border border-white/[0.06] bg-[#101827] p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            max={clipDuration}
                            value={cue.start_seconds}
                            onChange={(e) =>
                              updateCueField(cue.id, 'start_seconds', Number(e.target.value))
                            }
                            aria-label="Cue start seconds"
                            className="w-20 rounded border border-white/10 bg-[#080B14] px-2 py-1 font-mono text-xs text-[#20C7D9] tabular-nums"
                          />
                          <span className="text-xs text-[#94A3B8]">to</span>
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            max={clipDuration}
                            value={cue.end_seconds}
                            onChange={(e) =>
                              updateCueField(cue.id, 'end_seconds', Number(e.target.value))
                            }
                            aria-label="Cue end seconds"
                            className="w-20 rounded border border-white/10 bg-[#080B14] px-2 py-1 font-mono text-xs text-[#20C7D9] tabular-nums"
                          />
                        </div>

                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => seekToRelative(cue.start_seconds + 0.05)}
                            className="text-[11px] font-medium text-[#94A3B8] hover:text-[#20C7D9] cursor-pointer"
                          >
                            Jump
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCue(cue.id)}
                            className="text-[#94A3B8] hover:text-rose-400 cursor-pointer"
                            aria-label="Delete subtitle cue"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={cue.text}
                        onChange={(e) => updateCueField(cue.id, 'text', e.target.value)}
                        className="w-full rounded border border-white/10 bg-[#080B14] px-3 py-1.5 text-xs text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
