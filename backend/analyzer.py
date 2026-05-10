import json
import re


def _auto_num_clips(segments: list[dict]) -> int:
    """Decide how many clips to extract based on video duration and topic variety."""
    if not segments:
        return 3
    total_dur = segments[-1]["end"] - segments[0]["start"]
    # Count distinct themes across the transcript
    themes = set()
    for seg in segments:
        t = _extract_theme(seg["text"])
        if t != "Contenu général":
            themes.add(t)
    by_duration = max(2, min(8, round(total_dur / 150)))   # 1 clip per ~2.5 min
    by_themes = max(2, min(8, len(themes) + 1))
    return max(by_duration, by_themes)


def analyze_transcript(segments: list[dict], num_clips: int, topics: str, api_key: str) -> list[dict]:
    actual = num_clips if num_clips > 0 else _auto_num_clips(segments)
    if api_key and api_key.strip():
        return _analyze_with_claude(segments, actual, topics, api_key)
    return _analyze_heuristic(segments, actual, topics)


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

Identifie les {num_clips} meilleurs passages pour en faire des clips viraux. Tu DOIS proposer EXACTEMENT {num_clips} clips, répartis sur toute la vidéo (pas tous au même endroit).{topic_line}

Critères :
- Passage auto-suffisant (compréhensible sans contexte)
- Durée idéale : 30 à 90 secondes
- Fort engagement : insight surprenant, conseil pratique, anecdote, moment émotionnel, "hook" fort
- Début accrocheur, fin naturelle
- Les {num_clips} clips doivent couvrir des sujets/moments DIFFÉRENTS de la vidéo

Réponds UNIQUEMENT avec du JSON valide (pas de markdown, pas de texte autour) :
[
  {{
    "title": "Titre accrocheur du clip (max 60 caractères)",
    "theme": "Thème principal en 2-4 mots (ex: Conseils business, Anecdote personnelle, Critique sociale, Astuce productivité…)",
    "reason": "Explication précise : de quoi parle ce passage et pourquoi il est intéressant (1-2 phrases)",
    "start": <début_en_secondes>,
    "end": <fin_en_secondes>
  }}
]"""

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=3000,
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
            "title": s.get("title", "Clip"),
            "theme": s.get("theme", "Contenu général"),
            "reason": s.get("reason", ""),
            "start": start,
            "end": end,
            "text": text,
            "words": words,
        })
    return result


# Themes detected by simple keyword matching (used in heuristic mode)
_THEME_KEYWORDS = {
    "Conseils pratiques": ["conseil", "astuce", "technique", "méthode", "comment faire", "façon de", "tips", "étape", "solution"],
    "Motivation & mindset": ["motivation", "réussite", "succès", "objectif", "mental", "mindset", "croire", "confiance", "persévér", "rêve"],
    "Argent & finance": ["argent", "finance", "investi", "revenu", "salaire", "économ", "budget", "richesse", "euro", "million", "dollar", "banque"],
    "Santé & bien-être": ["santé", "sport", "exercice", "nutrition", "sommeil", "bien-être", "régime", "manger", "calorie", "muscle", "corps"],
    "Technologie & IA": ["technologie", " ia ", "intelligence artificielle", "tech", "logiciel", "application", "digital", "robot", "chatgpt", "algorithme"],
    "Développement personnel": ["apprentissage", "formation", "compétence", "habitude", "productivité", "lire", "apprendre", "discipline"],
    "Relations & communication": ["relation", "communication", "équipe", "leadership", "couple", "ami", "famille", "amour", "conflit"],
    "Humour & divertissement": ["rire", "drôle", "fun", "blague", "humour", "incroyable", "mdr", "haha"],
    "Anecdote & témoignage": ["quand j'", "une fois", "j'ai vécu", "mon expérience", "je me souviens", "il m'est arrivé", "raconte"],
    "Business & entrepreneuriat": ["business", "entreprise", "startup", "client", "vente", "produit", "service", "entrepreneur", "marché", "boîte"],
    "Société & politique": ["société", "politique", "gouvernement", "loi", "président", "élection", "citoyen", "démocratie"],
    "Éducation & savoir": ["école", "université", "étudiant", "professeur", "diplôme", "savoir", "connaissance", "histoire"],
}


def _extract_theme(text: str) -> str:
    """Detect the dominant theme of a passage via keyword matching."""
    text_lower = " " + text.lower() + " "
    scores = {}
    for theme, keywords in _THEME_KEYWORDS.items():
        score = sum(text_lower.count(kw) for kw in keywords)
        if score > 0:
            scores[theme] = score
    if scores:
        return max(scores, key=scores.get)
    return "Contenu général"


def _short_summary(text: str, max_words: int = 14) -> str:
    """Pick a short representative excerpt for the clip title."""
    cleaned = re.sub(r"\s+", " ", text).strip()
    words = cleaned.split()
    if len(words) <= max_words:
        return cleaned
    return " ".join(words[:max_words]) + "…"


def _analyze_heuristic(segments: list[dict], num_clips: int, topics: str) -> list[dict]:
    """Fallback when no Claude key: pick non-overlapping ~30-90s windows by content density."""
    MIN_DUR, MAX_DUR = 20.0, 90.0
    candidates = []
    n = len(segments)

    if n == 0:
        return []

    topic_keywords = [t.strip().lower() for t in topics.split(",") if t.strip()] if topics else []

    for i in range(n):
        w_start = segments[i]["start"]
        w_end = segments[i]["end"]
        text = segments[i]["text"]
        words = list(segments[i].get("words", []))
        j = i + 1

        # Extend window WITHOUT exceeding MAX_DUR (the previous bug: it overshot)
        while j < n:
            next_end = segments[j]["end"]
            if next_end - w_start > MAX_DUR:
                break
            w_end = next_end
            text += " " + segments[j]["text"]
            words += segments[j].get("words", [])
            j += 1

        dur = w_end - w_start
        if dur < MIN_DUR:
            continue

        word_count = len(text.split())
        # Density score, with a soft preference for ~60s clips
        density = word_count / dur
        length_bonus = 1.0 - abs(dur - 60.0) / 90.0  # peaks at 60s
        topic_bonus = 0.0
        if topic_keywords:
            text_lower = text.lower()
            topic_bonus = sum(0.5 for kw in topic_keywords if kw in text_lower)
        score = density * (1.0 + 0.3 * length_bonus) + topic_bonus

        candidates.append({
            "start": w_start,
            "end": w_end,
            "text": text,
            "words": words,
            "score": score,
            "word_count": word_count,
        })

    # Greedy non-overlap: pick highest score, then next non-overlapping, etc.
    candidates.sort(key=lambda x: x["score"], reverse=True)
    selected = []
    for c in candidates:
        overlaps = any(not (c["end"] <= s["start"] or c["start"] >= s["end"]) for s in selected)
        if not overlaps:
            selected.append(c)
        if len(selected) >= num_clips:
            break

    selected.sort(key=lambda x: x["start"])

    result = []
    for idx, c in enumerate(selected, 1):
        theme = _extract_theme(c["text"])
        excerpt = _short_summary(c["text"])
        result.append({
            "title": f"Clip {idx} — {theme}",
            "theme": theme,
            "reason": (
                f"Passage de {c['end'] - c['start']:.0f}s avec {c['word_count']} mots. "
                f"Sujet abordé : « {excerpt} »"
            ),
            "start": c["start"],
            "end": c["end"],
            "text": c["text"],
            "words": c["words"],
        })
    return result
