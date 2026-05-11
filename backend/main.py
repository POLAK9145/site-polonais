import asyncio
import io
import os
import time
import uuid
import zipfile
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from transcriber import transcribe_video
from analyzer import analyze_transcript
from clipper import download_video, extract_clip

app = FastAPI(title="Video Clip Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CLIPS_DIR = Path(__file__).parent / "clips"
DOWNLOADS_DIR = Path(__file__).parent / "downloads"
CLIPS_DIR.mkdir(exist_ok=True)
DOWNLOADS_DIR.mkdir(exist_ok=True)

# Auto-delete clips and source files older than this (seconds)
_JOB_TTL = 2 * 60 * 60  # 2 hours

# In-memory job store: { job_id -> job_dict }
JOBS: dict[str, dict] = {}


class ProcessRequest(BaseModel):
    url: str
    platform: str = "tiktok"   # tiktok | reels | shorts | twitter
    num_clips: int = 0          # 0 = auto, otherwise explicit count
    topics: str = ""
    api_key: str = ""           # Anthropic key (optional, for smart analysis)
    groq_key: str = ""          # Groq key (required for transcription)


def _cleanup_stale():
    """Drop expired jobs and their files. Called opportunistically on requests."""
    now = time.time()
    expired = [jid for jid, job in JOBS.items() if now - job.get("_created", now) > _JOB_TTL]
    for jid in expired:
        for clip in JOBS[jid].get("clips", []):
            try:
                (CLIPS_DIR / clip["filename"]).unlink(missing_ok=True)
            except Exception:
                pass
        try:
            (DOWNLOADS_DIR / f"{jid}.mp4").unlink(missing_ok=True)
        except Exception:
            pass
        del JOBS[jid]


@app.post("/api/process")
async def process_video(req: ProcessRequest, background_tasks: BackgroundTasks):
    _cleanup_stale()
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "pending",
        "progress": 0,
        "message": "En attente…",
        "clips": [],
        "error": None,
        "_created": time.time(),
    }
    background_tasks.add_task(_run_pipeline, job_id, req)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job introuvable")
    # Don't leak the internal _created timestamp
    return {k: v for k, v in JOBS[job_id].items() if not k.startswith("_")}


@app.get("/api/clips/{filename}")
async def download_clip(filename: str):
    path = CLIPS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Clip introuvable")
    return FileResponse(str(path), media_type="video/mp4", filename=filename)


@app.get("/api/jobs/{job_id}/zip")
async def download_all(job_id: str):
    """Bundle every clip for a job into a single zip file."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job introuvable")
    clips = JOBS[job_id].get("clips", [])
    if not clips:
        raise HTTPException(status_code=400, detail="Aucun clip disponible")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for clip in clips:
            path = CLIPS_DIR / clip["filename"]
            if not path.exists():
                continue
            # Friendly name inside the zip
            safe_title = "".join(c for c in clip.get("title", "clip") if c.isalnum() or c in " -_").strip()
            inner_name = f"{clip['id']:02d}_{safe_title or 'clip'}.mp4"
            zf.write(str(path), arcname=inner_name)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="clipai_{job_id[:8]}.zip"'},
    )


def _update(job_id: str, **kwargs):
    JOBS[job_id].update(kwargs)


async def _run_pipeline(job_id: str, req: ProcessRequest):
    try:
        # ── 1. Download ─────────────────────────────────────────────────
        _update(job_id, status="processing", progress=5, message="⬇️  Téléchargement de la vidéo…")
        video_path = await asyncio.to_thread(
            download_video, req.url, str(DOWNLOADS_DIR / job_id)
        )

        # ── 2. Transcribe ───────────────────────────────────────────────
        _update(job_id, progress=20, message="🎙️  Transcription audio (Groq)…")
        segments = await asyncio.to_thread(transcribe_video, video_path, req.groq_key)

        if not segments:
            raise RuntimeError("La transcription n'a produit aucun résultat. La vidéo contient-elle de l'audio ?")

        # ── 3. Analyze ──────────────────────────────────────────────────
        analyser_label = "🧠  Analyse intelligente par Claude…" if req.api_key.strip() else "📊  Analyse par densité de contenu…"
        _update(job_id, progress=55, message=analyser_label)
        clip_data = await asyncio.to_thread(
            analyze_transcript, segments, req.num_clips, req.topics, req.api_key
        )

        if not clip_data:
            raise RuntimeError("Aucun passage intéressant trouvé. La vidéo est-elle trop courte ?")

        # ── 4. Extract clips ────────────────────────────────────────────
        clips = []
        total = len(clip_data)
        for i, seg in enumerate(clip_data):
            _update(
                job_id,
                progress=60 + (i * 35 // max(total, 1)),
                message=f"✂️  Création du clip {i + 1}/{total} — {seg.get('theme', '')}",
            )
            clip_filename = f"{job_id}_clip{i + 1}.mp4"
            clip_path = CLIPS_DIR / clip_filename
            await asyncio.to_thread(
                extract_clip,
                video_path,
                seg["start"],
                seg["end"],
                str(clip_path),
                req.platform,
                seg.get("words", []),
            )
            clips.append({
                "id": i + 1,
                "filename": clip_filename,
                "title": seg.get("title", f"Clip {i + 1}"),
                "theme": seg.get("theme", ""),
                "reason": seg.get("reason", ""),
                "start": round(seg["start"], 1),
                "end": round(seg["end"], 1),
                "duration": round(seg["end"] - seg["start"], 1),
                "transcript": seg.get("text", ""),
            })

        _update(job_id, status="done", progress=100, message=f"✅  {total} clip(s) prêt(s) !", clips=clips)

        # Clean up the source download to save disk space
        try:
            os.remove(video_path)
        except OSError:
            pass

    except Exception as exc:
        # Translate common error patterns into something the user can act on
        msg = str(exc)
        if "API key" in msg or "Unauthorized" in msg or "401" in msg:
            msg = "Clé Groq invalide ou expirée. Vérifie-la dans ⚙."
        elif "rate limit" in msg.lower() or "429" in msg:
            msg = "Limite Groq atteinte. Réessaie dans quelques minutes."
        elif "Téléchargement échoué" in msg and "Private" in msg:
            msg = "Cette vidéo est privée ou indisponible."
        _update(job_id, status="error", message=msg, error=str(exc))
