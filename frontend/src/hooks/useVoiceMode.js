import { useCallback, useEffect, useRef, useState } from 'react';
import { splitSentences, toSpeechText } from '../utils/speechText';
import { framesToWav } from '../utils/wav';

const getAudioContextCtor = () =>
  typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext || null;

const isSupported = () =>
  !!(getAudioContextCtor() && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia);

// Voice-activity detection tuning (frames are ~85 ms at 48 kHz with a 4096 buffer).
const VAD = {
  minThreshold: 0.012, // absolute RMS floor for "speech"
  noiseMultiplier: 3, // speech must be this much louder than the ambient noise floor
  startFrames: 2, // consecutive loud frames before speech counts as started
  prerollFrames: 4, // audio kept from just before speech started
  endSilenceMs: 1200, // silence after speech that ends the utterance
  maxUtteranceMs: 30000,
};

/**
 * Imperative voice engine:
 *   mic capture + VAD -> POST /stt -> sendMessage -> sentence queue -> POST /tts playback -> listen again.
 * Kept outside React state so async callbacks never see stale values.
 * `ui` holds React setters; `getSend` returns the latest sendMessage.
 */
function createVoiceEngine({ apiUrl, getSend, ui }) {
  let active = false;
  let muted = false;
  let phase = 'idle';

  // Mic graph, held for the whole voice session.
  let audioCtx = null;
  let stream = null;
  let processor = null;
  let capturing = false;
  let noiseFloor = 0;
  let speechStarted = false;
  let loudFrames = 0;
  let silentMs = 0;
  let utteranceMs = 0;
  let preroll = [];
  let frames = [];
  let lastLevelAt = 0;

  let generation = 0; // bumps on interrupt/close; stale callbacks compare against it
  let buffer = '';
  let streamDone = false;
  let queue = []; // [{ text, req: Promise<objectUrl|null> }]
  let playing = false;
  let stopPlayback = null; // resolves/stops the currently playing sentence
  const controllers = new Set();
  const urls = new Set();

  const setPhase = (p) => { phase = p; ui.setPhase(p); };

  const revoke = (url) => {
    if (url && urls.delete(url)) URL.revokeObjectURL(url);
  };

  function resetCapture() {
    speechStarted = false;
    loudFrames = 0;
    silentMs = 0;
    utteranceMs = 0;
    preroll = [];
    frames = [];
  }

  function stopCapture() {
    capturing = false;
    resetCapture();
    ui.setLevel(0);
  }

  async function startMic() {
    const Ctor = getAudioContextCtor();
    // Create the context synchronously inside the click handler so it starts "running".
    audioCtx = new Ctor();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = e && e.name;
      ui.setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone permission denied. Allow mic access for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not start the microphone.'
      );
      releaseMic();
      return false;
    }
    if (!active) { releaseMic(); return false; }
    if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});

    const source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const sink = audioCtx.createGain();
    sink.gain.value = 0; // keep the graph pulling audio without playing the mic back
    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioCtx.destination);
    processor.onaudioprocess = onAudio;
    return true;
  }

  function releaseMic() {
    capturing = false;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch { /* ignore */ } }
    processor = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (audioCtx) audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  function onAudio(e) {
    const data = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const frameMs = (data.length / e.inputBuffer.sampleRate) * 1000;

    if (!capturing) return;

    const now = performance.now();
    if (now - lastLevelAt > 60) {
      lastLevelAt = now;
      ui.setLevel(Math.min(1, rms * 12));
    }

    // Track ambient noise while nobody is talking.
    if (!speechStarted) noiseFloor = noiseFloor ? noiseFloor * 0.95 + rms * 0.05 : rms;
    const threshold = Math.max(VAD.minThreshold, noiseFloor * VAD.noiseMultiplier);
    const frame = new Float32Array(data);

    if (!speechStarted) {
      preroll.push(frame);
      if (preroll.length > VAD.prerollFrames) preroll.shift();
      loudFrames = rms > threshold ? loudFrames + 1 : 0;
      if (loudFrames >= VAD.startFrames) {
        speechStarted = true;
        frames = preroll.slice();
        preroll = [];
        ui.setUserCaption('');
        ui.setError(null);
      }
      return;
    }

    frames.push(frame);
    utteranceMs += frameMs;
    silentMs = rms < threshold * 0.8 ? silentMs + frameMs : 0;
    if (silentMs >= VAD.endSilenceMs || utteranceMs >= VAD.maxUtteranceMs) {
      const captured = frames;
      const rate = e.inputBuffer.sampleRate;
      stopCapture();
      transcribe(captured, rate);
    }
  }

  function listen() {
    if (!active) return;
    setPhase('listening');
    resetCapture();
    capturing = !muted && !!processor;
    if (!capturing) ui.setLevel(0);
  }

  async function transcribe(captured, sampleRate) {
    const gen = ++generation;
    setPhase('transcribing');
    const controller = new AbortController();
    controllers.add(controller);
    let text = '';
    try {
      const res = await fetch(`${apiUrl}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: framesToWav(captured, sampleRate),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Speech recognition failed (${res.status})`);
      text = (data.text || '').trim();
    } catch (err) {
      if (gen !== generation || !active) return;
      if (err.name !== 'AbortError') ui.setError(err.message || 'Speech recognition failed.');
      listen();
      return;
    } finally {
      controllers.delete(controller);
    }
    if (gen !== generation || !active) return;
    if (!text) {
      ui.setUserCaption('');
      ui.setError("Didn't catch that — try again.");
      listen();
      return;
    }
    ui.setError(null);
    ui.setUserCaption(text);
    handleUtterance(text, gen);
  }

  function stopSpeech() {
    queue = [];
    buffer = '';
    playing = false;
    if (stopPlayback) stopPlayback();
    stopPlayback = null;
    controllers.forEach(c => c.abort());
    controllers.clear();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function handleUtterance(text, gen) {
    stopSpeech();
    streamDone = false;
    setPhase('thinking');
    ui.setAssistantCaption('');

    const enqueueAll = (sentences) => {
      sentences.forEach(s => {
        const speech = toSpeechText(s);
        if (speech) queue.push({ text: speech, req: null });
      });
      prefetch();
      pump();
    };

    getSend()(text, {
      voice: true,
      onToken: (chunk) => {
        if (gen !== generation) return;
        buffer += chunk;
        const { sentences, rest } = splitSentences(buffer);
        buffer = rest;
        enqueueAll(sentences);
      },
      onDone: () => {
        if (gen !== generation) return;
        const { sentences } = splitSentences(buffer, true);
        buffer = '';
        streamDone = true;
        enqueueAll(sentences);
        maybeFinish();
      },
      onError: (msg) => {
        if (gen !== generation) return;
        ui.setError(msg || 'Something went wrong');
        streamDone = true;
        queue = [];
        maybeFinish();
      },
    });
  }

  function fetchTts(text) {
    const controller = new AbortController();
    controllers.add(controller);
    return fetch(`${apiUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob || !blob.size) return null;
        const url = URL.createObjectURL(blob);
        urls.add(url);
        return url;
      })
      .catch(() => null)
      .finally(() => controllers.delete(controller));
  }

  function prefetch() {
    if (queue[0] && !queue[0].req) queue[0].req = fetchTts(queue[0].text);
  }

  function playUrl(url) {
    return new Promise(resolve => {
      const audio = new Audio(url);
      const finish = (ok) => { audio.onended = audio.onerror = null; resolve(ok); };
      stopPlayback = () => { audio.pause(); audio.removeAttribute('src'); finish(true); };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }

  function speakFallback(text) {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
    return new Promise(resolve => {
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      const voice = synth.getVoices().find(v => v.lang === 'en-US') ||
        synth.getVoices().find(v => v.lang?.startsWith('en'));
      if (voice) u.voice = voice;
      // Some browsers occasionally never fire onend; don't hang the loop.
      let safety = null;
      const finish = () => { clearTimeout(safety); resolve(); };
      safety = setTimeout(finish, Math.max(5000, text.length * 120));
      stopPlayback = () => { synth.cancel(); finish(); };
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
    });
  }

  async function pump() {
    if (playing || !active) return;
    const item = queue.shift();
    if (!item) { maybeFinish(); return; }
    const gen = generation;
    playing = true;
    if (!item.req) item.req = fetchTts(item.text);
    prefetch(); // fetch the next sentence while this one plays

    const url = await item.req;
    if (gen !== generation || !active) { revoke(url); return; }
    setPhase('speaking');
    ui.setAssistantCaption(item.text);

    const ok = url ? await playUrl(url) : false;
    revoke(url);
    if (gen !== generation || !active) return;
    if (!ok) await speakFallback(item.text);
    if (gen !== generation || !active) return;

    stopPlayback = null;
    playing = false;
    pump();
  }

  function maybeFinish() {
    if (!active || !streamDone || playing || queue.length) return;
    if (phase === 'thinking' || phase === 'speaking') listen();
  }

  return {
    async open() {
      if (active) return;
      active = true;
      muted = false;
      noiseFloor = 0;
      ui.setMuted(false);
      ui.setUserCaption('');
      ui.setAssistantCaption('');
      ui.setError(null);
      setPhase('idle');
      if (await startMic()) listen();
    },
    close() {
      active = false;
      generation++;
      stopCapture();
      stopSpeech();
      releaseMic();
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
      setPhase('idle');
    },
    // Tap on the orb: barge in while transcribing/thinking/speaking, or retry the mic.
    interrupt() {
      if (!active) return;
      if (phase === 'transcribing' || phase === 'thinking' || phase === 'speaking') {
        generation++;
        stopSpeech();
        streamDone = false;
        ui.setAssistantCaption('');
        ui.setUserCaption('');
        listen();
      } else if (!processor) {
        ui.setError(null);
        startMic().then(ok => ok && listen());
      }
    },
    setMuted(value) {
      muted = value;
      ui.setMuted(value);
      if (!active) return;
      if (value) stopCapture();
      else if (phase === 'listening') listen();
    },
    isMuted: () => muted,
  };
}

export default function useVoiceMode({ sendMessage, apiUrl = '' }) {
  const [supported] = useState(isSupported);
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [level, setLevel] = useState(0);
  const [userCaption, setUserCaption] = useState('');
  const [assistantCaption, setAssistantCaption] = useState('');
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);

  const sendRef = useRef(sendMessage);
  useEffect(() => { sendRef.current = sendMessage; }, [sendMessage]);

  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = createVoiceEngine({
      apiUrl,
      getSend: () => sendRef.current,
      ui: { setPhase, setLevel, setUserCaption, setAssistantCaption, setError, setMuted },
    });
  }

  useEffect(() => () => engineRef.current.close(), []);

  const open = useCallback(() => {
    if (!supported) return;
    setIsOpen(true);
    engineRef.current.open();
  }, [supported]);

  const close = useCallback(() => {
    engineRef.current.close();
    setIsOpen(false);
  }, []);

  const interrupt = useCallback(() => engineRef.current.interrupt(), []);
  const toggleMute = useCallback(() => {
    const engine = engineRef.current;
    engine.setMuted(!engine.isMuted());
  }, []);

  return {
    supported, isOpen, phase, level, userCaption, assistantCaption, error, muted,
    open, close, interrupt, toggleMute,
  };
}
