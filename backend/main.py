import asyncio
import os
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

# In-memory job store: { job_id -> job_dict }
JOBS: dict[str, dict] = {}


class ProcessRequest(BaseModel):
    url: str
    platform: str = "tiktok"   # tiktok | reels | shorts | twitter
    num_clips: int = 5
    topics: str = ""
    api_key: str = ""       # Anthropic key (optional, for smart analysis)
    groq_key: str = ""      # Groq key (required for transcription)


@app.post("/api/process")
async def process_video(req: ProcessRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "pending",
        "progress": 0,
        "message": "En attente…",
        "clips": [],
        "error": None,
    }
    background_tasks.add_task(_run_pipeline, job_id, req)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job introuvable")
    return JOBS[job_id]


@app.get("/api/clips/{filename}")
async def download_clip(filename: str):
    path = CLIPS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Clip introuvable")
    return FileResponse(str(path), media_type="video/mp4", filename=filename)


def _update(job_id: str, **kwargs):
    JOBS[job_id].update(kwargs)


async def _run_pipeline(job_id: str, req: ProcessRequest):
    try:
        # ── 1. Download ──────────────────────────────────────────────────────
        _update(job_id, status="processing", progress=5, message="⬇️  Téléchargement de la vidéo…")
        video_path = await asyncio.to_thread(
            download_video, req.url, str(DOWNLOADS_DIR / job_id)
        )

        # ── 2. Transcribe ────────────────────────────────────────────────────
        _update(job_id, progress=20, message="🎙️  Transcription audio en cours…")
        segments = await asyncio.to_thread(transcribe_video, video_path, req.groq_key)

        if not segments:
            raise RuntimeError("La transcription n'a produit aucun résultat. La vidéo contient-elle de l'audio ?")

        # ── 3. Analyze ───────────────────────────────────────────────────────
        _update(job_id, progress=60, message="🧠  Analyse intelligente du contenu…")
        clip_data = await asyncio.to_thread(
            analyze_transcript, segments, req.num_clips, req.topics, req.api_key
        )

        # ── 4. Extract clips ─────────────────────────────────────────────────
        clips = []
        for i, seg in enumerate(clip_data):
            _update(
                job_id,
                progress=65 + (i * 30 // max(len(clip_data), 1)),
                message=f"✂️  Création du clip {i + 1}/{len(clip_data)}…",
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
                "reason": seg.get("reason", ""),
                "start": round(seg["start"], 1),
                "end": round(seg["end"], 1),
                "duration": round(seg["end"] - seg["start"], 1),
                "transcript": seg.get("text", ""),
            })

        _update(job_id, status="done", progress=100, message="✅  Terminé !", clips=clips)

        # Clean up downloaded video to save space
        try:
            os.remove(video_path)
        except OSError:
            pass

    except Exception as exc:
        _update(job_id, status="error", message=str(exc), error=str(exc))
