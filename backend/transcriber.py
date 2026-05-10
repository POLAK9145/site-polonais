import os
import subprocess


def extract_audio(video_path: str) -> str:
    """Extract audio as compressed MP3 (stays under Groq's 25 MB limit)."""
    audio_path = video_path.rsplit(".", 1)[0] + "_audio.mp3"
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ac", "1", "-ar", "16000",
        "-b:a", "32k",          # 32 kbps mono — ~7 MB per 30 min
        "-vn", audio_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Extraction audio échouée : {result.stderr[-300:]}")
    return audio_path


def transcribe_video(video_path: str, groq_api_key: str = "") -> list[dict]:
    """Transcribe video and return segments with word-level timestamps."""
    audio_path = extract_audio(video_path)
    try:
        if groq_api_key and groq_api_key.strip():
            return _transcribe_groq(audio_path, groq_api_key)
        raise RuntimeError(
            "Aucune clé Groq fournie. Ajoute ta clé API Groq dans les paramètres ⚙ de l'app "
            "(gratuit sur console.groq.com)."
        )
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)


def _transcribe_groq(audio_path: str, api_key: str) -> list[dict]:
    from groq import Groq

    client = Groq(api_key=api_key)

    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            file=(os.path.basename(audio_path), f),
            model="whisper-large-v3",
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    # Build segments from Groq response
    groq_words = getattr(response, "words", []) or []
    groq_segments = getattr(response, "segments", []) or []

    # Index words by time for fast lookup
    word_list = [
        {"word": w.word, "start": w.start, "end": w.end}
        for w in groq_words
    ]

    result = []
    for seg in groq_segments:
        start, end = seg.start, seg.end
        words_in_seg = [w for w in word_list if w["start"] >= start - 0.05 and w["end"] <= end + 0.05]
        result.append({
            "start": start,
            "end": end,
            "text": seg.text.strip(),
            "words": words_in_seg,
        })

    # If no segments but we have text, make one big segment
    if not result and hasattr(response, "text") and response.text:
        result.append({
            "start": 0.0,
            "end": getattr(response, "duration", 0.0),
            "text": response.text.strip(),
            "words": word_list,
        })

    return result
