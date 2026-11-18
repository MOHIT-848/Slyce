# ClipForge AI

**Turn Long Videos Into Powerful Short Stories.**

ClipForge AI is an autonomous long-video to short-form content repurposing agent designed around a **human-in-the-loop** editorial workflow. Creators upload an MP4 or MOV video, inspect the timestamped speech transcript, review 3–5 explainably ranked highlight candidates, customize vertical 9:16 framing and captions, and download playable MP4 and SRT files.

---

## Core Features

1. **Video Upload & Validation**: Drag-and-drop `.mp4` / `.mov` upload with extension, MIME type, file size, and FFprobe duration/stream validation.
2. **8-Stage Asynchronous Pipeline**: Real background job tracking (upload → FFprobe inspection → 16 kHz mono WAV extraction → chunked Gemini audio transcription → transcript windowing → explainable highlight selection → cue alignment → 9:16 H.264/AAC FFmpeg rendering).
3. **Explainable Highlight Scoring**: Weighted 5-factor rubric (`30% Completeness + 25% Hook Strength + 20% Useful Information + 15% Emphasis + 10% Duration Fit`) with transcript excerpts and selection rationales—never claiming guaranteed virality.
4. **Interactive Clip & Caption Editor**: Live 9:16 vertical preview with boundary trimming (`start_seconds`, `end_seconds`), framing mode (`center_crop` or `blurred_background`), 3 subtitle presets (`Classic White`, `Bold Creator`, `Minimal Clean`), position/font controls, and cue-by-cue text/timing editing.
5. **Real Export Center**: Generates playable `1080×1920` or `720×1280` H.264/AAC MP4 files (with optional burned-in ASS subtitles) and downloadable `.srt` files.
6. **Team-Owned Sample Videos & Demo Mode**: Includes two prepared sample videos (Landscape Talking Head & Technical Tutorial) that run through the full AI pipeline when `GEMINI_API_KEY` is configured or in clearly labeled `DEMO MODE` using preloaded transcripts + real FFmpeg rendering.

---

## Project Structure & Team Collaboration Contracts

The codebase is modularized so four team members can work independently:

- **Member 1 (Frontend & UX Lead)**: `src/components/LandingPage.tsx`, `src/components/dashboard/`, `src/components/upload/`, `src/components/clips/`, `src/components/editor/`, `src/components/export/`
- **Member 2 (Backend & Integration Lead)**: `server.ts`, `server/routes/api.ts`, `server/workers/jobProcessor.ts`, `server/utils/storage.ts`, `src/types/clipforge.ts`
- **Member 3 (AI & Video Intelligence Lead)**: `server/ai/geminiService.ts`, `server/samples/sampleData.ts`
- **Member 4 (Media Processing, QA & DevOps Lead)**: `server/media/ffmpegService.ts`, `server/utils/subtitles.ts`, `tests/clipforge.test.ts`

---

## Environment Variables

Configure via `.env` or Google AI Studio **Settings > Secrets**:

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
GEMINI_MODEL="gemini-4-hydrogen"
GEMINI_TTS_MODEL="gemini-3.8-flash-lite-tts"
MAX_UPLOAD_MB="250"
MAX_DURATION_SECONDS="900"
PORT="3000"
```

---

## Setup & Local Run

Prerequisites: Node.js 22+, `ffmpeg`, and `ffprobe` available in `PATH`.

```bash
npm install
npm run dev
```

Run automated tests and type-checking:

```bash
npm test
npm run lint
npm run build
```

Production start:

```bash
npm run build
NODE_ENV=production npm start
```

---

## REST API Reference

| Method & Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Check FFmpeg, FFprobe, libx264, libass, and Gemini API configuration |
| `GET /api/samples` | List team-owned sample videos |
| `POST /api/samples/:sampleId/start` | Launch sample video in AI or Demo Mode |
| `POST /api/videos` | Multipart upload (`video` field) and enqueue processing job |
| `GET /api/jobs` | List all video jobs |
| `GET /api/jobs/:jobId` | Read real job status, stage, progress, and FFprobe metadata |
| `POST /api/jobs/:jobId/retry` | Retry a failed analysis job |
| `GET /api/jobs/:jobId/transcript` | Retrieve timestamped transcript segments |
| `GET /api/jobs/:jobId/clips` | List ranked AI highlight candidates |
| `PATCH /api/clips/:clipId` | Edit clip title, start/end timestamps, framing, resolution, or subtitle cues |
| `POST /api/clips/:clipId/render` | Enqueue FFmpeg 9:16 MP4 + SRT export |
| `GET /api/exports/:exportId` | Stream MP4 or download MP4/SRT (`?format=mp4\|srt&download=1`) |
| `DELETE /api/jobs/:jobId` | Delete project metadata, uploaded video, audio, and rendered exports |
| `POST /api/maintenance/cleanup` | Clean up orphaned temporary files |

---

## Known Limitations (Hackathon MVP)

1. **Single-Instance Queue**: Uses an in-process async queue and local JSON metadata (`storage/db.json`) instead of Redis + PostgreSQL. Multi-instance horizontal scaling requires migrating the queue and storage layer.
2. **Ephemeral Local Storage**: Uploaded videos and rendered exports reside in `storage/` on local disk; container restarts clear temporary artifacts.
3. **Spoken Audio Required for AI Analysis**: Videos without an audio stream cannot be transcribed via speech analysis and will return a clear validation error.
4. **Center Crop vs Speaker Tracking**: Uses clean center crop or blurred-background fill in 9:16 rather than per-frame active speaker face tracking.
