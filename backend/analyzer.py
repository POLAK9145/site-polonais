import json
import re


def analyze_transcript(segments: list[dict], num_clips: int, topics: str, api_key: str) -> list[dict]:
    if api_key and api_key.strip():
        return _analyze_with_claude(segments, num_clips, topics, api_key)
    return _analyze_heuristic(segments, num_clips, topics)


def _collect_words_in_range(segments: list[dict], start: float, end: float):
    words = []
    text_parts = []
    for seg in segments:
        if seg["end"] > start and seg["start"] < end:
            text_parts.append(seg["text"])
            for w in seg.get("words", []):
                if w["end"] > start and w["start"] < end:
                    words.append(w)
    return words, " ".join(text_parts)


def _analyze_with_claude(segments: list[dict], num_clips: int, topics: str, api_key: str) -> list[dict]:
    import anthropic

    full_transcript = "\n".join(
        f"[{s['start']:.1f}s – {s['end']:.1f}s] {s['text']}" for s in segments
    )
    topic_line = f"\nConcentre-toi sur ces sujets/thèmes : {topics}" if topics.strip() else ""

    prompt = f"""Tu es un expert en création de contenu viral pour TikTok, Instagram Reels et YouTube Shorts.

Voici la transcription complète d'une vidéo avec les timestamps :

{full_transcript}

Identifie les {num_clips} meilleurs passages pour en faire des clips viraux.{topic_line}

Critères :
- Passage auto-suffisant (compréhensible sans contexte)
- Durée idéale : 30 à 90 secondes
- Fort engagement : insight surprenant, conseil pratique, anecdote, moment émotionnel, "hook" fort
- Début accrocheur, fin naturelle

Réponds UNIQUEMENT avec du JSON valide (pas de markdown) :
[
  {{
    "title": "Titre accrocheur du clip (max 60 caractères)",
    "reason": "Pourquoi ce passage est viral (1 phrase)",
    "start": <début_en_secondes>,
    "end": <fin_en_secondes>
  }}
]"""

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    suggestions = json.loads(raw)
    result = []
    for s in suggestions:
        start, end = float(s["start"]), float(s["end"])
        words, text = _collect_words_in_range(segments, start, end)
        result.append({
            "title": s["title"],
            "reason": s["reason"],
            "start": start,
            "end": end,
            "text": text,
            "words": words,
        })
    return result


def _analyze_heuristic(segments: list[dict], num_clips: int, topics: str) -> list[dict]:
    """Fallback: pick non-overlapping windows of ~45-75s with highest word density."""
    MIN_DUR, MAX_DUR = 30.0, 90.0
    candidates = []
    n = len(segments)

    for i in range(n):
        w_start = segments[i]["start"]
        w_end = segments[i]["end"]
        text = segments[i]["text"]
        words = list(segments[i].get("words", []))
        j = i + 1
        while j < n and (w_end - w_start) < MAX_DUR:
            w_end = segments[j]["end"]
            text += " " + segments[j]["text"]
            words += segments[j].get("words", [])
            j += 1

        dur = w_end - w_start
        if MIN_DUR <= dur <= MAX_DUR:
            score = len(text.split()) / dur
            candidates.append({
                "title": f"Passage {len(candidates) + 1}",
                "reason": "Passage à haute densité d'information",
                "start": w_start,
                "end": w_end,
                "text": text,
                "words": words,
                "score": score,
            })

    candidates.sort(key=lambda x: x["score"], reverse=True)

    selected = []
    for c in candidates:
        if not any(not (c["end"] <= s["start"] or c["start"] >= s["end"]) for s in selected):
            selected.append(c)
        if len(selected) >= num_clips:
            break

    selected.sort(key=lambda x: x["start"])
    return selected
