export type JobStatus =
  | 'uploaded'
  | 'inspecting'
  | 'extracting_audio'
  | 'transcribing'
  | 'chunking'
  | 'detecting_highlights'
  | 'ready'
  | 'failed';

export type AspectRatio = '9:16' | '1:1' | '16:9';
export type FramingMode = 'center_crop' | 'subject_crop' | 'blurred_background';
export type ReframeMode = 'auto' | 'subject' | 'off';
export type ExportResolution =
  | '1080x1920'
  | '720x1280'
  | '1080x1080'
  | '720x720'
  | '1920x1080'
  | '1280x720';
export type TargetDurationPreset = 'auto' | 'short_30' | 'medium_60' | 'long_90' | 'custom';
export type GeminiModelOption = 'default' | 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
export type SpokenLanguageOption =
  | 'auto'
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt'
  | 'hi'
  | 'ja'
  | 'ko'
  | 'ar';

export const ASPECT_RATIO_CONFIG: Record<
  AspectRatio,
  {
    label: string;
    shortLabel: string;
    highRes: ExportResolution;
    fastRes: ExportResolution;
    previewAspectClass: string;
  }
> = {
  '9:16': {
    label: '9:16 Vertical',
    shortLabel: '9:16',
    highRes: '1080x1920',
    fastRes: '720x1280',
    previewAspectClass: 'aspect-[9/16] max-w-[295px]',
  },
  '1:1': {
    label: '1:1 Square',
    shortLabel: '1:1',
    highRes: '1080x1080',
    fastRes: '720x720',
    previewAspectClass: 'aspect-square max-w-[350px]',
  },
  '16:9': {
    label: '16:9 Horizontal',
    shortLabel: '16:9',
    highRes: '1920x1080',
    fastRes: '1280x720',
    previewAspectClass: 'aspect-video max-w-[440px]',
  },
};

export const PLAYBACK_SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

export const SPOKEN_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: SpokenLanguageOption;
  label: string;
}> = [
  { value: 'auto', label: 'Multi-language' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
];

export function reframeModeToFraming(reframe: ReframeMode): FramingMode {
  if (reframe === 'subject') return 'subject_crop';
  if (reframe === 'off') return 'blurred_background';
  return 'center_crop';
}

export function framingToReframeMode(framing: FramingMode): ReframeMode {
  if (framing === 'subject_crop') return 'subject';
  if (framing === 'blurred_background') return 'off';
  return 'auto';
}

export function getAspectRatioForResolution(res?: string): AspectRatio {
  if (res === '1080x1080' || res === '720x720') return '1:1';
  if (res === '1920x1080' || res === '1280x720') return '16:9';
  return '9:16';
}

export function getDimensionsForResolution(
  res?: string,
  aspectFallback: AspectRatio = '9:16'
): [number, number] {
  switch (res) {
    case '1080x1920':
      return [1080, 1920];
    case '720x1280':
      return [720, 1280];
    case '1080x1080':
      return [1080, 1080];
    case '720x720':
      return [720, 720];
    case '1920x1080':
      return [1920, 1080];
    case '1280x720':
      return [1280, 720];
    default:
      if (aspectFallback === '1:1') return [1080, 1080];
      if (aspectFallback === '16:9') return [1920, 1080];
      return [1080, 1920];
  }
}

export function resolveDurationWindow(
  preset: TargetDurationPreset,
  customMin = 15,
  customMax = 60,
  videoDuration = 9999
): { min: number; max: number } {
  const safeVid = Math.max(5, videoDuration || 9999);
  if (preset === 'short_30') {
    return { min: Math.min(8, safeVid), max: Math.min(30, safeVid) };
  }
  if (preset === 'medium_60') {
    return { min: Math.min(25, safeVid), max: Math.min(60, safeVid) };
  }
  if (preset === 'long_90') {
    return { min: Math.min(50, safeVid), max: Math.min(90, safeVid) };
  }
  if (preset === 'custom') {
    const lo = Math.max(3, Math.min(safeVid, Number(customMin) || 15));
    const hi = Math.max(lo + 2, Math.min(safeVid, Number(customMax) || 60));
    return { min: lo, max: hi };
  }
  return {
    min: safeVid < 45 ? 5 : 10,
    max: Math.max(30, Math.min(180, Math.floor(safeVid))),
  };
}

export function applySmartCutToCueText(text: string): string {
  return text
    .replace(/\b(um+|uh+|uhh+|er+|erm+|ah+|hmm+)\b[,.]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

export type SubtitleStyleId =
  | 'classic_white'
  | 'bold_creator'
  | 'minimal_clean'
  | 'word_cut'
  | 'marker_sweep'
  | 'negative_keywords'
  | 'karaoke';
export type CaptionMode = 'auto' | 'speech' | 'lyrics';
export type SubtitlePosition = 'bottom' | 'center' | 'top';
export type CaptionFontFamily =
  | 'Noto Sans Display'
  | 'Noto Sans'
  | 'Noto Serif Display'
  | 'Noto Serif'
  | 'JetBrains Mono'
  | 'Liberation Sans'
  | 'DejaVu Sans';
export type CaptionFontWeight = 'normal' | 'bold' | 'extrabold';
export type CaptionAnimation =
  | 'none'
  | 'fade'
  | 'pop'
  | 'slide_up'
  | 'typewriter'
  | 'viral_bounce';

export type RecipeId =
  | 'viral_shorts'
  | 'clip_long_video'
  | 'podcast_highlights'
  | 'tutorial_breakdown'
  | 'dynamic_shorts';

export type BrandKitId =
  | 'none'
  | 'slyce_dark'
  | 'editorial_minimal'
  | 'neon_creator';

export type AutoHookStyle = 'editorial' | 'statement' | 'classic';
export type AutoHookMode = 'headline' | 'question' | 'curiosity';

export interface RecipeConfig {
  recipe: RecipeId;
  brandKit: BrandKitId;
  captionsEnabled: boolean;
  captionMode?: CaptionMode;
  captionPreset: 'word_cut' | 'clean_cut' | 'marker_sweep' | 'negative_keywords' | 'karaoke';
  autoHookEnabled: boolean;
  autoHookMode: AutoHookMode;
  autoHookStyle: AutoHookStyle;

  // Output preferences
  clipsPerVideoMode: 'auto' | 'set';
  clipsPerVideoCount: number;
  aspectRatio: AspectRatio;
  targetDuration: TargetDurationPreset;
  customMinDuration: number;
  customMaxDuration: number;
  playbackSpeed: number;

  // AI & Reframe
  findViralMoments: boolean;
  geminiModel: GeminiModelOption;
  reframeMode: ReframeMode;
  smartCut: boolean;
  subtleZoom: boolean;
  spokenLanguage: SpokenLanguageOption;
  turboMode: boolean;
  autoRenderTopClips: boolean;
}

export const DEFAULT_RECIPE_CONFIG: RecipeConfig = {
  recipe: 'viral_shorts',
  brandKit: 'none',
  captionsEnabled: true,
  captionMode: 'auto',
  captionPreset: 'word_cut',
  autoHookEnabled: true,
  autoHookMode: 'headline',
  autoHookStyle: 'statement',
  clipsPerVideoMode: 'auto',
  clipsPerVideoCount: 5,
  aspectRatio: '9:16',
  targetDuration: 'auto',
  customMinDuration: 15,
  customMaxDuration: 60,
  playbackSpeed: 1,
  findViralMoments: true,
  geminiModel: 'default',
  reframeMode: 'auto',
  smartCut: true,
  subtleZoom: true,
  spokenLanguage: 'auto',
  turboMode: true,
  autoRenderTopClips: true,
};

export const RECIPE_OPTIONS: ReadonlyArray<{
  id: RecipeId;
  label: string;
  focusHint: string;
}> = [
  {
    id: 'viral_shorts',
    label: 'Viral Shorts Pro (Fast)',
    focusHint:
      'Extract punchy 15-45s retention hooks with contrarian openers, curiosity gaps, and emotional payoffs.',
  },
  {
    id: 'clip_long_video',
    label: 'Clip long video',
    focusHint: 'Extract self-contained high-retention 20-60s highlights across the full video.',
  },
  {
    id: 'podcast_highlights',
    label: 'Podcast highlights',
    focusHint: 'Prioritize strong debates, sharp quotes, stories, and speaker exchanges.',
  },
  {
    id: 'tutorial_breakdown',
    label: 'Tutorial breakdown',
    focusHint: 'Isolate clear step-by-step explanations, demonstrations, and actionable takeaways.',
  },
  {
    id: 'dynamic_shorts',
    label: 'Dynamic shorts',
    focusHint: 'Focus on punchy 15-35s hooks with rapid pacing and energetic delivery.',
  },
];

export const BRAND_KIT_OPTIONS: ReadonlyArray<{
  id: BrandKitId;
  label: string;
  description: string;
}> = [
  {
    id: 'none',
    label: 'No brand kit',
    description: 'Clean studio defaults with editable typography and framing',
  },
  {
    id: 'slyce_dark',
    label: 'SLYCE Creator Dark',
    description: 'Noto Sans Display · Crisp electric cyan & violet accents',
  },
  {
    id: 'editorial_minimal',
    label: 'Editorial Minimal',
    description: 'Noto Serif Display · Warm film look & subtle fade transitions',
  },
  {
    id: 'neon_creator',
    label: 'High-Contrast Studio',
    description: 'Vivid social grading · Punch zoom intro & gold impact text',
  },
];

export const CAPTION_PRESET_CARDS: ReadonlyArray<{
  id: RecipeConfig['captionPreset'];
  label: string;
  subtitleStyle: SubtitleStyleId;
  fontFamily: CaptionFontFamily;
  fontWeight: CaptionFontWeight;
  uppercase: boolean;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  animation: CaptionAnimation;
}> = [
  {
    id: 'word_cut',
    label: 'Word Cut',
    subtitleStyle: 'word_cut',
    fontFamily: 'Noto Sans Display',
    fontWeight: 'extrabold',
    uppercase: false,
    textColor: '#FFFFFF',
    outlineColor: '#080B14',
    outlineWidth: 3.5,
    animation: 'viral_bounce',
  },
  {
    id: 'clean_cut',
    label: 'Word Cut',
    subtitleStyle: 'classic_white',
    fontFamily: 'Noto Sans',
    fontWeight: 'bold',
    uppercase: false,
    textColor: '#F8FAFC',
    outlineColor: '#080B14',
    outlineWidth: 3,
    animation: 'none',
  },
  {
    id: 'marker_sweep',
    label: 'Marker Sweep',
    subtitleStyle: 'marker_sweep',
    fontFamily: 'Liberation Sans',
    fontWeight: 'extrabold',
    uppercase: true,
    textColor: '#FFFFFF',
    outlineColor: '#7657FF',
    outlineWidth: 4,
    animation: 'typewriter',
  },
  {
    id: 'negative_keywords',
    label: 'Negative keywords',
    subtitleStyle: 'negative_keywords',
    fontFamily: 'Noto Sans Display',
    fontWeight: 'extrabold',
    uppercase: true,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 4.5,
    animation: 'fade',
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    subtitleStyle: 'karaoke',
    fontFamily: 'Noto Sans Display',
    fontWeight: 'extrabold',
    uppercase: true,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 5.5,
    animation: 'typewriter',
  },
];

export const AUTO_HOOK_STYLE_CARDS: ReadonlyArray<{
  id: AutoHookStyle;
  label: string;
  imageUrl: string;
  sampleEyebrow: string;
  sampleHeadline: string;
}> = [
  {
    id: 'editorial',
    label: 'Editorial',
    imageUrl: '/src/assets/images/hook_editorial_portrait_1794936098616.jpg',
    sampleEyebrow: 'The',
    sampleHeadline: 'beauty of slowing down',
  },
  {
    id: 'statement',
    label: 'Statement',
    imageUrl: '/src/assets/images/hook_statement_studio_1794936099552.jpg',
    sampleEyebrow: 'Stop waiting.',
    sampleHeadline: 'Start creating.',
  },
  {
    id: 'classic',
    label: 'Classic',
    imageUrl: '/src/assets/images/hook_classic_creator_1794936099186.jpg',
    sampleEyebrow: 'AUTO HOOK',
    sampleHeadline: 'DEFAULT AUTO HEADLINE',
  },
];

export type IntroTransition =
  | 'none'
  | 'fade_in'
  | 'zoom_in'
  | 'slide_up'
  | 'blur_reveal'
  | 'flash_cut';
export type OutroTransition = 'none' | 'fade_out' | 'zoom_out' | 'blur_out';
export type MotionAnimation =
  | 'none'
  | 'subtle_zoom'
  | 'ken_burns_zoom_in'
  | 'ken_burns_zoom_out'
  | 'subtle_pan'
  | 'pulse_zoom'
  | 'viral_dynamic';
export type VisualFilterPreset =
  | 'natural'
  | 'cinematic_contrast'
  | 'vivid_social'
  | 'warm_film'
  | 'monochrome';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  format: string;
  codec: string;
  fileSizeBytes: number;
}

export interface VideoJob {
  id: string;
  original_filename: string;
  title: string;
  duration: number;
  resolution: string;
  metadata?: VideoMetadata;
  status: JobStatus;
  current_stage: number;
  stage_message: string;
  progress: number;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  is_demo_mode: boolean;
  source_type?: 'upload' | 'youtube' | 'instagram' | 'sample';
  youtube_url?: string;
  youtube_video_id?: string;
  youtube_download_blocked?: boolean;
  external_url?: string;
  platform_label?: string;
  source_video_url?: string;
  thumbnail_url?: string;
  processing_time_ms?: number;
  ai_warning?: string | null;
  recipe_config?: RecipeConfig;
}

export interface TranscriptSegment {
  id: string;
  job_id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  speaker_label: string | null;
  confidence_note?: string | null;
}

export interface ScoreBreakdown {
  completeness: number;
  hook_strength: number;
  useful_information: number;
  emotional_emphasis: number;
  duration_fit: number;
  explanation: string;
}

export interface SubtitleCue {
  id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
}

export interface SubtitleSettings {
  style: SubtitleStyleId;
  fontFamily?: string;
  fontWeight?: CaptionFontWeight;
  italic?: boolean;
  uppercase?: boolean;
  textColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  fontSize: number;
  position: SubtitlePosition;
  animation?: CaptionAnimation;
  burnIn: boolean;
}

export interface ClipColorAdjustments {
  brightness: number; // -0.3 to 0.3
  contrast: number; // 0.7 to 1.5
  saturation: number; // 0 to 2.0
  warmth: number; // -1.0 to 1.0
  sharpness: number; // 0 to 1.5
  vignette: number; // 0 to 1.0
}

export interface ClipTransformSettings {
  zoom: number; // 0.85 to 1.8
  panX: number; // -50 to 50 (% offset)
  panY: number; // -50 to 50 (% offset)
  flipH: boolean;
  rotateDeg: 0 | 90 | 180 | 270;
  canvasBg: 'blur' | 'black' | 'slate' | 'gradient';
}

export interface ClipAudioSettings {
  volume: number; // 0 to 2.0
  muted: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface ClipWatermarkOverlay {
  text: string;
  position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  opacity: number; // 0.2 to 1.0
}

export interface ClipEffects {
  introTransition: IntroTransition;
  introDuration: number;
  outroTransition: OutroTransition;
  outroDuration: number;
  motionAnimation: MotionAnimation;
  visualPreset: VisualFilterPreset;
  playbackSpeed?: number;
  smartCut?: boolean;
  renderSpeed?: 'fast' | 'quality';
  autoHookEnabled?: boolean;
  autoHookStyle?: AutoHookStyle;
  autoHookMode?: AutoHookMode;
  autoHookText?: string;
  adjustments?: ClipColorAdjustments;
  transform?: ClipTransformSettings;
  audio?: ClipAudioSettings;
  watermark?: ClipWatermarkOverlay;
}

export const DEFAULT_CLIP_ADJUSTMENTS: ClipColorAdjustments = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  warmth: 0,
  sharpness: 0,
  vignette: 0,
};

export const DEFAULT_CLIP_TRANSFORM: ClipTransformSettings = {
  zoom: 1,
  panX: 0,
  panY: 0,
  flipH: false,
  rotateDeg: 0,
  canvasBg: 'blur',
};

export const DEFAULT_CLIP_AUDIO: ClipAudioSettings = {
  volume: 1,
  muted: false,
  fadeIn: false,
  fadeOut: false,
};

export const DEFAULT_CLIP_EFFECTS: ClipEffects = {
  introTransition: 'none',
  introDuration: 0.5,
  outroTransition: 'none',
  outroDuration: 0.5,
  motionAnimation: 'none',
  visualPreset: 'natural',
  playbackSpeed: 1,
  smartCut: false,
  renderSpeed: 'fast',
  autoHookEnabled: false,
  autoHookStyle: 'editorial',
  autoHookMode: 'headline',
  autoHookText: '',
  adjustments: DEFAULT_CLIP_ADJUSTMENTS,
  transform: DEFAULT_CLIP_TRANSFORM,
  audio: DEFAULT_CLIP_AUDIO,
  watermark: { text: '', position: 'top_right', opacity: 0.75 },
};

export function resolveClipDefaultsFromRecipe(
  recipeConfig?: Partial<RecipeConfig>,
  hookHeadline?: string
): {
  subtitleSettings: SubtitleSettings;
  effects: ClipEffects;
  framingMode: FramingMode;
  aspectRatio: AspectRatio;
  exportResolution: ExportResolution;
} {
  const cfg: RecipeConfig = { ...DEFAULT_RECIPE_CONFIG, ...(recipeConfig ?? {}) };
  const captionCard =
    CAPTION_PRESET_CARDS.find((c) => c.id === cfg.captionPreset) ?? CAPTION_PRESET_CARDS[0];

  let visualPreset: VisualFilterPreset = 'natural';
  let introTransition: IntroTransition = 'none';
  let motionAnimation: MotionAnimation = cfg.subtleZoom ? 'subtle_zoom' : 'none';

  if (cfg.recipe === 'viral_shorts' || cfg.recipe === 'dynamic_shorts') {
    visualPreset = 'vivid_social';
    introTransition = cfg.recipe === 'viral_shorts' ? 'flash_cut' : 'zoom_in';
    motionAnimation = cfg.subtleZoom ? 'viral_dynamic' : 'subtle_zoom';
  }

  if (cfg.brandKit === 'slyce_dark') {
    visualPreset = 'cinematic_contrast';
    introTransition = 'fade_in';
  } else if (cfg.brandKit === 'editorial_minimal') {
    visualPreset = 'warm_film';
    introTransition = 'fade_in';
    motionAnimation = cfg.subtleZoom ? 'subtle_zoom' : 'ken_burns_zoom_in';
  } else if (cfg.brandKit === 'neon_creator') {
    visualPreset = 'vivid_social';
    introTransition = 'zoom_in';
    motionAnimation = cfg.subtleZoom ? 'viral_dynamic' : 'subtle_pan';
  }

  const aspectRatio: AspectRatio = cfg.aspectRatio || '9:16';
  const exportResolution = ASPECT_RATIO_CONFIG[aspectRatio].highRes;
  const framingMode = reframeModeToFraming(cfg.reframeMode || 'auto');
  const speed = Math.max(0.5, Math.min(2, Number(cfg.playbackSpeed) || 1));

  return {
    subtitleSettings: {
      style: captionCard.subtitleStyle,
      fontFamily:
        cfg.brandKit === 'editorial_minimal' ? 'Noto Serif Display' : captionCard.fontFamily,
      fontWeight: captionCard.fontWeight,
      uppercase: captionCard.uppercase,
      textColor: captionCard.textColor,
      outlineColor: captionCard.outlineColor,
      outlineWidth: captionCard.outlineWidth,
      fontSize: 28,
      position: 'bottom',
      animation: captionCard.animation,
      burnIn: cfg.captionsEnabled,
    },
    effects: {
      ...DEFAULT_CLIP_EFFECTS,
      introTransition,
      motionAnimation,
      visualPreset,
      playbackSpeed: speed,
      smartCut: cfg.smartCut,
      renderSpeed: cfg.turboMode === false ? 'quality' : 'fast',
      autoHookEnabled: cfg.autoHookEnabled,
      autoHookStyle: cfg.autoHookStyle,
      autoHookMode: cfg.autoHookMode,
      autoHookText: hookHeadline?.trim() || '',
    },
    framingMode,
    aspectRatio,
    exportResolution,
  };
}

export const CAPTION_FONT_OPTIONS: ReadonlyArray<{
  value: CaptionFontFamily;
  label: string;
  category: string;
  cssFamily: string;
}> = [
  {
    value: 'Noto Sans Display',
    label: 'Noto Sans Display',
    category: 'Modern Creator Sans',
    cssFamily: '"Noto Sans Display", "Noto Sans", sans-serif',
  },
  {
    value: 'Noto Sans',
    label: 'Noto Sans',
    category: 'Clean Studio Sans',
    cssFamily: '"Noto Sans", "DM Sans", sans-serif',
  },
  {
    value: 'Noto Serif Display',
    label: 'Noto Serif Display',
    category: 'Editorial Serif',
    cssFamily: '"Noto Serif Display", "Noto Serif", serif',
  },
  {
    value: 'Noto Serif',
    label: 'Noto Serif',
    category: 'Classic Book Serif',
    cssFamily: '"Noto Serif", Georgia, serif',
  },
  {
    value: 'JetBrains Mono',
    label: 'JetBrains Mono',
    category: 'Technical Monospace',
    cssFamily: '"JetBrains Mono", monospace',
  },
  {
    value: 'Liberation Sans',
    label: 'Liberation Sans',
    category: 'Condensed Headline',
    cssFamily: '"Liberation Sans", Arial, sans-serif',
  },
  {
    value: 'DejaVu Sans',
    label: 'DejaVu Sans',
    category: 'Broadcast Standard',
    cssFamily: '"DejaVu Sans", Verdana, sans-serif',
  },
];

export interface ClipCandidate {
  id: string;
  job_id: string;
  start_seconds: number;
  end_seconds: number;
  title: string;
  hook: string;
  summary: string;
  transcript_excerpt: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  selection_reason: string;
  status: 'candidate' | 'selected' | 'rendering' | 'rendered' | 'failed';
  subtitle_cues: SubtitleCue[];
  subtitle_settings: SubtitleSettings;
  framing_mode: FramingMode;
  aspect_ratio?: AspectRatio;
  export_resolution: ExportResolution;
  effects?: ClipEffects;
}

export interface ExportRecord {
  id: string;
  clip_id: string;
  job_id: string;
  clip_title: string;
  filename: string;
  file_path: string;
  srt_filename: string;
  subtitle_file_path: string;
  resolution: string;
  aspect_ratio: string;
  duration: number;
  file_size_bytes: number;
  srt_size_bytes: number;
  has_burned_subtitles: boolean;
  framing_mode: FramingMode;
  subtitle_style: SubtitleStyleId;
  render_status: 'queued' | 'rendering' | 'completed' | 'failed';
  error_message?: string | null;
  created_at: string;
}

export interface SampleVideoInfo {
  id: string;
  title: string;
  category: string;
  duration_seconds: number;
  description: string;
  thumbnail_url: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  libx264Available: boolean;
  subtitlesFilterAvailable: boolean;
  ytDlpAvailable: boolean;
  youtubeCookiesConfigured: boolean;
  geminiConfigured: boolean;
  geminiModel: string;
  unlimitedMode: boolean;
  maxUploadMb: number | null;
  maxDurationSeconds: number | null;
  activeJobs: number;
  queueMode: string;
}

export const PIPELINE_STAGES: ReadonlyArray<{
  stage: number;
  label: string;
  description: string;
}> = [
  { stage: 1, label: 'Source ingested', description: 'Accepted uploaded video file or YouTube link with no size or duration limits' },
  { stage: 2, label: 'Video inspected', description: 'Extracted resolution, frame rate, and duration via FFprobe' },
  { stage: 3, label: 'Audio extracted', description: 'Converted audio track to 16 kHz mono WAV' },
  { stage: 4, label: 'Transcript generated', description: 'Generated timestamped speech segments' },
  { stage: 5, label: 'AI highlights identified', description: 'Chunked transcript and ranked unlimited candidate moments' },
  { stage: 6, label: 'Clips prepared', description: 'Aligned subtitle cues and validated boundaries' },
  { stage: 7, label: 'Subtitles generated', description: 'Built styled captions and SRT timing tracks' },
  { stage: 8, label: 'Final exports rendered', description: 'Encoded playable 9:16 H.264 MP4 deliverables' },
];
