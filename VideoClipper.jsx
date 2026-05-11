import React, { useState, useRef, useCallback } from 'react';

const API = '/api';

/* ─── colour tokens ─────────────────────────────────────────────── */
const C = {
  bg: '#0d0d0f',
  surface: '#18181b',
  surfaceHover: '#232329',
  border: '#2e2e36',
  accent: '#8b5cf6',
  accentHover: '#7c3aed',
  accentLight: 'rgba(139,92,246,0.12)',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  success: '#22c55e',
  error: '#f87171',
  warning: '#fbbf24',
};

/* ─── tiny helpers ──────────────────────────────────────────────── */
function fmtDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

/* ─── sub-components ────────────────────────────────────────────── */

function SettingsModal({ groqKey, apiKey, onSave, onClose }) {
  const [draftGroq, setDraftGroq] = useState(groqKey);
  const [draftAnthropic, setDraftAnthropic] = useState(apiKey);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', color: C.text, fontSize: 16 }}>
          🔑 Clés API
        </h3>

        {/* Groq — required */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelStyle, display: 'block', marginBottom: 6 }}>
            Groq <span style={{ color: C.error, fontSize: 11 }}>OBLIGATOIRE</span>
            <span style={{ color: C.muted, fontWeight: 400 }}> — pour la transcription</span>
          </label>
          <p style={{ margin: '0 0 8px', color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
            Gratuit sur <strong style={{ color: C.accent }}>console.groq.com</strong> → "Create API Key". Aucune CB requise.
          </p>
          <input
            type="password"
            placeholder="gsk_…"
            value={draftGroq}
            onChange={e => setDraftGroq(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </div>

        {/* Anthropic — optional */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelStyle, display: 'block', marginBottom: 6 }}>
            Anthropic <span style={{ color: C.muted, fontWeight: 400, fontSize: 11 }}>optionnel — pour l'analyse IA</span>
          </label>
          <p style={{ margin: '0 0 8px', color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
            Sur <strong style={{ color: C.accent }}>console.anthropic.com</strong>. Sans clé, les clips sont choisis par densité de contenu.
          </p>
          <input
            type="password"
            placeholder="sk-ant-api03-…"
            value={draftAnthropic}
            onChange={e => setDraftAnthropic(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondaryStyle}>Annuler</button>
          <button onClick={() => { onSave(draftGroq, draftAnthropic); onClose(); }} style={btnPrimaryStyle}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformBtn({ id, label, icon, selected, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        ...platformBtnBase,
        background: selected ? C.accentLight : 'transparent',
        border: `1.5px solid ${selected ? C.accent : C.border}`,
        color: selected ? C.accent : C.muted,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

function ProgressBar({ value, message }) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: C.muted }}>{message}</span>
        <span style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${value}%`,
            background: `linear-gradient(90deg, ${C.accent}, #a78bfa)`,
            borderRadius: 99,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function ClipCard({ clip, platform }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);

  const handlePlay = () => {
    if (!playing) {
      videoRef.current?.play();
      setPlaying(true);
    } else {
      videoRef.current?.pause();
      setPlaying(false);
    }
  };

  const isVertical = ['tiktok', 'reels', 'shorts'].includes(platform);

  return (
    <div style={cardStyle}>
      {/* Video preview */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingTop: isVertical ? '177%' : '56.25%',
          background: '#000',
          borderRadius: 10,
          overflow: 'hidden',
          cursor: 'pointer',
        }}
        onClick={handlePlay}
      >
        <video
          ref={videoRef}
          src={`${API}/clips/${clip.filename}`}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'contain',
          }}
          onEnded={() => setPlaying(false)}
          playsInline
        />
        {!playing && (
          <div style={playOverlayStyle}>
            <div style={playBtnStyle}>▶</div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div style={{ padding: '12px 4px 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 14, color: C.text, lineHeight: 1.3, flex: 1 }}>
            {clip.title}
          </h4>
          <span style={durationBadgeStyle}>{fmtDuration(clip.duration)}</span>
        </div>

        {clip.theme && (
          <div style={{ marginTop: 8 }}>
            <span style={themeBadgeStyle}>🏷 {clip.theme}</span>
          </div>
        )}

        <p style={{ margin: '8px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.4 }}>
          {clip.reason}
        </p>

        <div style={{ margin: '8px 0', fontSize: 11, color: C.border, fontFamily: 'monospace' }}>
          {fmtTimestamp(clip.start)} → {fmtTimestamp(clip.end)}
        </div>

        {clip.transcript && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ fontSize: 11, color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
              Voir la transcription
            </summary>
            <p style={{
              margin: '6px 0 0',
              fontSize: 11,
              color: C.muted,
              lineHeight: 1.5,
              maxHeight: 80,
              overflow: 'auto',
              padding: '6px',
              background: '#111',
              borderRadius: 6,
            }}>
              {clip.transcript}
            </p>
          </details>
        )}

        <a
          href={`${API}/clips/${clip.filename}`}
          download={`clip_${clip.id}_${clip.title.replace(/\s+/g, '_')}.mp4`}
          style={downloadBtnStyle}
        >
          ⬇ Télécharger
        </a>
      </div>
    </div>
  );
}

function ResultsView({ job, jobId, platform, onReset }) {
  const [groupByTheme, setGroupByTheme] = useState(true);
  const [activeTheme, setActiveTheme] = useState('all');

  const clips = job.clips || [];
  const themes = [...new Set(clips.map(c => c.theme).filter(Boolean))];

  const filteredClips = activeTheme === 'all'
    ? clips
    : clips.filter(c => c.theme === activeTheme);

  const grouped = themes.length > 0
    ? themes.map(theme => ({ theme, items: filteredClips.filter(c => c.theme === theme) }))
        .filter(g => g.items.length > 0)
    : [{ theme: null, items: filteredClips }];

  const handleDownloadAll = () => {
    window.location.href = `${API}/jobs/${jobId}/zip`;
  };

  return (
    <div>
      <div style={resultsHeaderStyle}>
        <div>
          <h2 style={{ margin: 0, color: C.text, fontSize: 20 }}>
            {clips.length} clip{clips.length > 1 ? 's' : ''} extraits ✨
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>
            Aperçu, puis télécharge les clips qui t'intéressent
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleDownloadAll} style={btnPrimaryStyle}>
            ⬇ Tout (.zip)
          </button>
          <button onClick={onReset} style={btnSecondaryStyle}>↩ Nouvelle vidéo</button>
        </div>
      </div>

      {themes.length > 1 && (
        <div style={toolbarStyle}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
            <span style={{ fontSize: 12, color: C.muted, marginRight: 4 }}>Filtrer :</span>
            <FilterChip label={`Tous (${clips.length})`} active={activeTheme === 'all'} onClick={() => setActiveTheme('all')} />
            {themes.map(t => (
              <FilterChip
                key={t}
                label={`${t} (${clips.filter(c => c.theme === t).length})`}
                active={activeTheme === t}
                onClick={() => setActiveTheme(t)}
              />
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={groupByTheme}
              onChange={e => setGroupByTheme(e.target.checked)}
              style={{ accentColor: C.accent }}
            />
            Grouper par thème
          </label>
        </div>
      )}

      {groupByTheme && themes.length > 0 ? (
        grouped.map(({ theme, items }) => (
          <div key={theme || 'none'} style={{ marginBottom: 32 }}>
            {theme && (
              <h3 style={groupTitleStyle}>
                <span style={{ color: C.accent }}>🏷</span> {theme}
                <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                  · {items.length} clip{items.length > 1 ? 's' : ''}
                </span>
              </h3>
            )}
            <div style={gridStyle}>
              {items.map(clip => (
                <ClipCard key={clip.id} clip={clip} platform={platform} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div style={gridStyle}>
          {filteredClips.map(clip => (
            <ClipCard key={clip.id} clip={clip} platform={platform} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? C.accentLight : 'transparent',
        border: `1px solid ${active ? C.accent : C.border}`,
        color: active ? C.accent : C.muted,
        borderRadius: 14,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/* ─── main component ────────────────────────────────────────────── */

export default function VideoClipper() {
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('tiktok');
  const [numClips, setNumClips] = useState(0);
  const [topics, setTopics] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('anthropic_key') || '');
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('groq_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const pollRef = useRef(null);

  const saveKeys = useCallback((newGroq, newAnthropic) => {
    setGroqKey(newGroq);
    setApiKey(newAnthropic);
    localStorage.setItem('groq_key', newGroq);
    localStorage.setItem('anthropic_key', newAnthropic);
  }, []);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const startPolling = useCallback((id) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/jobs/${id}`);
        const data = await res.json();
        setJob(data);
        if (data.status === 'done' || data.status === 'error') stopPolling();
      } catch {
        // network blip, keep polling
      }
    }, 1500);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    stopPolling();
    setJob({ status: 'pending', progress: 0, message: 'Envoi de la requête…', clips: [] });
    setJobId(null);

    try {
      const res = await fetch(`${API}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          platform,
          num_clips: numClips,
          topics,
          api_key: apiKey,
          groq_key: groqKey,
        }),
      });
      const { job_id } = await res.json();
      setJobId(job_id);
      startPolling(job_id);
    } catch (err) {
      setJob({ status: 'error', message: `Erreur réseau : ${err.message}`, clips: [] });
    }
  };

  const handleReset = () => {
    stopPolling();
    setJob(null);
    setJobId(null);
    setUrl('');
  };

  const isProcessing = job && job.status === 'processing';
  const isDone = job && job.status === 'done';
  const isError = job && job.status === 'error';

  return (
    <div style={pageStyle}>
      {showSettings && (
        <SettingsModal
          groqKey={groqKey}
          apiKey={apiKey}
          onSave={saveKeys}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>
            <span style={{ color: C.accent }}>✦</span> ClipAI
          </h1>
          <p style={subtitleStyle}>
            Extrais les meilleurs moments de n'importe quelle vidéo avec l'IA
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          style={settingsBtnStyle}
          title="Configurer la clé API"
        >
          ⚙ {groqKey ? <span style={{ color: C.success, fontSize: 10 }}>●</span> : <span style={{ color: C.error, fontSize: 10 }}>●</span>} API
        </button>
      </div>

      {/* Form */}
      {!isProcessing && !isDone && (
        <form onSubmit={handleSubmit} style={formStyle}>
          {/* URL input */}
          <div style={fieldStyle}>
            <label style={labelStyle}>URL de la vidéo</label>
            <input
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {/* Platform */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Format de sortie</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { id: 'tiktok', label: 'TikTok', icon: '🎵' },
                { id: 'reels', label: 'Reels', icon: '📸' },
                { id: 'shorts', label: 'Shorts', icon: '▶️' },
                { id: 'twitter', label: 'Twitter / X', icon: '🐦' },
              ].map(p => (
                <PlatformBtn key={p.id} {...p} selected={platform === p.id} onClick={setPlatform} />
              ))}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: C.muted }}>
              {['tiktok', 'reels', 'shorts'].includes(platform)
                ? 'Format vertical 9:16 — fond flouté automatique'
                : 'Format horizontal — aspect ratio original préservé'}
            </p>
          </div>

          {/* Number of clips */}
          <div style={fieldStyle}>
            <label style={labelStyle}>
              Nombre de clips —{' '}
              <strong style={{ color: C.accent }}>
                {numClips === 0 ? '✨ Auto' : numClips}
              </strong>
            </label>
            <input
              type="range"
              min={0} max={10}
              value={numClips}
              onChange={e => setNumClips(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted }}>
              <span>Auto</span><span>10</span>
            </div>
            {numClips === 0 && (
              <p style={{ margin: 0, fontSize: 11, color: C.accent }}>
                L'IA analysera la vidéo et décidera du nombre optimal de clips selon les thèmes abordés.
              </p>
            )}
          </div>

          {/* Topics */}
          <div style={fieldStyle}>
            <label style={labelStyle}>
              Sujets à privilégier <span style={{ color: C.muted, fontWeight: 400 }}>(optionnel)</span>
            </label>
            <input
              type="text"
              placeholder="ex : conseils business, anecdotes, moments drôles…"
              value={topics}
              onChange={e => setTopics(e.target.value)}
              style={inputStyle}
            />
          </div>

          {!groqKey && (
            <div style={{ ...warningBoxStyle, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#fca5a5' }}>
              <strong>⚠️ Clé Groq manquante.</strong> La transcription ne fonctionnera pas sans elle.{' '}
              <span onClick={() => setShowSettings(true)} style={{ color: C.accent, cursor: 'pointer', textDecoration: 'underline' }}>
                Configurer maintenant →
              </span>
            </div>
          )}
          {groqKey && !apiKey && (
            <div style={warningBoxStyle}>
              <strong>⚡ Sans clé Anthropic :</strong> sélection par densité de contenu.{' '}
              <span onClick={() => setShowSettings(true)} style={{ color: C.accent, cursor: 'pointer', textDecoration: 'underline' }}>
                Ajouter →
              </span>
            </div>
          )}

          <button type="submit" style={btnPrimaryLargeStyle}>
            🚀 Analyser et extraire les clips
          </button>
        </form>
      )}

      {/* Processing state */}
      {isProcessing && (
        <div style={processingStyle}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={spinnerStyle} />
            <h2 style={{ color: C.text, margin: '16px 0 4px' }}>Traitement en cours…</h2>
            <p style={{ color: C.muted, fontSize: 14 }}>
              Selon la longueur de la vidéo, cela peut prendre quelques minutes.
            </p>
          </div>
          <ProgressBar value={job.progress} message={job.message} />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div style={errorBoxStyle}>
          <h3 style={{ margin: '0 0 8px', color: C.error }}>Erreur</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.5 }}>{job.message}</p>
          <button onClick={handleReset} style={btnSecondaryStyle}>↩ Recommencer</button>
        </div>
      )}

      {/* Results */}
      {isDone && (
        <ResultsView
          job={job}
          jobId={jobId}
          platform={platform}
          onReset={handleReset}
        />
      )}
    </div>
  );
}

/* ─── styles ────────────────────────────────────────────────────── */

const pageStyle = {
  maxWidth: 900,
  margin: '0 auto',
  padding: 'clamp(20px, 5vw, 40px) clamp(14px, 4vw, 20px) 80px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: C.text,
  minHeight: '100vh',
};

const resultsHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 20,
};

const toolbarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: '10px 12px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  marginBottom: 24,
};

const groupTitleStyle = {
  margin: '0 0 14px',
  fontSize: 15,
  fontWeight: 700,
  color: C.text,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 40,
};

const titleStyle = {
  margin: 0,
  fontSize: 'clamp(24px, 6vw, 32px)',
  fontWeight: 800,
  letterSpacing: '-0.5px',
};

const subtitleStyle = {
  margin: '6px 0 0',
  color: C.muted,
  fontSize: 15,
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  maxWidth: 640,
};

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 8 };

const labelStyle = { fontSize: 13, fontWeight: 600, color: C.text };

const inputStyle = {
  padding: '10px 14px',
  borderRadius: 8,
  border: `1.5px solid ${C.border}`,
  background: C.surface,
  color: C.text,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const platformBtnBase = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '10px 16px',
  borderRadius: 10,
  cursor: 'pointer',
  minWidth: 70,
  transition: 'all 0.15s',
};

const btnPrimaryStyle = {
  padding: '8px 16px',
  background: C.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnPrimaryLargeStyle = {
  ...btnPrimaryStyle,
  padding: '14px 28px',
  fontSize: 15,
  borderRadius: 10,
  background: `linear-gradient(135deg, ${C.accent}, #7c3aed)`,
  boxShadow: `0 4px 20px rgba(139,92,246,0.35)`,
};

const btnSecondaryStyle = {
  padding: '8px 16px',
  background: 'transparent',
  color: C.muted,
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const settingsBtnStyle = {
  ...btnSecondaryStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

const warningBoxStyle = {
  padding: '12px 16px',
  background: 'rgba(251,191,36,0.08)',
  border: `1px solid rgba(251,191,36,0.2)`,
  borderRadius: 8,
  fontSize: 13,
  color: '#fde68a',
  lineHeight: 1.5,
};

const processingStyle = {
  maxWidth: 500,
  margin: '60px auto',
};

const spinnerStyle = {
  width: 48,
  height: 48,
  border: `4px solid ${C.border}`,
  borderTop: `4px solid ${C.accent}`,
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
  margin: '0 auto',
};

const errorBoxStyle = {
  padding: '20px 24px',
  background: 'rgba(248,113,113,0.08)',
  border: `1px solid rgba(248,113,113,0.25)`,
  borderRadius: 12,
  maxWidth: 500,
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
  gap: 20,
};

const cardStyle = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
};

const playOverlayStyle = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.35)',
};

const playBtnStyle = {
  width: 52, height: 52,
  background: 'rgba(255,255,255,0.9)',
  borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 18, color: '#000',
  paddingLeft: 4,
  boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
};

const durationBadgeStyle = {
  padding: '2px 8px',
  background: C.accentLight,
  color: C.accent,
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const themeBadgeStyle = {
  display: 'inline-block',
  padding: '3px 10px',
  background: 'rgba(139,92,246,0.15)',
  border: `1px solid rgba(139,92,246,0.3)`,
  color: '#a78bfa',
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
};

const downloadBtnStyle = {
  display: 'block',
  marginTop: 12,
  padding: '9px 0',
  background: `linear-gradient(135deg, ${C.accent}, #7c3aed)`,
  color: '#fff',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  textAlign: 'center',
  textDecoration: 'none',
};

const overlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100,
  backdropFilter: 'blur(4px)',
};

const modalStyle = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: 24,
  width: '90%',
  maxWidth: 440,
  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
};
