import subprocess
import sys
import os
from pathlib import Path

# ASS script template — PlayRes set explicitly so MarginV is always in real pixels.
_ASS_HEADER = """\
[Script Info]
PlayResX: {res_x}
PlayResY: {res_y}
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,{outline},2,2,{ml},{mr},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# Per-platform style values (all sizes are in real pixels matching PlayRes).
_STYLE = {
    "vertical": dict(res_x=1080, res_y=1920, font_size=72, outline=5, ml=70, mr=70, mv=80),
    "horizontal": dict(res_x=1280, res_y=720,  font_size=42, outline=3, ml=50, mr=50, mv=35),
}


def _platform_style(platform: str) -> dict:
    if platform in ("tiktok", "reels", "shorts"):
        return _STYLE["vertical"]
    return _STYLE["horizontal"]


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


def _fmt_ass(sec: float) -> str:
    """Format seconds as ASS timecode H:MM:SS.cs"""
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec % 1) * 100))
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _generate_ass(words: list[dict], clip_start: float, ass_path: str, platform: str):
    """Write an ASS subtitle file with 4-word chunks and correct screen positioning."""
    CHUNK = 4
    st = _platform_style(platform)
    header = _ASS_HEADER.format(**st)

    chunks = [words[i: i + CHUNK] for i in range(0, len(words), CHUNK)]
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header)
        for chunk in chunks:
            text = " ".join(w["word"].strip() for w in chunk)
            t_start = _fmt_ass(chunk[0]["start"] - clip_start)
            t_end = _fmt_ass(chunk[-1]["end"] - clip_start)
            f.write(f"Dialogue: 0,{t_start},{t_end},Default,,0,0,0,,{text}\n")


def _build_video_filter(platform: str, sub_path: str):
    safe_path = sub_path.replace("\\", "/").replace(":", "\\:")

    if platform in ("tiktok", "reels", "shorts"):
        bg = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5"
        fg = "scale=1080:-2"
        vf = (
            f"[0:v]{bg}[bg];"
            f"[0:v]{fg}[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
            f"subtitles='{safe_path}'"
            f"[vout]"
        )
        return vf, True
    else:
        vf = (
            f"scale='min(1280,iw)':-2,"
            f"subtitles='{safe_path}'"
        )
        return vf, False


def extract_clip(
    video_path: str,
    start: float,
    end: float,
    output_path: str,
    platform: str,
    words: list[dict],
):
    duration = end - start
    sub_path = output_path.replace(".mp4", ".ass")

    if words:
        _generate_ass(words, start, sub_path, platform)
    else:
        # Empty ASS so ffmpeg doesn't error on a missing file
        st = _platform_style(platform)
        with open(sub_path, "w", encoding="utf-8") as f:
            f.write(_ASS_HEADER.format(**st))

    vf, is_complex = _build_video_filter(platform, sub_path)

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
    if os.path.exists(sub_path):
        os.remove(sub_path)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg a échoué : {result.stderr[-500:]}")
