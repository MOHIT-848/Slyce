import {
  applySmartCutToCueText,
  type ClipEffects,
  type SubtitleCue,
  type SubtitlePosition,
  type SubtitleSettings,
  type SubtitleStyleId,
} from '../../src/types/clipforge.ts';

function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function scaleSubtitleCuesForSpeed(
  cues: SubtitleCue[],
  speed = 1,
  smartCut = false
): SubtitleCue[] {
  const safeSpeed = Math.max(0.5, Math.min(2.0, Number(speed) || 1));
  return cues
    .map((cue) => {
      const cleaned = smartCut ? applySmartCutToCueText(cue.text) : cue.text.trim();
      return {
        ...cue,
        start_seconds: Number((cue.start_seconds / safeSpeed).toFixed(2)),
        end_seconds: Number((cue.end_seconds / safeSpeed).toFixed(2)),
        text: cleaned,
      };
    })
    .filter((c) => c.text.length > 0 && c.end_seconds > c.start_seconds);
}

/**
 * Generates standard SubRip (.srt) subtitle file content.
 * Cue timestamps are relative to clip start (0.0s).
 */
export function generateSrtContent(
  cues: SubtitleCue[],
  speed = 1,
  smartCut = false
): string {
  const prepared = scaleSubtitleCuesForSpeed(cues, speed, smartCut).sort(
    (a, b) => a.start_seconds - b.start_seconds
  );

  return (
    prepared
      .map((cue, idx) => {
        const start = formatSrtTime(cue.start_seconds);
        const end = formatSrtTime(cue.end_seconds);
        return `${idx + 1}\n${start} --> ${end}\n${cue.text}`;
      })
      .join('\n\n') + (prepared.length > 0 ? '\n' : '')
  );
}

/**
 * Wraps caption text cleanly so lines stay inside 9:16 safe margins.
 */
function wrapCaptionText(text: string, maxCharsPerLine = 26): string {
  const words = text.trim().replace(/\s+/g, ' ').split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\\N');
}

function getAlignmentCode(position: SubtitlePosition): number {
  if (position === 'top') return 8; // Top-center
  if (position === 'center') return 5; // Middle-center
  return 2; // Bottom-center
}

function getMarginV(position: SubtitlePosition, playResY: number): number {
  if (position === 'center') return 0;
  return Math.round(playResY * 0.12); // 12% safe margin top/bottom
}

interface AssStyleDef {
  fontName: string;
  primaryColour: string;
  secondaryColour: string;
  outlineColour: string;
  backColour: string;
  bold: number;
  borderStyle: number;
  outline: number;
  shadow: number;
}

const VALID_SYSTEM_FONTS = new Set([
  'Noto Sans Display',
  'Noto Sans',
  'Noto Serif Display',
  'Noto Serif',
  'JetBrains Mono',
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'DejaVu Sans',
  'DejaVu Serif',
  'DejaVu Sans Mono',
]);

/**
 * Converts a CSS #RRGGBB hex string into ASS &HAABBGGRR format.
 */
export function hexToAssColor(hex: string | undefined, fallbackAss: string, alpha = '00'): string {
  if (!hex) return fallbackAss;
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return fallbackAss;
  const rr = cleaned.slice(0, 2).toUpperCase();
  const gg = cleaned.slice(2, 4).toUpperCase();
  const bb = cleaned.slice(4, 6).toUpperCase();
  return `&H${alpha}${bb}${gg}${rr}`;
}

export function resolveAssFontName(fontFamily?: string, presetFallback = 'DejaVu Sans'): string {
  if (!fontFamily) return presetFallback;
  const cleaned = fontFamily.trim();
  if (VALID_SYSTEM_FONTS.has(cleaned)) return cleaned;
  // Allow user-specified sanitized font name safely without ASS delimiter chars
  const sanitized = cleaned.replace(/[,\r\n{}]/g, '').slice(0, 60);
  return sanitized || presetFallback;
}

const STYLE_MAP: Record<SubtitleStyleId, AssStyleDef> = {
  classic_white: {
    fontName: 'Noto Sans Display',
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00080B14',
    backColour: '&H80000000',
    bold: -1,
    borderStyle: 1,
    outline: 3.5,
    shadow: 1.5,
  },
  bold_creator: {
    fontName: 'Noto Sans Display',
    primaryColour: '&H0020D9FF', // Gold/amber in BGR (&H00BBGGRR)
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000',
    backColour: '&HA0000000',
    bold: -1,
    borderStyle: 1,
    outline: 4.5,
    shadow: 2.0,
  },
  minimal_clean: {
    fontName: 'Noto Sans',
    primaryColour: '&H00F8FAFC',
    secondaryColour: '&H00F8FAFC',
    outlineColour: '&H00101827',
    backColour: '&HC0080B14',
    bold: 0,
    borderStyle: 3, // Opaque box background
    outline: 8,
    shadow: 0,
  },
  word_cut: {
    fontName: 'Noto Sans Display',
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00080B14',
    backColour: '&H80000000',
    bold: -1,
    borderStyle: 1,
    outline: 3.5,
    shadow: 1.5,
  },
  marker_sweep: {
    fontName: 'Liberation Sans',
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H00FF6F8B',
    outlineColour: '&H00FF5776',
    backColour: '&HD0FF5776',
    bold: -1,
    borderStyle: 3,
    outline: 7,
    shadow: 0,
  },
  negative_keywords: {
    fontName: 'Noto Sans Display',
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H007998D4',
    outlineColour: '&H00000000',
    backColour: '&H90000000',
    bold: -1,
    borderStyle: 1,
    outline: 4.5,
    shadow: 2.0,
  },
  karaoke: {
    fontName: 'Noto Sans Display',
    primaryColour: '&H00D9C720',
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000',
    backColour: '&HA0000000',
    bold: -1,
    borderStyle: 1,
    outline: 5.5,
    shadow: 2.5,
  },
};

function buildAssAnimationTags(
  cue: SubtitleCue,
  wrappedText: string,
  settings: SubtitleSettings,
  width: number,
  height: number
): string {
  const anim = settings.animation ?? 'none';
  if (anim === 'fade') {
    return `{\\fad(180,120)}${wrappedText}`;
  }
  if (anim === 'pop') {
    return `{\\fscx72\\fscy72\\t(0,130,\\fscx108\\fscy108)\\t(130,220,\\fscx100\\fscy100)}${wrappedText}`;
  }
  if (anim === 'viral_bounce') {
    return `{\\fscx66\\fscy66\\t(0,90,\\fscx114\\fscy114)\\t(90,175,\\fscx98\\fscy98)\\t(175,225,\\fscx100\\fscy100)}${wrappedText}`;
  }
  if (anim === 'slide_up') {
    const x = Math.round(width / 2);
    const marginV = getMarginV(settings.position, height);
    const y =
      settings.position === 'top'
        ? marginV + 30
        : settings.position === 'center'
          ? Math.round(height / 2)
          : height - marginV - 20;
    return `{\\move(${x},${y + 34},${x},${y},0,180)\\fad(140,100)}${wrappedText}`;
  }
  if (anim === 'typewriter') {
    const durCs = Math.max(20, Math.round((cue.end_seconds - cue.start_seconds) * 100));
    const lines = wrappedText.split('\\N');
    const allWords = wrappedText.replace(/\\N/g, ' ').split(' ').filter(Boolean);
    const perWordCs = Math.max(6, Math.floor(durCs / Math.max(1, allWords.length)));
    const taggedLines = lines.map((line) =>
      line
        .split(' ')
        .filter(Boolean)
        .map((w) => `{\\k${perWordCs}}${w}`)
        .join(' ')
    );
    return `{\\fad(100,80)}${taggedLines.join('\\N')}`;
  }
  return wrappedText;
}

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file calibrated for
 * 9:16 vertical exports (1080x1920 or 720x1280) with custom fonts & animations.
 */
export function generateAssContent(
  cues: SubtitleCue[],
  settings: SubtitleSettings,
  width: number,
  height: number,
  effects?: ClipEffects
): string {
  const preset = STYLE_MAP[settings.style] ?? STYLE_MAP.classic_white;
  const fontName = resolveAssFontName(settings.fontFamily, preset.fontName);
  const primaryColour = hexToAssColor(settings.textColor, preset.primaryColour);
  const outlineColour = hexToAssColor(settings.outlineColor, preset.outlineColour);
  const boldFlag =
    settings.fontWeight !== undefined
      ? settings.fontWeight === 'normal'
        ? 0
        : -1
      : preset.bold;
  const italicFlag = settings.italic ? -1 : 0;
  const outlineWidth =
    settings.outlineWidth !== undefined && Number.isFinite(settings.outlineWidth)
      ? Math.max(0, Math.min(10, Number(settings.outlineWidth)))
      : preset.outline;

  const alignment = getAlignmentCode(settings.position);
  const marginV = getMarginV(settings.position, height);
  const marginH = Math.round(width * 0.075); // 7.5% horizontal safe margins
  const scaleFactor = Math.min(width, height) / 1080;
  const scaledFontSize = Math.round(Math.max(24, Math.min(92, settings.fontSize * 1.45 * scaleFactor)));
  const isWide = width > height;
  const isSquare = width === height;
  const baseMaxChars = isWide ? 44 : isSquare ? 34 : 30;
  const maxChars = Math.max(16, Math.round(baseMaxChars - (settings.fontSize - 24) * 0.35));

  const hookFontSize = Math.round(48 * scaleFactor);
  const hookMarginV = Math.round(height * 0.09);
  const hookStyle =
    effects?.autoHookStyle === 'editorial'
      ? `Style: AutoHook,Noto Serif Display,${hookFontSize},&H004DF9D9,&H00FFFFFF,&H00080B14,&H80000000,-1,-1,0,0,100,100,0,0,1,3,2,8,${marginH},${marginH},${hookMarginV},1`
      : effects?.autoHookStyle === 'statement'
        ? `Style: AutoHook,Noto Sans Display,${hookFontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0080B14,-1,0,0,0,100,100,0,0,3,8,0,8,${marginH},${marginH},${hookMarginV},1`
        : `Style: AutoHook,Noto Sans Display,${Math.round(40 * scaleFactor)},&H00140B08,&H00140B08,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,12,0,8,${marginH},${marginH},${hookMarginV},1`;

  const wmAlphaHex = (() => {
    const op = Math.max(0.15, Math.min(1, Number(effects?.watermark?.opacity ?? 0.75)));
    const inv = Math.round((1 - op) * 255);
    return inv.toString(16).toUpperCase().padStart(2, '0');
  })();
  const wmPos = effects?.watermark?.position ?? 'top_right';
  const wmAlign = wmPos === 'top_left' ? 7 : wmPos === 'top_right' ? 9 : wmPos === 'bottom_left' ? 1 : 3;
  const wmFontSize = Math.round(Math.max(18, 28 * scaleFactor));
  const wmMargin = Math.round(Math.min(width, height) * 0.045);

  const header = `[Script Info]
Title: SLYCE Subtitles
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${scaledFontSize},${primaryColour},${preset.secondaryColour},${outlineColour},${preset.backColour},${boldFlag},${italicFlag},0,0,100,100,0,0,${preset.borderStyle},${outlineWidth},${preset.shadow},${alignment},${marginH},${marginH},${marginV},1
${hookStyle}
Style: Watermark,Noto Sans Display,${wmFontSize},&H${wmAlphaHex}FFFFFF,&H${wmAlphaHex}FFFFFF,&H${wmAlphaHex}080B14,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,${wmAlign},${wmMargin},${wmMargin},${wmMargin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const speed = Math.max(0.5, Math.min(2.0, Number(effects?.playbackSpeed) || 1));
  const smartCut = Boolean(effects?.smartCut);
  const preparedCues = scaleSubtitleCuesForSpeed(cues, speed, smartCut).sort(
    (a, b) => a.start_seconds - b.start_seconds
  );

  const events = preparedCues.map((cue) => {
    const start = formatAssTime(cue.start_seconds);
    const end = formatAssTime(cue.end_seconds);
    const rawText = settings.uppercase ? cue.text.toUpperCase() : cue.text;
    const wrapped = wrapCaptionText(rawText, maxChars);
    const animated = buildAssAnimationTags(cue, wrapped, settings, width, height);
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${animated}`;
  });

  if (effects?.autoHookEnabled && effects.autoHookText?.trim()) {
    const hookText = wrapCaptionText(
      effects.autoHookStyle === 'classic'
        ? effects.autoHookText.trim().toUpperCase()
        : effects.autoHookText.trim(),
      isWide ? 36 : 24
    );
    const hookEndSec = Number((3.5 / speed).toFixed(2));
    events.unshift(
      `Dialogue: 1,0:00:00.00,${formatAssTime(hookEndSec)},AutoHook,,0,0,0,,{\\fad(160,200)}${hookText}`
    );
  }

  if (effects?.watermark?.text?.trim()) {
    const wmText = effects.watermark.text.trim().replace(/[,\r\n{}]/g, '').slice(0, 48);
    if (wmText) {
      events.unshift(
        `Dialogue: 2,0:00:00.00,9:59:59.00,Watermark,,0,0,0,,${wmText}`
      );
    }
  }

  return `${header}\n${events.join('\n')}\n`;
}

/**
 * Splits long transcript segments inside [clipStart, clipEnd] into short,
 * readable 2-4 second subtitle cues relative to clipStart.
 */
export function buildCuesFromTranscript(
  segments: Array<{ start_seconds: number; end_seconds: number; text: string }>,
  clipStart: number,
  clipEnd: number
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cueCounter = 1;

  for (const seg of segments) {
    if (seg.end_seconds <= clipStart || seg.start_seconds >= clipEnd) continue;
    const clampedStart = Math.max(clipStart, seg.start_seconds);
    const clampedEnd = Math.min(clipEnd, seg.end_seconds);
    const duration = clampedEnd - clampedStart;
    if (duration <= 0.15) continue;

    const words = seg.text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (words.length === 0) continue;

    // Split into <= 7-word chunks for short-form readability
    const wordsPerCue = 7;
    if (words.length <= wordsPerCue || duration <= 2.2) {
      cues.push({
        id: `cue-${cueCounter++}`,
        start_seconds: Number((clampedStart - clipStart).toFixed(2)),
        end_seconds: Number((clampedEnd - clipStart).toFixed(2)),
        text: words.join(' '),
      });
    } else {
      const chunkCount = Math.ceil(words.length / wordsPerCue);
      const step = duration / chunkCount;
      for (let i = 0; i < chunkCount; i++) {
        const chunkWords = words.slice(i * wordsPerCue, (i + 1) * wordsPerCue);
        const cStart = clampedStart - clipStart + i * step;
        const cEnd = clampedStart - clipStart + (i + 1) * step;
        cues.push({
          id: `cue-${cueCounter++}`,
          start_seconds: Number(cStart.toFixed(2)),
          end_seconds: Number(Math.max(cStart + 0.3, cEnd).toFixed(2)),
          text: chunkWords.join(' '),
        });
      }
    }
  }

  return cues;
}
