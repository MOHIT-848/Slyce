import { ArrowRight, Check, Film, Scissors, ShieldCheck, Subtitles } from 'lucide-react';
import { motion } from 'motion/react';
import { DEFAULT_RECIPE_CONFIG, type RecipeConfig } from '../types/clipforge';
import { RecipeStudioPanel } from './studio/RecipeStudioPanel';

interface LandingPageProps {
  recipeConfig?: RecipeConfig;
  onRecipeChange?: (next: RecipeConfig) => void;
  onStartCreating: () => void;
  onOpenSamples: () => void;
}

const PREVIEW_CLIPS = [
  {
    id: 'c1',
    time: '00:14 – 00:48',
    title: 'Transcript-First Editing',
    reason: 'Strong opening hook',
    caption: 'Stop scrubbing waveforms—start from spoken structure.',
  },
  {
    id: 'c2',
    time: '01:02 – 01:41',
    title: 'Two-Second Hook Rule',
    reason: 'Useful information',
    caption: 'Trim pre-hook filler so viewers hear the core idea.',
  },
  {
    id: 'c3',
    time: '02:18 – 02:53',
    title: 'Preserve Speaker Intent',
    reason: 'Complete thought',
    caption: 'Keep every qualification intact before exporting.',
  },
];

const WORKFLOW_STEPS = [
  {
    num: '01',
    title: 'Inspect & Extract Audio',
    body: 'FFprobe reads resolution, frame rate, and duration while FFmpeg isolates a clean 16 kHz mono audio track.',
  },
  {
    num: '02',
    title: 'Timestamped Transcription',
    body: 'Spoken dialogue is transcribed into sentence-level segments anchored to exact source video timecodes.',
  },
  {
    num: '03',
    title: 'Explainable Highlight Ranking',
    body: 'Overlapping transcript windows are evaluated on completeness, hook strength, clarity, emphasis, and duration fit.',
  },
  {
    num: '04',
    title: 'Human Review & 9:16 Export',
    body: 'Adjust boundaries, apply Recipes, Brand Kits, Auto Hooks & styled captions, and export MP4 plus SRT files.',
  },
];

export function LandingPage({
  recipeConfig = DEFAULT_RECIPE_CONFIG,
  onRecipeChange,
  onStartCreating,
  onOpenSamples,
}: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[#080B14] text-[#F8FAFC]">
      {/* Top Bar Contract: 3 zones — Brand logo + SLYCE, 4 concise links, 1 primary CTA */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#080B14]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="group inline-flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0 transition-transform duration-200 hover:scale-[1.03]"
          >
            <img
              src="/src/assets/images/slyce_logo_mark_1794936097205.jpg"
              alt="SLYCE logo"
              referrerPolicy="no-referrer"
              className="h-8 w-8 rounded-lg border border-white/15 object-cover shadow-sm transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-3"
            />
            <span className="transition-colors duration-200 group-hover:text-[#20C7D9]">SLYCE</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#94A3B8]">
            <a href="#workflow" className="slyce-nav-link hover:text-[#F8FAFC] whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a href="#capabilities" className="slyce-nav-link hover:text-[#F8FAFC] whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#privacy" className="slyce-nav-link hover:text-[#F8FAFC] whitespace-nowrap shrink-0">
              Privacy
            </a>
            <button
              type="button"
              onClick={onOpenSamples}
              className="slyce-nav-link hover:text-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Samples
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onStartCreating}
              className="slyce-hover-lift rounded-lg bg-[#7657FF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6444F5] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20C7D9]"
            >
              Start Creating
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section className="mx-auto max-w-7xl px-6 pt-14 pb-20 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-6">
              <p className="mb-4 text-xs font-medium tracking-wide text-[#20C7D9]">
                Autonomous Video Repurposing Studio · Human-in-the-Loop Workflow
              </p>
              <h1
                className="group/h1 font-display font-bold tracking-tight text-[#F8FAFC] text-balance transition-transform duration-200 hover:translate-x-1"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.75rem)', lineHeight: 1.08 }}
              >
                Your Long Videos Deserve{' '}
                <span className="bg-gradient-to-r from-[#F8FAFC] via-[#20C7D9] to-[#7657FF] bg-[length:200%_100%] bg-left bg-clip-text transition-all duration-300 group-hover/h1:bg-right group-hover/h1:text-transparent">
                  More Than One Moment.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-[#94A3B8] sm:text-lg">
                SLYCE understands your videos, discovers the moments worth sharing, and transforms them into
                studio-finished short-form clips with custom Recipes, Brand Kits, dynamic captions, and Auto Hooks.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={onStartCreating}
                  className="slyce-hover-lift inline-flex items-center gap-2 rounded-lg bg-[#7657FF] px-6 py-3 text-sm font-semibold text-white hover:bg-[#6444F5] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20C7D9]"
                >
                  Start Creating
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#capabilities"
                  className="slyce-hover-lift inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#101827] px-6 py-3 text-sm font-semibold text-[#F8FAFC] hover:border-white/30 hover:bg-[#151E2E] whitespace-nowrap shrink-0"
                >
                  Explore Features
                </a>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.08] pt-5 text-xs text-[#94A3B8]">
                <span>YouTube links & video uploads</span>
                <span aria-hidden="true">·</span>
                <span>No file size or length limits</span>
                <span aria-hidden="true">·</span>
                <span>Unlimited 9:16 clips & SRT</span>
                <span aria-hidden="true">·</span>
                <span>Creator approves every cut</span>
              </div>

              {/* Compact Visual Clip Strip */}
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {PREVIEW_CLIPS.map((clip, idx) => (
                  <motion.div
                    key={clip.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -3 }}
                    transition={{ duration: 0.25, delay: 0.08 * idx, ease: [0.16, 1, 0.3, 1] }}
                    className="slyce-hover-card flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#101827] p-3"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#20C7D9] tabular-nums">
                        <span>{clip.time}</span>
                        <span>9:16</span>
                      </div>
                      <p className="mt-1.5 text-xs font-semibold text-[#F8FAFC] leading-snug">
                        {clip.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#94A3B8]">{clip.reason}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Right Column: Interactive SLYCE Recipe, Brand Kit, Captions & Auto Hook Studio Panel */}
            <div className="lg:col-span-6">
              <RecipeStudioPanel
                value={recipeConfig}
                onChange={(next) => onRecipeChange?.(next)}
                defaultExpanded
                onApplyToStudio={onStartCreating}
                ctaLabel="Launch Workspace With Recipe"
              />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="workflow" className="border-t border-white/[0.08] bg-[#101827]/40 py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl font-bold tracking-tight text-[#F8FAFC] sm:text-3xl text-balance">
                A Transparent Staged Pipeline From Upload to Export
              </h2>
              <p className="mt-3 text-base text-[#94A3B8]">
                Every stage runs asynchronously with visible progress, verifiable transcript timestamps, and real FFmpeg
                media processing.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {WORKFLOW_STEPS.map((step) => (
                <div
                  key={step.num}
                  className="slyce-hover-card rounded-xl border border-white/[0.08] bg-[#151E2E] p-6"
                >
                  <span className="font-mono text-sm font-semibold text-[#20C7D9] tabular-nums">
                    {step.num}
                  </span>
                  <h3 className="mt-3 font-display text-base font-semibold text-[#F8FAFC]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Capabilities Asymmetric Bento Grid */}
        <section id="capabilities" className="border-t border-white/[0.08] py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl font-bold tracking-tight text-[#F8FAFC] sm:text-3xl text-balance">
                Built for Real Editorial Control, Not Black-Box Magic
              </h2>
              <p className="mt-3 text-base text-[#94A3B8]">
                SLYCE surfaces why a moment was selected and puts final boundaries, framing, typography, and hooks in
                your hands.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="slyce-hover-card lg:col-span-2 rounded-xl border border-white/[0.08] bg-[#151E2E] p-7">
                <div className="flex items-center gap-3 text-[#7657FF]">
                  <Scissors className="h-5 w-5" />
                  <h3 className="font-display text-lg font-semibold text-[#F8FAFC]">
                    Explainable Highlight Selection & Transcript Evidence
                  </h3>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#94A3B8]">
                  Instead of opaque virality claims, each candidate clip is scored across five weighted editorial
                  dimensions—Completeness (30%), Hook Strength (25%), Useful Information (20%), Expressive Emphasis
                  (15%), and Duration Fit (10%)—paired with the exact transcript excerpt and selection rationale.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/[0.08] pt-5 sm:grid-cols-5">
                  {[
                    ['Completeness', '30%'],
                    ['Hook Strength', '25%'],
                    ['Useful Info', '20%'],
                    ['Emphasis', '15%'],
                    ['Duration Fit', '10%'],
                  ].map(([label, weight]) => (
                    <div key={label}>
                      <div className="text-xs text-[#94A3B8]">{label}</div>
                      <div className="mt-1 font-mono text-base font-semibold text-[#F8FAFC] tabular-nums">
                        {weight}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="slyce-hover-card rounded-xl border border-white/[0.08] bg-[#151E2E] p-7">
                <div className="flex items-center gap-3 text-[#20C7D9]">
                  <Film className="h-5 w-5" />
                  <h3 className="font-display text-lg font-semibold text-[#F8FAFC]">
                    Vertical 9:16 FFmpeg Rendering
                  </h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#94A3B8]">
                  Encode crisp 1080×1920 or 720×1280 H.264/AAC MP4 clips using centered crop or blurred duplicate
                  background fill with intro/outro transitions and smooth camera motion.
                </p>
              </div>

              <div className="slyce-hover-card rounded-xl border border-white/[0.08] bg-[#151E2E] p-7">
                <div className="flex items-center gap-3 text-[#20C7D9]">
                  <Subtitles className="h-5 w-5" />
                  <h3 className="font-display text-lg font-semibold text-[#F8FAFC]">
                    Dynamic Caption Presets & Auto Hooks
                  </h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#94A3B8]">
                  Switch between Word Cut, Marker Sweep, Negative keywords, and Karaoke presets, pair with Editorial,
                  Statement, or Classic Auto Hook openers, and export burned MP4s plus clean SRT/ASS tracks.
                </p>
              </div>

              <div className="slyce-hover-card lg:col-span-2 rounded-xl border border-white/[0.08] bg-[#151E2E] p-7 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold text-[#F8FAFC]">
                    Human-in-the-Loop Clip Editor
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#94A3B8]">
                    Trim start and end boundaries to the tenth of a second, pick custom caption fonts and colors, apply
                    transitions and camera animations, preview vertical framing live, and re-render on demand.
                  </p>
                </div>
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={onStartCreating}
                    className="slyce-hover-lift inline-flex items-center gap-2 rounded-lg bg-[#7657FF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#6444F5] cursor-pointer"
                  >
                    Open Studio Workspace
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy & Content Safeguards */}
        <section id="privacy" className="border-t border-white/[0.08] bg-[#101827]/40 py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
              <div className="lg:col-span-5">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#20C7D9]">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Privacy & Creator Safeguards</span>
                </div>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-[#F8FAFC] sm:text-3xl text-balance">
                  Designed for Permitted Footage and Verifiable Edits
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[#94A3B8]">
                  SLYCE processes user-supplied videos and YouTube links with full creator control, never auto-posts to
                  social channels, and never fabricates spoken words.
                </p>
              </div>

              <div className="lg:col-span-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  'Paste any YouTube URL or upload MP4, MOV, WebM, MKV, and AVI files with zero caps.',
                  'Clear disclosure before audio is sent to Google Gemini for transcription.',
                  'Unlimited AI highlight discovery plus custom timestamp clip creation.',
                  'One-click project deletion removes downloaded media, audio, and renders.',
                ].map((item) => (
                  <div
                    key={item}
                    className="slyce-hover-card flex items-start gap-3 rounded-lg border border-white/[0.08] bg-[#151E2E] p-4"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#20C7D9]" />
                    <p className="text-sm leading-relaxed text-[#F8FAFC]">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/[0.08] py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-6 text-xs text-[#94A3B8] sm:flex-row sm:items-center">
          <span>SLYCE · Autonomous Long-Video to Short-Form Content Studio</span>
          <div className="flex items-center gap-6">
            <a href="#workflow" className="slyce-nav-link hover:text-[#F8FAFC]">
              Workflow
            </a>
            <a href="#privacy" className="slyce-nav-link hover:text-[#F8FAFC]">
              Privacy
            </a>
            <button
              type="button"
              onClick={onStartCreating}
              className="slyce-nav-link hover:text-[#F8FAFC] cursor-pointer"
            >
              Launch Workspace
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
