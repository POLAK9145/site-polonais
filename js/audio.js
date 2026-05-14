// Polish text-to-speech using the Web Speech API.
// Picks the best available pl-PL voice and falls back gracefully.

let cachedVoice = null;
let voicesReady = false;

function pickPolishVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices || voices.length === 0) return null;
  const exact = voices.find(v => v.lang && v.lang.toLowerCase() === 'pl-pl');
  if (exact) return exact;
  const startsPl = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pl'));
  if (startsPl) return startsPl;
  return null;
}

export function initAudio() {
  if (!('speechSynthesis' in window)) return;
  cachedVoice = pickPolishVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = pickPolishVoice();
    voicesReady = true;
  };
  voicesReady = !!cachedVoice;
}

export function hasPolishVoice() {
  if (!('speechSynthesis' in window)) return false;
  if (cachedVoice) return true;
  cachedVoice = pickPolishVoice();
  return !!cachedVoice;
}

export function speak(text, opts = {}) {
  if (!text || !('speechSynthesis' in window)) return;
  try { window.speechSynthesis.cancel(); } catch {}
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'pl-PL';
  utter.rate = opts.rate ?? 0.95;
  utter.pitch = opts.pitch ?? 1;
  if (!cachedVoice) cachedVoice = pickPolishVoice();
  if (cachedVoice) utter.voice = cachedVoice;
  window.speechSynthesis.speak(utter);
}

const speakerSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
</svg>`;

// Returns an HTML string for an audio button that triggers speech on click.
// The data attribute holds the Polish text to speak.
export function audioButton(text, label = 'Écouter') {
  const safe = String(text).replace(/"/g, '&quot;');
  return `<button class="audio-btn" data-speak="${safe}" aria-label="${label} : ${safe}" title="${label}">${speakerSvg}</button>`;
}

// Global delegated click handler for [data-speak].
export function bindAudioDelegation(root = document) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-speak]');
    if (!btn) return;
    e.preventDefault();
    const text = btn.getAttribute('data-speak');
    speak(text);
  });
}
