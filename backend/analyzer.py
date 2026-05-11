import json
import re


# ── Public entry point ────────────────────────────────────────────────────────

def analyze_transcript(
    segments: list[dict],
    num_clips: int,
    topics: str,
    api_key: str,           # Anthropic key (optional)
    groq_key: str = "",     # Groq key — used both for Whisper and LLM analysis
) -> tuple[list[dict], str]:
    """Return (clips, mode) where mode is 'claude' | 'llama' | 'heuristic'."""
    actual = num_clips if num_clips > 0 else _auto_num_clips(segments)

    if api_key and api_key.strip():
        return _analyze_with_claude(segments, actual, topics, api_key), "claude"

    if groq_key and groq_key.strip():
        # No silent fallback: if Llama fails, the error surfaces in the UI
        return _analyze_with_groq_llm(segments, actual, topics, groq_key), "llama"

    return _analyze_heuristic(segments, actual, topics), "heuristic"


# ── Shared helpers ────────────────────────────────────────────────────────────

def _auto_num_clips(segments: list[dict]) -> int:
    """Decide how many clips to extract based on video duration and topic variety."""
    if not segments:
        return 3
    total_dur = segments[-1]["end"] - segments[0]["start"]
    themes = set()
    for seg in segments:
        t = _extract_theme(seg["text"])
        if t != "Contenu général":
            themes.add(t)
    by_duration = max(2, min(8, round(total_dur / 150)))  # ~1 clip per 2.5 min
    by_themes = max(2, min(8, len(themes) + 1))
    return max(by_duration, by_themes)


def _collect_words_in_range(segments: list[dict], start: float, end: float):
    """Collect words overlapping [start, end] with a small tolerance."""
    PAD = 0.15
    words = []
    text_parts = []
    for seg in segments:
        if seg["end"] > start - PAD and seg["start"] < end + PAD:
            text_parts.append(seg["text"])
            for w in seg.get("words", []):
                if w["end"] > start - PAD and w["start"] < end + PAD:
                    words.append(w)
    return words, " ".join(text_parts)


def _parse_llm_json(raw: str) -> list[dict]:
    """Strip markdown fences and parse JSON from LLM output."""
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def _build_result(s: dict, segments: list[dict]) -> dict:
    start, end = float(s["start"]), float(s["end"])
    words, text = _collect_words_in_range(segments, start, end)
    return {
        "title":            s.get("title", "Clip"),
        "theme":            s.get("theme", "Contenu général"),
        "reason":           s.get("reason", ""),
        "caption":          s.get("caption", ""),
        "emphasized_words": s.get("emphasized_words", []),
        "start":            start,
        "end":              end,
        "text":             text,
        "words":            words,
    }


# ── Groq LLM analysis (Llama 3.3 70B — free with Groq key) ───────────────────

_LLM_PROMPT = """\
Tu es un expert en création de contenu viral (TikTok, Reels, Shorts).

Transcription de la vidéo avec timestamps :
{transcript}

Identifie exactement {n} passages pour des clips viraux, bien répartis sur toute la vidéo.{topics_line}

Critères :
- Passage auto-suffisant (compréhensible sans contexte)
- Durée 30–90 secondes
- Début fort (hook accrocheur), fin naturelle sur une phrase complète
- Contenu engageant : insight surprenant, conseil pratique, anecdote, émotion forte
- Les {n} clips doivent couvrir des sujets DIFFÉRENTS

Réponds UNIQUEMENT avec du JSON valide, sans texte autour :
[
  {{
    "title": "Titre court et accrocheur (max 55 caractères)",
    "theme": "Thème en 2-4 mots",
    "reason": "Ce que ce passage apporte et pourquoi il engage (1-2 phrases)",
    "caption": "Texte de post TikTok/Instagram prêt à coller (1-3 lignes + 5 hashtags pertinents)",
    "emphasized_words": ["mot1", "mot2", "mot3"],
    "start": <secondes>,
    "end": <secondes>
  }}
]

Pour emphasized_words : choisis 2-4 mots/chiffres qui méritent d'être mis en valeur visuellement dans les sous-titres (mots forts, chiffres, mots-clés du message principal)."""


def _analyze_with_groq_llm(segments: list[dict], num_clips: int, topics: str, groq_key: str) -> list[dict]:
    from groq import Groq

    full_transcript = "\n".join(
        f"[{s['start']:.1f}s – {s['end']:.1f}s] {s['text']}" for s in segments
    )
    topics_line = f"\nConcentre-toi sur ces sujets : {topics}" if topics.strip() else ""

    prompt = _LLM_PROMPT.format(
        transcript=full_transcript,
        n=num_clips,
        topics_line=topics_line,
    )

    client = Groq(api_key=groq_key)
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.35,
        max_tokens=3000,
    )
    raw = response.choices[0].message.content
    return [_build_result(s, segments) for s in _parse_llm_json(raw)]


# ── Anthropic Claude analysis ─────────────────────────────────────────────────

def _analyze_with_claude(segments: list[dict], num_clips: int, topics: str, api_key: str) -> list[dict]:
    import anthropic

    full_transcript = "\n".join(
        f"[{s['start']:.1f}s – {s['end']:.1f}s] {s['text']}" for s in segments
    )
    topics_line = f"\nConcentre-toi sur ces sujets : {topics}" if topics.strip() else ""

    prompt = _LLM_PROMPT.format(
        transcript=full_transcript,
        n=num_clips,
        topics_line=topics_line,
    )

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text
    return [_build_result(s, segments) for s in _parse_llm_json(raw)]


# ── Heuristic fallback (no LLM) ───────────────────────────────────────────────

_THEME_KEYWORDS = {
    "Conseils pratiques":       ["conseil", "astuce", "technique", "méthode", "comment faire", "façon de", "tips", "étape", "solution"],
    "Motivation & mindset":     ["motivation", "réussite", "succès", "objectif", "mental", "mindset", "croire", "confiance", "persévér", "rêve"],
    "Argent & finance":         ["argent", "finance", "investi", "revenu", "salaire", "économ", "budget", "richesse", "euro", "million", "dollar", "banque"],
    "Santé & bien-être":        ["santé", "sport", "exercice", "nutrition", "sommeil", "bien-être", "régime", "manger", "calorie", "muscle", "corps"],
    "Technologie & IA":         ["technologie", " ia ", "intelligence artificielle", "tech", "logiciel", "application", "digital", "robot", "chatgpt", "algorithme"],
    "Développement personnel":  ["apprentissage", "formation", "compétence", "habitude", "productivité", "lire", "apprendre", "discipline"],
    "Relations & communication":["relation", "communication", "équipe", "leadership", "couple", "ami", "famille", "amour", "conflit"],
    "Humour & divertissement":  ["rire", "drôle", "fun", "blague", "humour", "incroyable", "mdr", "haha"],
    "Anecdote & témoignage":    ["quand j'", "une fois", "j'ai vécu", "mon expérience", "je me souviens", "il m'est arrivé", "raconte"],
    "Business & entrepreneuriat":["business", "entreprise", "startup", "client", "vente", "produit", "service", "entrepreneur", "marché", "boîte"],
    "Société & politique":      ["société", "politique", "gouvernement", "loi", "président", "élection", "citoyen", "démocratie"],
    "Éducation & savoir":       ["école", "université", "étudiant", "professeur", "diplôme", "savoir", "connaissance", "histoire"],
}

_IMPACTFUL = {
    "jamais", "toujours", "incroyable", "impossible", "secret", "vérité",
    "attention", "important", "gratuit", "erreur", "faux", "vrai",
    "meilleur", "pire", "seul", "unique", "révolution", "urgent",
    "million", "milliard", "maintenant", "premier", "dernier", "clé",
}


def _extract_theme(text: str) -> str:
    text_lower = " " + text.lower() + " "
    scores = {
        theme: sum(text_lower.count(kw) for kw in kws)
        for theme, kws in _THEME_KEYWORDS.items()
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "Contenu général"


def _heuristic_emphasis(clip_words: list[dict]) -> list[str]:
    """Find impactful words to emphasise without an LLM."""
    found = set()
    for w in clip_words:
        text = (w.get("word") or "").strip()
        clean = re.sub(r"[^\w]", "", text.lower())
        if not clean:
            continue
        if len(text) >= 3 and text.replace("'", "").isupper():   # ALL CAPS
            found.add(clean)
        elif re.search(r"\d", text):                              # contains a number
            found.add(clean)
        elif clean in _IMPACTFUL:                                 # impactful keyword
            found.add(clean)
        if len(found) >= 4:
            break
    return list(found)


def _short_summary(text: str, max_words: int = 14) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    words = cleaned.split()
    if len(words) <= max_words:
        return cleaned
    return " ".join(words[:max_words]) + "…"


def _analyze_heuristic(segments: list[dict], num_clips: int, topics: str) -> list[dict]:
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

        while j < n:
            if segments[j]["end"] - w_start > MAX_DUR:
                break
            w_end = segments[j]["end"]
            text += " " + segments[j]["text"]
            words += segments[j].get("words", [])
            j += 1

        dur = w_end - w_start
        if dur < MIN_DUR:
            continue

        word_count = len(text.split())
        density = word_count / dur
        length_bonus = 1.0 - abs(dur - 60.0) / 90.0
        topic_bonus = sum(0.5 for kw in topic_keywords if kw in text.lower())
        score = density * (1.0 + 0.3 * length_bonus) + topic_bonus

        candidates.append({
            "start": w_start, "end": w_end,
            "text": text, "words": words,
            "score": score, "word_count": word_count,
        })

    candidates.sort(key=lambda x: x["score"], reverse=True)
    selected = []
    for c in candidates:
        if not any(not (c["end"] <= s["start"] or c["start"] >= s["end"]) for s in selected):
            selected.append(c)
        if len(selected) >= num_clips:
            break

    selected.sort(key=lambda x: x["start"])
    result = []
    for idx, c in enumerate(selected, 1):
        theme = _extract_theme(c["text"])
        excerpt = _short_summary(c["text"])
        emph = _heuristic_emphasis(c["words"])
        result.append({
            "title": f"Clip {idx} — {theme}",
            "theme": theme,
            "reason": (
                f"Passage de {c['end'] - c['start']:.0f}s avec {c['word_count']} mots. "
                f"Sujet : « {excerpt} »"
            ),
            "caption": "",       # no caption in heuristic mode
            "emphasized_words": emph,
            "start": c["start"],
            "end": c["end"],
            "text": c["text"],
            "words": c["words"],
        })
    return result
