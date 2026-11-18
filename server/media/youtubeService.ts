import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { STORAGE_DIR, ensureStorageDirs } from '../utils/storage.ts';

const execFileAsync = promisify(execFile);

export const BIN_DIR = path.join(STORAGE_DIR, 'bin');
export const YT_DLP_PATH = path.join(BIN_DIR, 'yt-dlp');
export const YOUTUBE_COOKIES_PATH = path.join(STORAGE_DIR, 'youtube-cookies.txt');

const YT_DLP_DOWNLOAD_URL =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

export interface ParsedYoutubeUrl {
  videoId: string;
  canonicalUrl: string;
}

export interface ParsedVideoLink {
  platform: 'youtube' | 'instagram';
  id: string;
  canonicalUrl: string;
}

/**
 * Extracts and validates a YouTube video ID from standard watch, youtu.be,
 * shorts, live, or embed URLs.
 */
export function parseYoutubeUrl(rawUrl: string): ParsedYoutubeUrl | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let videoId: string | null = null;

  if (host === 'youtu.be') {
    const seg = url.pathname.split('/').filter(Boolean)[0];
    if (seg) videoId = seg;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'v')) {
        videoId = parts[1];
      }
    }
  }

  if (!videoId) return null;
  // Standard YouTube video IDs are 11 chars of [A-Za-z0-9_-]
  const cleanId = videoId.trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(cleanId)) {
    return null;
  }

  return {
    videoId: cleanId,
    canonicalUrl: `https://www.youtube.com/watch?v=${cleanId}`,
  };
}

/**
 * Parses Instagram Reel, Post, TV, and instagr.am links.
 */
export function parseInstagramUrl(rawUrl: string): { shortcode: string; canonicalUrl: string } | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host !== 'instagram.com' && host !== 'instagr.am' && host !== 'ddinstagram.com') {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  let kind: string | null = null;
  let shortcode: string | null = null;

  // Handle /reel/CODE, /reels/CODE, /p/CODE, /tv/CODE, or /username/reel/CODE
  const idx = parts.findIndex((seg) => seg === 'reel' || seg === 'reels' || seg === 'p' || seg === 'tv');
  if (idx >= 0 && parts[idx + 1]) {
    kind = parts[idx] === 'reels' ? 'reel' : parts[idx];
    shortcode = parts[idx + 1];
  } else if (host === 'instagr.am' && parts[0]) {
    kind = 'p';
    shortcode = parts[0];
  }

  if (!kind || !shortcode) return null;
  const cleanCode = shortcode.replace(/[^A-Za-z0-9_-]/g, '');
  if (cleanCode.length < 5) return null;

  return {
    shortcode: cleanCode,
    canonicalUrl: `https://www.instagram.com/${kind}/${cleanCode}/`,
  };
}

export function parseVideoLink(rawUrl: string): ParsedVideoLink | null {
  const yt = parseYoutubeUrl(rawUrl);
  if (yt) {
    return { platform: 'youtube', id: yt.videoId, canonicalUrl: yt.canonicalUrl };
  }
  const ig = parseInstagramUrl(rawUrl);
  if (ig) {
    return { platform: 'instagram', id: ig.shortcode, canonicalUrl: ig.canonicalUrl };
  }
  return null;
}

export function hasYoutubeCookies(): boolean {
  if (process.env.YT_DLP_COOKIES && process.env.YT_DLP_COOKIES.trim().length > 20) {
    return true;
  }
  try {
    if (!fs.existsSync(YOUTUBE_COOKIES_PATH)) return false;
    const content = fs.readFileSync(YOUTUBE_COOKIES_PATH, 'utf-8').trim();
    return content.length > 20;
  } catch {
    return false;
  }
}

export function getCookiesFilePathIfConfigured(): string | null {
  ensureStorageDirs();
  if (fs.existsSync(YOUTUBE_COOKIES_PATH)) {
    const content = fs.readFileSync(YOUTUBE_COOKIES_PATH, 'utf-8').trim();
    if (content.length > 20) return YOUTUBE_COOKIES_PATH;
  }
  if (process.env.YT_DLP_COOKIES && process.env.YT_DLP_COOKIES.trim().length > 20) {
    fs.writeFileSync(YOUTUBE_COOKIES_PATH, process.env.YT_DLP_COOKIES, 'utf-8');
    return YOUTUBE_COOKIES_PATH;
  }
  return null;
}

export function convertCookiesToNetscape(rawInput: string): { netscapeText: string; lineCount: number } {
  const normalized = rawInput.replace(/\r\n/g, '\n').trim();
  if (normalized.length < 10) {
    throw new Error('Cookie input is too short. Paste Netscape cookies.txt or JSON cookies from Cookie-Editor.');
  }

  // Support Chrome Cookie-Editor JSON array format automatically
  if (normalized.startsWith('[') || normalized.startsWith('{')) {
    try {
      const parsedJson = JSON.parse(normalized);
      const list: Array<{
        domain?: string;
        path?: string;
        secure?: boolean;
        expirationDate?: number;
        expiry?: number;
        name?: string;
        value?: string;
      }> = Array.isArray(parsedJson)
        ? parsedJson
        : Array.isArray(parsedJson?.cookies)
          ? parsedJson.cookies
          : [];

      const rows: string[] = [];
      for (const c of list) {
        if (!c?.domain || !c?.name || c.value === undefined) continue;
        const domain = String(c.domain).trim();
        const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const cookiePath = String(c.path || '/');
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expires = Math.round(Number(c.expirationDate ?? c.expiry ?? Math.floor(Date.now() / 1000) + 86400 * 180));
        rows.push(`${domain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
      }

      if (rows.length > 0) {
        return {
          netscapeText: `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`,
          lineCount: rows.length,
        };
      }
    } catch {
      // Fall through to Netscape parser
    }
  }

  const lines = normalized
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
  if (lines.length === 0) {
    throw new Error('No cookie entries found. Export YouTube cookies as Netscape cookies.txt or JSON.');
  }

  const hasHeader = normalized.toLowerCase().includes('netscape http cookie file');
  const netscapeText = hasHeader
    ? `${normalized}\n`
    : `# Netscape HTTP Cookie File\n${normalized}\n`;

  return { netscapeText, lineCount: lines.length };
}

export function saveYoutubeCookies(cookiesText: string): { lineCount: number } {
  ensureStorageDirs();
  const { netscapeText, lineCount } = convertCookiesToNetscape(cookiesText);
  fs.writeFileSync(YOUTUBE_COOKIES_PATH, netscapeText, 'utf-8');
  return { lineCount };
}

export function clearYoutubeCookies(): void {
  if (fs.existsSync(YOUTUBE_COOKIES_PATH)) {
    fs.unlinkSync(YOUTUBE_COOKIES_PATH);
  }
}

export function isYtDlpAvailable(): boolean {
  return fs.existsSync(YT_DLP_PATH);
}

export async function ensureYtDlpBinary(): Promise<string> {
  if (fs.existsSync(YT_DLP_PATH)) {
    return YT_DLP_PATH;
  }

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const res = await fetch(YT_DLP_DOWNLOAD_URL, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download yt-dlp binary (HTTP ${res.status}).`);
  }
  const arrayBuf = await res.arrayBuffer();
  const tmpPath = `${YT_DLP_PATH}.tmp`;
  fs.writeFileSync(tmpPath, Buffer.from(arrayBuf));
  fs.chmodSync(tmpPath, 0o755);
  fs.renameSync(tmpPath, YT_DLP_PATH);
  return YT_DLP_PATH;
}

export async function fetchYoutubeOembed(canonicalUrl: string): Promise<{
  title?: string;
  authorName?: string;
  thumbnailUrl?: string;
}> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title,
      authorName: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch {
    return {};
  }
}

export interface YoutubeDownloadResult {
  success: boolean;
  videoPath?: string;
  title?: string;
  duration?: number;
  thumbnailUrl?: string;
  blockedByBotCheck?: boolean;
  errorReason?: string;
}

async function runYtDlpMetadata(
  ytDlpBin: string,
  canonicalUrl: string,
  cookiesPath: string | null
): Promise<{ title?: string; duration?: number; thumbnail?: string } | null> {
  try {
    const args = ['--dump-single-json', '--no-playlist', '--no-warnings'];
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }
    args.push(canonicalUrl);
    const { stdout } = await execFileAsync(ytDlpBin, args, { timeout: 30000 });
    const parsed = JSON.parse(stdout) as {
      title?: string;
      duration?: number;
      thumbnail?: string;
    };
    return parsed;
  } catch {
    return null;
  }
}

function isBotCheckMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('confirm you') ||
    lower.includes('not a bot') ||
    lower.includes('sign in') ||
    lower.includes('login_required') ||
    lower.includes('cookies')
  );
}

/**
 * Attempts to download a YouTube video to a local MP4 file with zero duration
 * or file-size caps using standalone yt-dlp (+ FFmpeg muxing) and @distube/ytdl-core fallback.
 */
export async function downloadYoutubeVideo(options: {
  youtubeUrl: string;
  outputMp4Path: string;
  onProgress?: (message: string, percent?: number) => void;
}): Promise<YoutubeDownloadResult> {
  const { youtubeUrl, outputMp4Path, onProgress } = options;
  const parsed = parseYoutubeUrl(youtubeUrl);
  if (!parsed) {
    return {
      success: false,
      errorReason: 'Invalid YouTube URL. Supported formats: youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., youtube.com/live/...',
    };
  }

  onProgress?.('Fetching YouTube video details...', 10);
  const oembed = await fetchYoutubeOembed(parsed.canonicalUrl);
  const cookiesPath = getCookiesFilePathIfConfigured();

  let ytDlpBin: string;
  try {
    ytDlpBin = await ensureYtDlpBinary();
  } catch (err) {
    return {
      success: false,
      title: oembed.title,
      thumbnailUrl: oembed.thumbnailUrl,
      errorReason: err instanceof Error ? err.message : 'Unable to initialize yt-dlp downloader.',
    };
  }

  const meta = await runYtDlpMetadata(ytDlpBin, parsed.canonicalUrl, cookiesPath);
  const resolvedTitle = meta?.title || oembed.title;
  const resolvedThumb = meta?.thumbnail || oembed.thumbnailUrl;

  onProgress?.(`Downloading "${resolvedTitle || parsed.videoId}" from YouTube...`, 16);

  // Strategy 1: yt-dlp with FFmpeg merge to MP4
  const ytDlpArgs = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--extractor-args',
    'youtube:player_client=tv,ios,android_vr,mweb,web',
    '-f',
    'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '-o',
    outputMp4Path,
  ];
  if (process.env.YT_DLP_PROXY && process.env.YT_DLP_PROXY.trim()) {
    ytDlpArgs.push('--proxy', process.env.YT_DLP_PROXY.trim());
  }
  if (cookiesPath) {
    ytDlpArgs.push('--cookies', cookiesPath);
  }
  ytDlpArgs.push(parsed.canonicalUrl);

  const ytDlpOutcome = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    const proc = spawn(ytDlpBin, ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lastPct = 16;

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (match) {
        const dlPct = Number(match[1]);
        if (Number.isFinite(dlPct)) {
          const mapped = Math.min(35, 16 + Math.round((dlPct / 100) * 19));
          if (mapped > lastPct) {
            lastPct = mapped;
            onProgress?.(`Downloading YouTube MP4 (${dlPct.toFixed(0)}%)...`, mapped);
          }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ ok: code === 0 && fs.existsSync(outputMp4Path) && fs.statSync(outputMp4Path).size > 10240, stderr });
    });

    proc.on('error', (err) => {
      resolve({ ok: false, stderr: err.message });
    });
  });

  if (ytDlpOutcome.ok) {
    return {
      success: true,
      videoPath: outputMp4Path,
      title: resolvedTitle,
      duration: meta?.duration,
      thumbnailUrl: resolvedThumb,
    };
  }

  // Strategy 2: @distube/ytdl-core fallback (lazy-loaded)
  try {
    const { Ytdl } = await import('@distube/ytdl-core');
    const ytdl = new Ytdl();
    const info = await ytdl.getInfo(parsed.canonicalUrl);
    const stream = ytdl.download(parsed.canonicalUrl, { quality: 'highest' });
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(outputMp4Path);
      stream.pipe(ws);
      stream.on('error', reject);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });
    if (fs.existsSync(outputMp4Path) && fs.statSync(outputMp4Path).size > 10240) {
      return {
        success: true,
        videoPath: outputMp4Path,
        title: info.videoDetails?.title || resolvedTitle,
        duration: Number(info.videoDetails?.lengthSeconds) || meta?.duration,
        thumbnailUrl: resolvedThumb,
      };
    }
  } catch (fallbackErr) {
    const combinedErr = `${ytDlpOutcome.stderr}\n${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`;
    const botBlocked = isBotCheckMessage(combinedErr);
    return {
      success: false,
      title: resolvedTitle,
      thumbnailUrl: resolvedThumb,
      blockedByBotCheck: botBlocked,
      errorReason: botBlocked
        ? 'YouTube requested bot verification on this server IP.'
        : combinedErr.trim().slice(0, 400),
    };
  }

  const botBlocked = isBotCheckMessage(ytDlpOutcome.stderr);
  return {
    success: false,
    title: resolvedTitle,
    thumbnailUrl: resolvedThumb,
    blockedByBotCheck: botBlocked,
    errorReason: ytDlpOutcome.stderr.trim().slice(0, 400) || 'Unable to download YouTube video stream.',
  };
}

/**
 * Downloads a public Instagram Reel/Post/TV video to a local MP4 file via yt-dlp
 * (plus opengraph meta / video_url HTML fallback when needed).
 */
export async function downloadInstagramVideo(options: {
  instagramUrl: string;
  outputMp4Path: string;
  onProgress?: (message: string, percent?: number) => void;
}): Promise<YoutubeDownloadResult> {
  const { instagramUrl, outputMp4Path, onProgress } = options;
  const parsed = parseInstagramUrl(instagramUrl);
  if (!parsed) {
    return {
      success: false,
      errorReason: 'Invalid Instagram URL. Supported formats: instagram.com/reel/..., instagram.com/reels/..., instagram.com/p/..., instagram.com/tv/...',
    };
  }

  onProgress?.('Fetching Instagram Reel / Video stream...', 12);
  const cookiesPath = getCookiesFilePathIfConfigured();

  let ytDlpBin: string | null = null;
  try {
    ytDlpBin = await ensureYtDlpBinary();
  } catch {
    ytDlpBin = null;
  }

  let meta: { title?: string; duration?: number; thumbnail?: string } | null = null;
  let ytDlpStderr = '';

  if (ytDlpBin) {
    meta = await runYtDlpMetadata(ytDlpBin, parsed.canonicalUrl, cookiesPath);
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--add-header',
      'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      '--add-header',
      'Referer:https://www.instagram.com/',
      '-f',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '-o',
      outputMp4Path,
    ];
    if (process.env.YT_DLP_PROXY && process.env.YT_DLP_PROXY.trim()) {
      args.push('--proxy', process.env.YT_DLP_PROXY.trim());
    }
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }
    args.push(parsed.canonicalUrl);

    const dlOutcome = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
      const proc = spawn(ytDlpBin!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let lastPct = 14;
      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (match) {
          const pct = Number(match[1]);
          if (Number.isFinite(pct)) {
            const mapped = Math.min(35, 14 + Math.round((pct / 100) * 21));
            if (mapped > lastPct) {
              lastPct = mapped;
              onProgress?.(`Downloading Instagram MP4 (${pct.toFixed(0)}%)...`, mapped);
            }
          }
        }
      });
      proc.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      proc.on('close', (code) => {
        resolve({ ok: code === 0 && fs.existsSync(outputMp4Path) && fs.statSync(outputMp4Path).size > 10240, stderr });
      });
      proc.on('error', (e) => resolve({ ok: false, stderr: e.message }));
    });

    if (dlOutcome.ok) {
      return {
        success: true,
        videoPath: outputMp4Path,
        title: meta?.title || `Instagram Reel (${parsed.shortcode})`,
        duration: meta?.duration,
        thumbnailUrl: meta?.thumbnail,
      };
    }
    ytDlpStderr = dlOutcome.stderr;
  }

  // Fallback: Attempt direct embed / OpenGraph meta video extraction for public Reels
  try {
    const embedUrl = `https://www.instagram.com/reel/${parsed.shortcode}/embed/captioned/`;
    const pageRes = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const ogMatch =
        html.match(/property=["']og:video["']\s+content=["']([^"']+)["']/i) ||
        html.match(/"video_url"\s*:\s*"([^"]+)"/i);
      if (ogMatch?.[1]) {
        const videoStreamUrl = ogMatch[1]
          .replace(/\\u0026/g, '&')
          .replace(/&amp;/g, '&')
          .replace(/\\\//g, '/');
        const vidRes = await fetch(videoStreamUrl, {
          headers: {
            Referer: 'https://www.instagram.com/',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(30000),
        });
        if (vidRes.ok) {
          const buf = Buffer.from(await vidRes.arrayBuffer());
          if (buf.length > 10240) {
            fs.writeFileSync(outputMp4Path, buf);
            return {
              success: true,
              videoPath: outputMp4Path,
              title: meta?.title || `Instagram Reel (${parsed.shortcode})`,
              duration: meta?.duration,
              thumbnailUrl: meta?.thumbnail,
            };
          }
        }
      }
    }
  } catch {
    // fall through cleanly
  }

  const botBlocked = isBotCheckMessage(ytDlpStderr);
  return {
    success: false,
    title: meta?.title || `Instagram Video (${parsed.shortcode})`,
    thumbnailUrl: meta?.thumbnail,
    blockedByBotCheck: botBlocked,
    errorReason: botBlocked
      ? 'Instagram requested login cookies on this server IP. Export instagram.com cookies (Cookie-Editor JSON or cookies.txt) in Link Import or Settings, or upload the downloaded MP4 directly.'
      : ytDlpStderr.trim().slice(0, 350) || 'Unable to download Instagram video stream cleanly.',
  };
}

export async function downloadVideoFromLink(options: {
  url: string;
  outputMp4Path: string;
  onProgress?: (message: string, percent?: number) => void;
}): Promise<YoutubeDownloadResult & { platform?: 'youtube' | 'instagram'; parsedId?: string; canonicalUrl?: string }> {
  const parsed = parseVideoLink(options.url);
  if (!parsed) {
    return {
      success: false,
      errorReason: 'Unsupported link. Paste a YouTube or Instagram Reel/Post URL.',
    };
  }
  if (parsed.platform === 'instagram') {
    const res = await downloadInstagramVideo({
      instagramUrl: parsed.canonicalUrl,
      outputMp4Path: options.outputMp4Path,
      onProgress: options.onProgress,
    });
    return { ...res, platform: 'instagram', parsedId: parsed.id, canonicalUrl: parsed.canonicalUrl };
  }
  const res = await downloadYoutubeVideo({
    youtubeUrl: parsed.canonicalUrl,
    outputMp4Path: options.outputMp4Path,
    onProgress: options.onProgress,
  });
  return { ...res, platform: 'youtube', parsedId: parsed.id, canonicalUrl: parsed.canonicalUrl };
}
