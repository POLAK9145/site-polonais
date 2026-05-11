import re
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
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline},2,2,{ml},{mr},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# Per-platform style values (all sizes are in real pixels matching PlayRes).
_STYLE = {
    "vertical": dict(res_x=1080, res_y=1920, font_size=72, outline=5, ml=80, mr=80, mv=180),
    "horizontal": dict(res_x=1280, res_y=720, font_size=42, outline=3, ml=60, mr=60, mv=50),
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


def _chunk_words(words: list[dict]) -> list[list[dict]]:
    """Group words into subtitle chunks based on natural pauses and a max length."""
    MAX_WORDS = 5
    MAX_DUR = 3.5
    PAUSE_GAP = 0.45  # split when there's a >450ms gap between words

    chunks: list[list[dict]] = []
    current: list[dict] = []
    for w in words:
        if current:
            gap = w["start"] - current[-1]["end"]
            chunk_dur = w["end"] - current[0]["start"]
            if (
                len(current) >= MAX_WORDS
                or gap >= PAUSE_GAP
                or chunk_dur > MAX_DUR
            ):
                chunks.append(current)
                current = []
        current.append(w)
    if current:
        chunks.append(current)
    return chunks


def _generate_ass(words: list[dict], clip_start: float, clip_duration: float, ass_path: str, platform: str, emphasized_words: list[str] = None):
    """Write an ASS subtitle file with pause-based chunking and word emphasis."""
    MIN_DISPLAY = 0.9
    st = _platform_style(platform)
    header = _ASS_HEADER.format(**st)

    # Build a normalized set of words to emphasize
    emph_set = set()
    for w in (emphasized_words or []):
        clean = re.sub(r"[^\w]", "", w.lower())
        if clean:
            emph_set.add(clean)

    # Emphasis style: brighter yellow, slightly larger
    emph_size = st["font_size"] + 18
    EMPH_ON = f"{{\\c&H0000FFFF&\\fs{emph_size}\\b1}}"
    EMPH_OFF = "{\\r}"

    def _word_text(w):
        raw = (w.get("word") or "").strip()
        if emph_set:
            clean = re.sub(r"[^\w]", "", raw.lower())
            if clean in emph_set:
                return f"{EMPH_ON}{raw}{EMPH_OFF}"
        return raw

    words = [w for w in words if (w.get("word") or "").strip()]
    chunks = _chunk_words(words)

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header)
        for idx, chunk in enumerate(chunks):
            t_start_abs = chunk[0]["start"] - clip_start
            t_end_abs = chunk[-1]["end"] - clip_start

            if t_end_abs - t_start_abs < MIN_DISPLAY:
                t_end_abs = t_start_abs + MIN_DISPLAY
            if idx + 1 < len(chunks):
                next_start = chunks[idx + 1][0]["start"] - clip_start
                if t_end_abs > next_start - 0.05:
                    t_end_abs = next_start - 0.05

            t_start_abs = max(0.0, t_start_abs)
            t_end_abs = min(clip_duration, t_end_abs)
            if t_end_abs <= t_start_abs:
                continue

            text = " ".join(_word_text(w) for w in chunk).strip()
            if not text:
                continue
            f.write(f"Dialogue: 0,{_fmt_ass(t_start_abs)},{_fmt_ass(t_end_abs)},Default,,0,0,0,,{text}\n")


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
    emphasized_words: list[str] = None,
):
    duration = end - start
    sub_path = output_path.replace(".mp4", ".ass")

    if words:
        _generate_ass(words, start, duration, sub_path, platform, emphasized_words)
    else:
        st = _platform_style(platform)
        with open(sub_path, "w", encoding="utf-8") as f:
            f.write(_ASS_HEADER.format(**st))

    vf, is_complex = _build_video_filter(platform, sub_path)

    # -ss after -i = frame-accurate seek (slower but subtitles stay in sync).
    # The hybrid pre-seek approach caused keyframe-rounding errors that
    # shifted the clip start by up to 2 s and desynchronised every subtitle.
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-ss", f"{start:.3f}",
        "-t", f"{duration:.3f}",
    ]
    if is_complex:
        cmd += ["-filter_complex", vf, "-map", "[vout]", "-map", "0:a?"]
    else:
        cmd += ["-vf", vf]
    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if os.path.exists(sub_path):
        os.remove(sub_path)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg a échoué : {result.stderr[-500:]}")
