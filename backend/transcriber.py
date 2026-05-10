import subprocess
import os
from pathlib import Path

_model = None


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        # "small" gives good accuracy + word timestamps on CPU in reasonable time
        _model = WhisperModel("small", device="cpu", compute_type="int8")
    return _model


def extract_audio(video_path: str) -> str:
    audio_path = video_path.rsplit(".", 1)[0] + "_audio.wav"
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ac", "1", "-ar", "16000",
        "-vn", "-f", "wav", audio_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr[-300:]}")
    return audio_path


def transcribe_video(video_path: str) -> list[dict]:
    """Transcribe video and return segments with word-level timestamps."""
    audio_path = extract_audio(video_path)
    try:
        model = get_model()
        segments_iter, _ = model.transcribe(audio_path, word_timestamps=True)
        result = []
        for seg in segments_iter:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({"word": w.word, "start": w.start, "end": w.end})
            result.append({
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
                "words": words,
            })
        return result
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)
