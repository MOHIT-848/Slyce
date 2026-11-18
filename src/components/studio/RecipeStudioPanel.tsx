import {
  Anchor,
  Captions,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Crop,
  Focus,
  Gauge,
  Languages,
  LayoutGrid,
  Music,
  Palette,
  Scissors,
  Sparkles,
  Zap,
  ZoomIn,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  ASPECT_RATIO_CONFIG,
  AUTO_HOOK_STYLE_CARDS,
  BRAND_KIT_OPTIONS,
  CAPTION_PRESET_CARDS,
  PLAYBACK_SPEED_OPTIONS,
  RECIPE_OPTIONS,
  SPOKEN_LANGUAGE_OPTIONS,
  type AspectRatio,
  type AutoHookMode,
  type BrandKitId,
  type CaptionMode,
  type GeminiModelOption,
  type RecipeConfig,
  type RecipeId,
  type ReframeMode,
  type SpokenLanguageOption,
  type TargetDurationPreset,
} from '../../types/clipforge';

interface RecipeStudioPanelProps {
  value: RecipeConfig;
  onChange: (next: RecipeConfig) => void;
  defaultExpanded?: boolean;
  onApplyToStudio?: () => void;
  ctaLabel?: string;
}

export function RecipeStudioPanel({
  value,
  onChange,
  defaultExpanded = true,
  onApplyToStudio,
  ctaLabel,
}: RecipeStudioPanelProps) {
  const [settingsExpanded, setSettingsExpanded] = useState(defaultExpanded);
  const [hookVideoReady, setHookVideoReady] = useState<Record<string, boolean>>({});
  const carouselRef = useRef<HTMLDivElement | null>(null);

  function scrollPresetsRight() {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: 210, behavior: 'smooth' });
  }

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-[#14171F] p-4 sm:p-5 text-[#F8FAFC] shadow-2xl">
      {/* Top Bar: Recipe & Brand Kit Selectors */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="slyce-hover-card flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#1D212B] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1D63FF] text-white">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#F8FAFC] whitespace-nowrap">Recipe</span>
          </div>
          <select
            aria-label="Select clipping recipe"
            value={value.recipe}
            onChange={(e) => onChange({ ...value, recipe: e.target.value as RecipeId })}
            className="min-w-0 truncate bg-transparent text-right text-xs font-medium text-[#CBD5E1] focus:outline-none cursor-pointer"
          >
            {RECIPE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="bg-[#14171F] text-[#F8FAFC]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="slyce-hover-card flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#1D212B] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3FB950] text-[#080B14]">
              <Palette className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#F8FAFC] whitespace-nowrap">Brand kit</span>
          </div>
          <select
            aria-label="Select brand kit"
            value={value.brandKit}
            onChange={(e) => onChange({ ...value, brandKit: e.target.value as BrandKitId })}
            className="min-w-0 truncate bg-transparent text-right text-xs font-medium text-[#CBD5E1] focus:outline-none cursor-pointer"
          >
            {BRAND_KIT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="bg-[#14171F] text-[#F8FAFC]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#94A3B8]">
        Your Recipe sets which edits run. Your brand kit sets the look, like your logo, intro, outro and caption style.
      </p>

      {/* Collapsible Recipe Settings Toggle */}
      <button
        type="button"
        onClick={() => setSettingsExpanded((v) => !v)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#CBD5E1] hover:text-[#F8FAFC] transition-colors cursor-pointer"
      >
        <span>Recipe settings</span>
        {settingsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {settingsExpanded && (
        <div className="mt-4 space-y-5 border-t border-white/[0.07] pt-4">
          <div className="text-xs font-medium text-[#94A3B8]">Essentials</div>

          {/* Captions Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8FAFC] text-[#080B14]">
                  <Captions className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-[#F8FAFC]">Captions</span>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={value.captionsEnabled}
                aria-label="Toggle automatic captions"
                onClick={() => onChange({ ...value, captionsEnabled: !value.captionsEnabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  value.captionsEnabled ? 'bg-[#F8FAFC]' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-[#14171F] transition-transform duration-150 ${
                    value.captionsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Caption Source Mode: Auto vs Speech vs Song Lyrics */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#10141D] px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                <Music className="h-3.5 w-3.5 text-[#20C7D9]" />
                <span>Caption source</span>
              </div>
              <div className="inline-flex rounded-md bg-[#181C26] p-0.5">
                {(
                  [
                    ['auto', 'Auto (Speech + Lyrics)'],
                    ['speech', 'Speech'],
                    ['lyrics', 'Song Lyrics'],
                  ] as Array<[CaptionMode, string]>
                ).map(([modeId, modeLabel]) => {
                  const active = (value.captionMode ?? 'auto') === modeId;
                  return (
                    <button
                      key={modeId}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          captionsEnabled: true,
                          captionMode: modeId,
                          ...(modeId === 'lyrics' ? { captionPreset: 'karaoke' } : {}),
                        })
                      }
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-[#7657FF] text-white'
                          : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {modeLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Caption Style Cards Strip */}
            <div className="relative flex items-center gap-2">
              <div
                ref={carouselRef}
                className={`flex gap-2.5 overflow-x-auto pb-1 pr-8 transition-opacity ${
                  value.captionsEnabled ? 'opacity-100' : 'opacity-45'
                }`}
              >
                {CAPTION_PRESET_CARDS.map((preset) => {
                  const isSelected = value.captionPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          captionsEnabled: true,
                          captionPreset: preset.id,
                        })
                      }
                      className="group shrink-0 text-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#20C7D9]"
                    >
                      <div
                        className={`slyce-hover-card relative flex h-[84px] w-[112px] flex-col items-center justify-center rounded-xl border px-2 transition-all ${
                          isSelected
                            ? 'border-white bg-[#2C2F36]'
                            : 'border-white/[0.08] bg-[#22252C] group-hover:border-white/30'
                        }`}
                      >
                        {isSelected && (
                          <span className="absolute top-1.5 left-1.5 rounded bg-[#14171F]/90 px-1.5 py-0.5 text-[9px] font-semibold text-[#F8FAFC]">
                            Selected
                          </span>
                        )}

                        {preset.id === 'word_cut' && (
                          <div className="text-[15px] font-extrabold leading-tight tracking-tight text-white">
                            <div>To get</div>
                            <div>started</div>
                          </div>
                        )}

                        {preset.id === 'clean_cut' && (
                          <div className="text-[14px] font-bold leading-tight text-[#F1F5F9]">
                            <div>To get</div>
                            <div>started</div>
                          </div>
                        )}

                        {preset.id === 'marker_sweep' && (
                          <div className="flex items-center justify-center gap-1 text-[10px] font-extrabold uppercase tracking-tight">
                            <span className="text-white">TO GET</span>
                            <span className="rounded bg-[#8B6FFF] px-1 py-0.5 text-[#080B14]">
                              STARTED
                            </span>
                          </div>
                        )}

                        {preset.id === 'negative_keywords' && (
                          <div className="text-[13px] font-extrabold uppercase leading-tight">
                            <div className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.45)]">
                              TO GET
                            </div>
                            <div className="text-[#D49879]">STARTED</div>
                          </div>
                        )}

                        {preset.id === 'karaoke' && (
                          <div
                            className="text-[12px] font-extrabold uppercase leading-tight text-white"
                            style={{
                              textShadow:
                                '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 5px #000',
                            }}
                          >
                            <div>TO GET</div>
                            <div className="text-[#20C7D9]">STARTED</div>
                          </div>
                        )}
                      </div>
                      <div className="mt-1.5 text-[11px] font-medium text-[#94A3B8] group-hover:text-[#F8FAFC] transition-colors">
                        {preset.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={scrollPresetsRight}
                aria-label="More caption presets"
                className="slyce-hover-lift absolute right-0 top-[30px] flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#080B14] shadow-md cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Auto Hook Section */}
          <div className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8FAFC] text-[#080B14]">
                  <Anchor className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-[#F8FAFC]">Auto hook</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-[#CBD5E1]">
                  Beta
                </span>
              </div>

              <div className="flex items-center gap-3">
                <select
                  aria-label="Auto hook mode"
                  value={value.autoHookMode}
                  onChange={(e) =>
                    onChange({ ...value, autoHookMode: e.target.value as AutoHookMode })
                  }
                  className="rounded bg-transparent text-xs font-medium text-[#CBD5E1] focus:outline-none cursor-pointer"
                >
                  <option value="headline" className="bg-[#14171F] text-[#F8FAFC]">
                    Headline
                  </option>
                  <option value="question" className="bg-[#14171F] text-[#F8FAFC]">
                    Question
                  </option>
                  <option value="curiosity" className="bg-[#14171F] text-[#F8FAFC]">
                    Curiosity
                  </option>
                </select>

                <button
                  type="button"
                  role="switch"
                  aria-checked={value.autoHookEnabled}
                  aria-label="Toggle auto hook overlay"
                  onClick={() => onChange({ ...value, autoHookEnabled: !value.autoHookEnabled })}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    value.autoHookEnabled ? 'bg-[#F8FAFC]' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-[#14171F] transition-transform duration-150 ${
                      value.autoHookEnabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Auto Hook Visual Cards (Editorial, Statement, Classic) */}
            <div
              className={`grid grid-cols-3 gap-2.5 transition-opacity ${
                value.autoHookEnabled ? 'opacity-100' : 'opacity-45'
              }`}
            >
              {AUTO_HOOK_STYLE_CARDS.map((card) => {
                const isSelected = value.autoHookStyle === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        autoHookEnabled: true,
                        autoHookStyle: card.id,
                      })
                    }
                    className="group text-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#20C7D9]"
                  >
                    <div
                      className={`slyce-hover-card relative aspect-[3/4] overflow-hidden rounded-xl border bg-[#080B14] transition-all ${
                        isSelected
                          ? 'border-white ring-1 ring-white/80'
                          : 'border-white/10 group-hover:border-white/35'
                      }`}
                    >
                      <video
                        src={`/api/auto-hooks/${card.id}/sample.mp4`}
                        poster={card.imageUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        preload="metadata"
                        onPlaying={() =>
                          setHookVideoReady((prev) => (prev[card.id] ? prev : { ...prev, [card.id]: true }))
                        }
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

                      {!hookVideoReady[card.id] && (
                        <>
                          {card.id === 'editorial' && (
                            <div className="pointer-events-none absolute inset-x-2 bottom-2.5 text-left">
                              <div className="font-editorial text-[9px] italic text-white/90">
                                {card.sampleEyebrow}
                              </div>
                              <div className="font-editorial text-[12px] font-semibold leading-tight text-[#D9F94D]">
                                {card.sampleHeadline}
                              </div>
                            </div>
                          )}

                          {card.id === 'statement' && (
                            <div className="pointer-events-none absolute inset-x-2 bottom-2.5 text-left">
                              <div className="text-[8px] font-medium text-[#CBD5E1]">
                                {card.sampleEyebrow}
                              </div>
                              <div className="font-display text-[11px] font-extrabold leading-tight text-white">
                                {card.sampleHeadline}
                              </div>
                            </div>
                          )}

                          {card.id === 'classic' && (
                            <div className="pointer-events-none absolute inset-x-2 top-2.5 flex justify-center">
                              <span className="rounded-md bg-white px-1.5 py-0.5 text-[7px] font-extrabold tracking-tight text-[#080B14] shadow">
                                {card.sampleHeadline}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div
                      className={`mt-1.5 text-[11px] font-medium transition-colors ${
                        isSelected ? 'text-[#F8FAFC]' : 'text-[#94A3B8] group-hover:text-[#F8FAFC]'
                      }`}
                    >
                      {card.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* OUTPUT Section */}
          <div className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94A3B8]">
              OUTPUT
            </div>

            {/* Clips per video */}
            <div className="flex flex-wrap items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Scissors className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Clips per video</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    {value.clipsPerVideoMode === 'auto'
                      ? 'Auto · SLYCE picks the best number for the video'
                      : `Set · Extract up to ${value.clipsPerVideoCount} highlight clip(s)`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {value.clipsPerVideoMode === 'set' && (
                  <input
                    type="number"
                    min={1}
                    max={50}
                    aria-label="Number of clips per video"
                    value={value.clipsPerVideoCount}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        clipsPerVideoCount: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-16 rounded-lg border border-white/15 bg-[#080B14] px-2.5 py-1.5 text-center font-mono text-xs text-[#F8FAFC] tabular-nums focus:border-[#7657FF] focus:outline-none"
                  />
                )}
                <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#10141D] p-0.5">
                  {(['auto', 'set'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onChange({ ...value, clipsPerVideoMode: m })}
                      className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors whitespace-nowrap cursor-pointer ${
                        value.clipsPerVideoMode === m
                          ? 'bg-[#262C3A] text-[#F8FAFC]'
                          : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {m === 'auto' ? 'Auto' : 'Set'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Aspect ratio */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Crop className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Aspect ratio</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    9:16 vertical · 1:1 square · 16:9 horizontal
                  </div>
                </div>
              </div>

              <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#10141D] p-0.5 shrink-0">
                {(['9:16', '1:1', '16:9'] as AspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    aria-label={`Aspect ratio ${ASPECT_RATIO_CONFIG[ratio].label}`}
                    onClick={() => onChange({ ...value, aspectRatio: ratio })}
                    className={`rounded-md px-3 py-1 font-mono text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      value.aspectRatio === ratio
                        ? 'bg-[#262C3A] text-[#F8FAFC]'
                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            {/* Clip duration */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Clock className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Clip duration</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Target clip length window · custom min–max supported
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#10141D] p-0.5">
                  {(
                    [
                      ['auto', 'Auto'],
                      ['short_30', '<30s'],
                      ['medium_60', '30–60s'],
                      ['long_90', '60–90s'],
                      ['custom', 'Custom'],
                    ] as Array<[TargetDurationPreset, string]>
                  ).map(([presetId, label]) => (
                    <button
                      key={presetId}
                      type="button"
                      onClick={() => onChange({ ...value, targetDuration: presetId })}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        value.targetDuration === presetId
                          ? 'bg-[#262C3A] text-[#F8FAFC]'
                          : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {value.targetDuration === 'custom' && (
              <div className="flex flex-wrap items-center justify-end gap-2 pl-11">
                <span className="text-[11px] text-[#94A3B8]">Range (sec):</span>
                <input
                  type="number"
                  min={3}
                  max={600}
                  aria-label="Custom minimum duration seconds"
                  value={value.customMinDuration}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      customMinDuration: Math.max(3, Number(e.target.value) || 15),
                    })
                  }
                  className="w-16 rounded-lg border border-white/15 bg-[#080B14] px-2 py-1 text-center font-mono text-xs text-[#F8FAFC] tabular-nums focus:border-[#7657FF] focus:outline-none"
                />
                <span className="text-xs text-[#94A3B8]">–</span>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  aria-label="Custom maximum duration seconds"
                  value={value.customMaxDuration}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      customMaxDuration: Math.max(
                        value.customMinDuration + 2,
                        Number(e.target.value) || 60
                      ),
                    })
                  }
                  className="w-16 rounded-lg border border-white/15 bg-[#080B14] px-2 py-1 text-center font-mono text-xs text-[#F8FAFC] tabular-nums focus:border-[#7657FF] focus:outline-none"
                />
              </div>
            )}

            {/* Playback speed */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Gauge className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Speed</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Synced across video, audio & subtitle timing
                  </div>
                </div>
              </div>

              <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#10141D] p-0.5 shrink-0">
                {PLAYBACK_SPEED_OPTIONS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => onChange({ ...value, playbackSpeed: spd })}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      Math.abs(value.playbackSpeed - spd) < 0.01
                        ? 'bg-[#262C3A] text-[#F8FAFC]'
                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-render top clips */}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#20C7D9]/25 bg-[#122536] text-[#20C7D9]">
                  <Zap className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Auto-render top clips</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Automatically encode top 5 viral MP4s as soon as AI highlights finish
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={value.autoRenderTopClips}
                aria-label="Toggle auto-render top clips"
                onClick={() => onChange({ ...value, autoRenderTopClips: !value.autoRenderTopClips })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  value.autoRenderTopClips ? 'bg-[#1D9BF0]' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
                    value.autoRenderTopClips ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* AI & REFRAME Section */}
          <div className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94A3B8]">
              AI & REFRAME
            </div>

            {/* Find viral moments */}
            <div className="flex items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#20C7D9]/25 bg-[#122536] text-[#20C7D9]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Find viral moments</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Gemini scores the transcript · off = whole video
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={value.findViralMoments}
                aria-label="Toggle find viral moments"
                onClick={() => onChange({ ...value, findViralMoments: !value.findViralMoments })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  value.findViralMoments ? 'bg-[#1D9BF0]' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
                    value.findViralMoments ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Gemini model */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Cpu className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Gemini model</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Override for this job · default uses the Settings default
                  </div>
                </div>
              </div>

              <select
                aria-label="Select Gemini model for this job"
                value={value.geminiModel}
                onChange={(e) =>
                  onChange({ ...value, geminiModel: e.target.value as GeminiModelOption })
                }
                className="rounded-lg border border-white/[0.1] bg-[#10141D] px-3 py-1.5 text-xs font-medium text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none cursor-pointer"
              >
                <option value="default" className="bg-[#14171F] text-[#F8FAFC]">
                  Default (Settings)
                </option>
                <option value="gemini-4-hydrogen" className="bg-[#14171F] text-[#F8FAFC]">
                  gemini-4-hydrogen
                </option>
                <option value="gemini-3.1-flash-lite" className="bg-[#14171F] text-[#F8FAFC]">
                  gemini-3.1-flash-lite
                </option>
              </select>
            </div>

            {/* Reframe */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Focus className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Reframe</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Auto center-crop · Subject tight crop · Off letterbox bands
                  </div>
                </div>
              </div>

              <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#10141D] p-0.5 shrink-0">
                {(
                  [
                    ['auto', 'Auto'],
                    ['subject', 'Subject'],
                    ['off', 'Off'],
                  ] as Array<[ReframeMode, string]>
                ).map(([modeId, lbl]) => (
                  <button
                    key={modeId}
                    type="button"
                    onClick={() => onChange({ ...value, reframeMode: modeId })}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      value.reframeMode === modeId
                        ? 'bg-[#262C3A] text-[#F8FAFC]'
                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Smart cut */}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#20C7D9]/25 bg-[#122536] text-[#20C7D9]">
                  <Scissors className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Smart cut</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Remove silence & filler words
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={value.smartCut}
                aria-label="Toggle smart cut"
                onClick={() => onChange({ ...value, smartCut: !value.smartCut })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  value.smartCut ? 'bg-[#1D9BF0]' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
                    value.smartCut ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Subtle zoom */}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#20C7D9]/25 bg-[#122536] text-[#20C7D9]">
                  <ZoomIn className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Subtle zoom & motion</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Viral dynamic push + drift (1.0→1.08x) or gentle zoom
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={value.subtleZoom}
                aria-label="Toggle subtle zoom"
                onClick={() => onChange({ ...value, subtleZoom: !value.subtleZoom })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  value.subtleZoom ? 'bg-[#1D9BF0]' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
                    value.subtleZoom ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Turbo 10x Pipeline */}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#7657FF]/30 bg-[#1B1936] text-[#A78BFA]">
                  <Zap className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Turbo 10x Pipeline</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Parallel MP3 chunks, low-latency Gemini & fast H.264 MP4 encoding
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={value.turboMode}
                aria-label="Toggle turbo 10x pipeline"
                onClick={() => onChange({ ...value, turboMode: !value.turboMode })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  value.turboMode ? 'bg-[#7657FF]' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
                    value.turboMode ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Spoken language */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 py-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1B1F29] text-[#94A3B8]">
                  <Languages className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC]">Spoken language</div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Single language boosts accuracy
                  </div>
                </div>
              </div>

              <select
                aria-label="Select spoken language"
                value={value.spokenLanguage}
                onChange={(e) =>
                  onChange({ ...value, spokenLanguage: e.target.value as SpokenLanguageOption })
                }
                className="rounded-lg border border-white/[0.1] bg-[#10141D] px-3 py-1.5 text-xs font-medium text-[#F8FAFC] focus:border-[#7657FF] focus:outline-none cursor-pointer"
              >
                {SPOKEN_LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang.value} value={lang.value} className="bg-[#14171F] text-[#F8FAFC]">
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {onApplyToStudio && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3.5">
          <span className="text-[11px] text-[#94A3B8]">
            Applied automatically to your next clip job
          </span>
          <button
            type="button"
            onClick={onApplyToStudio}
            className="slyce-hover-lift rounded-lg bg-[#7657FF] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#6444F5] whitespace-nowrap cursor-pointer"
          >
            {ctaLabel || 'Use This Recipe'}
          </button>
        </div>
      )}
    </div>
  );
}
