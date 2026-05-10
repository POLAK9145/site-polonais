import subprocess
import sys
import os
from pathlib import Path


# Subtitle styles tuned per platform — short lines, safe margins, no overflow.
_STYLE_VERTICAL = (
    "FontName=Arial,"
    "FontSize=14,"
    "Bold=1,"
    "PrimaryColour=&H00FFFFFF,"   # white
    "OutlineColour=&H00000000,"   # black
    "BorderStyle=1,"
    "Outline=2,"
    "Shadow=1,"
    "Alignment=2,"                # bottom-center
    "MarginV=120,"                # well above the bottom edge of 1920px frame
    "MarginL=60,"
    "MarginR=60"
)

_STYLE_HORIZONTAL = (
    "FontName=Arial,"
    "FontSize=16,"
    "Bold=1,"
    "PrimaryColour=&H00FFFFFF,"
    "OutlineColour=&H00000000,"
    "BorderStyle=1,"
    "Outline=2,"
    "Shadow=1,"
    "Alignment=2,"
    "MarginV=40,"
    "MarginL=40,"
    "MarginR=40"
)


def download_video(url: str, output_path: str) -> str:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    out_file = f"{output_path}.mp4"
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]",
        "--merge-output-format", "mp4",
        "-o", out_file,
        "--no-playlist",
        "--no-warnings",
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Téléchargement échoué : {result.stderr[-400:]}")
    return out_file


def _generate_srt(words: list[dict], clip_start: float, srt_path: str):
    """Write an SRT file with ~4-word chunks: short lines that fit on screen."""
    CHUNK = 4

    def fmt(sec: float) -> str:
        t = max(0.0, sec - clip_start)
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = int(t % 60)
        ms = int(round((t % 1) * 1000))
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    chunks = [words[i: i + CHUNK] for i in range(0, len(words), CHUNK)]
    with open(srt_path, "w", encoding="utf-8") as f:
        for idx, chunk in enumerate(chunks, 1):
            text = " ".join(w["word"].strip() for w in chunk)
            f.write(f"{idx}\n{fmt(chunk[0]['start'])} --> {fmt(chunk[-1]['end'])}\n{text}\n\n")


def _build_video_filter(platform: str, srt_path: str) -> str:
    # Escape colons and backslashes in path for the subtitles filter
    safe_path = srt_path.replace("\\", "/").replace(":", "\\:")

    if platform in ("tiktok", "reels", "shorts"):
        # Blurred background + scaled foreground overlay → 1080×1920 vertical
        bg = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5"
        fg = "scale=1080:-2"
        vf = (
            f"[0:v]{bg}[bg];"
            f"[0:v]{fg}[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
            f"subtitles='{safe_path}':force_style='{_STYLE_VERTICAL}'"
            f"[vout]"
        )
        return vf, True  # complex filter, output pad named [vout]
    else:
        # Twitter/X: keep aspect ratio, scale to 1280p max
        vf = (
            f"scale='min(1280,iw)':-2,"
            f"subtitles='{safe_path}':force_style='{_STYLE_HORIZONTAL}'"
        )
        return vf, False  # simple -vf


def extract_clip(
    video_path: str,
    start: float,
    end: float,
    output_path: str,
    platform: str,
    words: list[dict],
):
    duration = end - start
    srt_path = output_path.replace(".mp4", ".srt")

    if words:
        _generate_srt(words, start, srt_path)
    else:
        open(srt_path, "w").close()

    vf, is_complex = _build_video_filter(platform, srt_path)

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", video_path,
        "-t", str(duration),
    ]
    if is_complex:
        cmd += ["-filter_complex", vf, "-map", "[vout]", "-map", "0:a?"]
    else:
        cmd += ["-vf", vf]
    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if os.path.exists(srt_path):
        os.remove(srt_path)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg a échoué : {result.stderr[-500:]}")
