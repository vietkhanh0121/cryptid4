let audioContext = null;
let musicTimer = null;
let currentMusicTrack = null;
let musicStep = 0;
const SFX_VOLUME = 9.2;
const MUSIC_VOLUME = 33.6;
const PITCH_VARIATION = 0.035;

function jitter(value, amount = PITCH_VARIATION) {
  return value * (1 + (Math.random() * 2 - 1) * amount);
}

function clampGain(value) {
  return Math.max(0.0001, Math.min(value, 0.95));
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext = new AudioContext();
  return audioContext;
}

function resolveVolume(volume) {
  if (volume === true) return 1;
  if (volume === false || volume == null) return 0;
  return Math.max(0, Math.min(Number(volume), 1.5));
}

function tone(ctx, {
  frequency,
  duration = 0.08,
  type = "square",
  gain = 0.035,
  delay = 0,
  attack = 0.008,
  pitch = 1,
  endFrequency = null,
  filter = null,
  masterVolume = 1,
}) {
  const now = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  const destination = filter ? ctx.createBiquadFilter() : volume;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(jitter(frequency * pitch), now);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, jitter(endFrequency * pitch, 0.015)), now + duration);
  }
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(clampGain(gain * masterVolume), now + attack);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(destination);
  if (filter) {
    destination.type = filter.type ?? "lowpass";
    destination.frequency.setValueAtTime(filter.frequency ?? 1400, now);
    destination.Q.setValueAtTime(filter.q ?? 1.2, now);
    destination.connect(volume);
  }
  volume.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
}

function noise(ctx, { duration = 0.08, gain = 0.025, delay = 0, filterType = "bandpass", frequency = 900, q = 1.8, masterVolume = 1 }) {
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index++) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const volume = ctx.createGain();
  const now = ctx.currentTime + delay;
  filter.type = filterType;
  filter.frequency.setValueAtTime(jitter(frequency, 0.08), now);
  filter.Q.setValueAtTime(q, now);
  volume.gain.setValueAtTime(clampGain(gain * masterVolume), now);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(volume);
  volume.connect(ctx.destination);
  source.start(now);
}

function chord(ctx, notes, options = {}) {
  notes.forEach((frequency, index) => {
    tone(ctx, {
      ...options,
      frequency,
      delay: (options.delay ?? 0) + index * (options.spread ?? 0),
      gain: (options.gain ?? 0.02) * (options.falloff ? Math.max(0.55, 1 - index * 0.12) : 1),
    });
  });
}

export function playSoundEffect(effect, volume = 1) {
  const masterVolume = resolveVolume(volume);
  if (masterVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const pitch = 1 + (Math.random() * 2 - 1) * 0.025;

  const patterns = {
    click: () => {
      noise(ctx, { duration: 0.026, gain: 0.011 * SFX_VOLUME, frequency: 1850, q: 3.2, masterVolume });
      tone(ctx, { frequency: 980, endFrequency: 620, duration: 0.04, gain: 0.017 * SFX_VOLUME, pitch, filter: { frequency: 2400, q: 1.8 }, masterVolume });
      tone(ctx, { frequency: 255, duration: 0.055, gain: 0.012 * SFX_VOLUME, delay: 0.006, pitch, type: "triangle", masterVolume });
      tone(ctx, { frequency: 1320, duration: 0.018, gain: 0.009 * SFX_VOLUME, delay: 0.028, pitch, masterVolume });
    },
    select: () => {
      tone(ctx, { frequency: 260, endFrequency: 360, duration: 0.08, gain: 0.018 * SFX_VOLUME, type: "triangle", pitch, masterVolume });
      tone(ctx, { frequency: 640, duration: 0.055, gain: 0.014 * SFX_VOLUME, delay: 0.045, pitch, masterVolume });
      noise(ctx, { duration: 0.035, gain: 0.004 * SFX_VOLUME, frequency: 1600, delay: 0.02, masterVolume });
    },
    toggle: () => {
      tone(ctx, { frequency: 520, endFrequency: 760, duration: 0.065, gain: 0.015 * SFX_VOLUME, pitch, masterVolume });
      tone(ctx, { frequency: 260, duration: 0.045, gain: 0.007 * SFX_VOLUME, delay: 0.02, type: "triangle", pitch, masterVolume });
    },
    mark: () => {
      noise(ctx, { duration: 0.08, gain: 0.013 * SFX_VOLUME, frequency: 620, q: 2.4, masterVolume });
      tone(ctx, { frequency: 180, endFrequency: 110, duration: 0.12, gain: 0.022 * SFX_VOLUME, delay: 0.018, type: "triangle", pitch, masterVolume });
      tone(ctx, { frequency: 360, duration: 0.045, gain: 0.01 * SFX_VOLUME, delay: 0.075, pitch, masterVolume });
    },
    markX: () => {
      noise(ctx, { duration: 0.095, gain: 0.014 * SFX_VOLUME, frequency: 520, q: 2.6, masterVolume });
      tone(ctx, { frequency: 240, endFrequency: 112, duration: 0.17, gain: 0.024 * SFX_VOLUME, delay: 0.01, type: "sawtooth", pitch, masterVolume });
      tone(ctx, { frequency: 96, duration: 0.12, gain: 0.014 * SFX_VOLUME, delay: 0.07, type: "triangle", masterVolume });
      tone(ctx, { frequency: 180, duration: 0.045, gain: 0.009 * SFX_VOLUME, delay: 0.14, type: "square", masterVolume });
    },
    markO: () => {
      noise(ctx, { duration: 0.045, gain: 0.005 * SFX_VOLUME, frequency: 1700, q: 2.1, masterVolume });
      tone(ctx, { frequency: 392, endFrequency: 523, duration: 0.12, gain: 0.021 * SFX_VOLUME, type: "triangle", pitch, masterVolume });
      tone(ctx, { frequency: 659, duration: 0.11, gain: 0.017 * SFX_VOLUME, delay: 0.07, type: "triangle", pitch, masterVolume });
      tone(ctx, { frequency: 988, duration: 0.11, gain: 0.013 * SFX_VOLUME, delay: 0.15, type: "sine", masterVolume });
    },
    question: () => {
      tone(ctx, { frequency: 420, endFrequency: 760, duration: 0.105, gain: 0.016 * SFX_VOLUME, type: "triangle", pitch, masterVolume });
      tone(ctx, { frequency: 980, duration: 0.06, gain: 0.011 * SFX_VOLUME, delay: 0.085, pitch, masterVolume });
    },
    ask: () => {
      chord(ctx, [294, 370, 554], { duration: 0.08, gain: 0.011 * SFX_VOLUME, spread: 0.035, type: "square", pitch, falloff: true, masterVolume });
      noise(ctx, { duration: 0.055, gain: 0.006 * SFX_VOLUME, delay: 0.045, frequency: 1250, q: 2.2, masterVolume });
    },
    guess: () => {
      tone(ctx, { frequency: 146, endFrequency: 98, duration: 0.22, gain: 0.026 * SFX_VOLUME, type: "sawtooth", pitch: 1, masterVolume });
      tone(ctx, { frequency: 293, duration: 0.1, gain: 0.014 * SFX_VOLUME, delay: 0.09, type: "triangle", masterVolume });
      noise(ctx, { duration: 0.14, gain: 0.008 * SFX_VOLUME, delay: 0.02, frequency: 420, q: 1.4, masterVolume });
    },
    graveGuess: () => {
      noise(ctx, { duration: 0.18, gain: 0.007 * SFX_VOLUME, frequency: 620, q: 1.5, masterVolume });
      tone(ctx, { frequency: 196, endFrequency: 165, duration: 0.32, gain: 0.018 * SFX_VOLUME, type: "triangle", masterVolume });
      tone(ctx, { frequency: 294, duration: 0.28, gain: 0.014 * SFX_VOLUME, type: "triangle", delay: 0.05, masterVolume });
      chord(ctx, [392, 494, 587], { duration: 0.14, gain: 0.01 * SFX_VOLUME, delay: 0.18, spread: 0.055, type: "square", falloff: true, masterVolume });
      tone(ctx, { frequency: 784, endFrequency: 988, duration: 0.22, gain: 0.011 * SFX_VOLUME, type: "triangle", delay: 0.38, masterVolume });
      tone(ctx, { frequency: 523, duration: 0.18, gain: 0.008 * SFX_VOLUME, type: "sine", delay: 0.58, masterVolume });
    },
    start: () => {
      chord(ctx, [392, 523, 659], { duration: 0.085, gain: 0.012 * SFX_VOLUME, spread: 0.045, type: "triangle", masterVolume });
      tone(ctx, { frequency: 784, duration: 0.12, gain: 0.014 * SFX_VOLUME, delay: 0.18, masterVolume });
    },
    success: () => {
      chord(ctx, [392, 523, 659, 784], { duration: 0.12, gain: 0.015 * SFX_VOLUME, spread: 0.07, type: "triangle", falloff: true, masterVolume });
      tone(ctx, { frequency: 1046, duration: 0.18, gain: 0.013 * SFX_VOLUME, delay: 0.29, masterVolume });
    },
    win: () => {
      noise(ctx, { duration: 0.08, gain: 0.004 * SFX_VOLUME, frequency: 2200, q: 2.4, masterVolume });
      chord(ctx, [392, 523, 659], { duration: 0.16, gain: 0.012 * SFX_VOLUME, spread: 0.065, type: "triangle", masterVolume });
      chord(ctx, [523, 659, 784], { duration: 0.18, gain: 0.013 * SFX_VOLUME, delay: 0.24, spread: 0.065, type: "triangle", masterVolume });
      chord(ctx, [659, 784, 1046], { duration: 0.28, gain: 0.014 * SFX_VOLUME, delay: 0.52, spread: 0.075, type: "triangle", falloff: true, masterVolume });
      tone(ctx, { frequency: 1318, duration: 0.22, gain: 0.01 * SFX_VOLUME, delay: 0.9, type: "sine", masterVolume });
      tone(ctx, { frequency: 1046, duration: 0.32, gain: 0.008 * SFX_VOLUME, delay: 1.08, type: "triangle", masterVolume });
      chord(ctx, [784, 988, 1174], { duration: 0.28, gain: 0.008 * SFX_VOLUME, delay: 1.42, spread: 0.06, type: "triangle", falloff: true, masterVolume });
      tone(ctx, { frequency: 1568, duration: 0.34, gain: 0.006 * SFX_VOLUME, delay: 1.82, type: "sine", masterVolume });
    },
    lose: () => {
      noise(ctx, { duration: 0.18, gain: 0.006 * SFX_VOLUME, frequency: 420, q: 1.4, masterVolume });
      tone(ctx, { frequency: 392, endFrequency: 294, duration: 0.32, gain: 0.014 * SFX_VOLUME, type: "triangle", masterVolume });
      tone(ctx, { frequency: 247, endFrequency: 196, duration: 0.42, gain: 0.016 * SFX_VOLUME, delay: 0.18, type: "triangle", masterVolume });
      chord(ctx, [220, 185, 147], { duration: 0.36, gain: 0.012 * SFX_VOLUME, delay: 0.58, spread: 0.08, type: "sawtooth", falloff: true, masterVolume });
      tone(ctx, { frequency: 123, duration: 0.42, gain: 0.01 * SFX_VOLUME, delay: 1.02, type: "sine", masterVolume });
      tone(ctx, { frequency: 165, endFrequency: 110, duration: 0.48, gain: 0.008 * SFX_VOLUME, delay: 1.42, type: "triangle", masterVolume });
      tone(ctx, { frequency: 92, duration: 0.36, gain: 0.006 * SFX_VOLUME, delay: 1.88, type: "sine", masterVolume });
    },
    fail: () => {
      tone(ctx, { frequency: 320, endFrequency: 160, duration: 0.2, gain: 0.021 * SFX_VOLUME, type: "sawtooth", masterVolume });
      tone(ctx, { frequency: 120, duration: 0.18, gain: 0.018 * SFX_VOLUME, type: "triangle", delay: 0.08, masterVolume });
      noise(ctx, { duration: 0.11, gain: 0.007 * SFX_VOLUME, frequency: 300, delay: 0.05, masterVolume });
    },
    denied: () => {
      tone(ctx, { frequency: 155, duration: 0.045, gain: 0.015 * SFX_VOLUME, type: "sawtooth", masterVolume });
      tone(ctx, { frequency: 118, duration: 0.055, gain: 0.014 * SFX_VOLUME, type: "sawtooth", delay: 0.05, masterVolume });
      noise(ctx, { duration: 0.05, gain: 0.005 * SFX_VOLUME, frequency: 260, delay: 0.02, masterVolume });
    },
    asked: () => {
      chord(ctx, [440, 587, 880], { duration: 0.075, gain: 0.012 * SFX_VOLUME, spread: 0.055, type: "triangle", pitch, masterVolume });
      tone(ctx, { frequency: 1174, duration: 0.08, gain: 0.011 * SFX_VOLUME, delay: 0.16, pitch, masterVolume });
    },
  };

  (patterns[effect] ?? patterns.click)();
}

export function stopBackgroundMusic() {
  if (musicTimer) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
  currentMusicTrack = null;
  musicStep = 0;
}

export function startBackgroundMusic(track, enabled = true) {
  if (!enabled) {
    stopBackgroundMusic();
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  if (musicTimer && currentMusicTrack === track) return;

  stopBackgroundMusic();
  currentMusicTrack = track;

  const patterns = {
    lobby: {
      interval: 520,
      melody: [392, 494, 587, 494, 440, 523, 659, 523],
      bass: [98, 123, 147, 123],
      gain: 0.008 * MUSIC_VOLUME,
    },
    board: {
      interval: 430,
      melody: [196, 247, 294, 330, 294, 247, 220, 247],
      bass: [65, 82, 98, 82],
      gain: 0.009 * MUSIC_VOLUME,
    },
  };

  const pattern = patterns[track] ?? patterns.lobby;
  const playMusicStep = () => {
    const note = pattern.melody[musicStep % pattern.melody.length];
    const bass = pattern.bass[Math.floor(musicStep / 2) % pattern.bass.length];

    tone(ctx, { frequency: note, duration: 0.16, type: "triangle", gain: pattern.gain });
    if (musicStep % 2 === 0) {
      tone(ctx, { frequency: bass, duration: 0.32, type: "sine", gain: pattern.gain * 0.9 });
    }
    musicStep += 1;
  };

  playMusicStep();
  musicTimer = window.setInterval(playMusicStep, pattern.interval);
}
