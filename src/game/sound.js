let audioContext = null;
let musicTimer = null;
let currentMusicTrack = null;
let musicStep = 0;
const SFX_VOLUME = 7.2;
const MUSIC_VOLUME = 33.6;

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext = new AudioContext();
  return audioContext;
}

function tone(ctx, { frequency, duration = 0.08, type = "square", gain = 0.035, delay = 0 }) {
  const now = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(volume);
  volume.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
}

function noise(ctx, { duration = 0.08, gain = 0.025, delay = 0 }) {
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index++) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
  }

  const source = ctx.createBufferSource();
  const volume = ctx.createGain();
  const now = ctx.currentTime + delay;
  volume.gain.setValueAtTime(gain, now);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.buffer = buffer;
  source.connect(volume);
  volume.connect(ctx.destination);
  source.start(now);
}

export function playSoundEffect(effect, enabled = true) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const patterns = {
    click: () => tone(ctx, { frequency: 520, duration: 0.035, gain: 0.018 * SFX_VOLUME }),
    select: () => {
      tone(ctx, { frequency: 360, duration: 0.045, gain: 0.026 * SFX_VOLUME });
      tone(ctx, { frequency: 540, duration: 0.04, gain: 0.018 * SFX_VOLUME, delay: 0.035 });
    },
    toggle: () => tone(ctx, { frequency: 680, duration: 0.05, gain: 0.02 * SFX_VOLUME }),
    mark: () => {
      noise(ctx, { duration: 0.055, gain: 0.018 * SFX_VOLUME });
      tone(ctx, { frequency: 240, duration: 0.07, gain: 0.026 * SFX_VOLUME, delay: 0.025 });
    },
    question: () => {
      tone(ctx, { frequency: 460, duration: 0.05, gain: 0.02 * SFX_VOLUME });
      tone(ctx, { frequency: 690, duration: 0.06, gain: 0.022 * SFX_VOLUME, delay: 0.055 });
    },
    ask: () => {
      tone(ctx, { frequency: 330, duration: 0.05, gain: 0.02 * SFX_VOLUME });
      tone(ctx, { frequency: 495, duration: 0.06, gain: 0.022 * SFX_VOLUME, delay: 0.05 });
    },
    guess: () => {
      tone(ctx, { frequency: 220, duration: 0.07, gain: 0.026 * SFX_VOLUME });
      tone(ctx, { frequency: 330, duration: 0.08, gain: 0.024 * SFX_VOLUME, delay: 0.06 });
    },
    start: () => {
      tone(ctx, { frequency: 392, duration: 0.06, gain: 0.02 * SFX_VOLUME });
      tone(ctx, { frequency: 523, duration: 0.08, gain: 0.024 * SFX_VOLUME, delay: 0.06 });
    },
    success: () => {
      tone(ctx, { frequency: 392, duration: 0.08, gain: 0.026 * SFX_VOLUME });
      tone(ctx, { frequency: 523, duration: 0.09, gain: 0.026 * SFX_VOLUME, delay: 0.08 });
      tone(ctx, { frequency: 784, duration: 0.13, gain: 0.028 * SFX_VOLUME, delay: 0.17 });
    },
    fail: () => {
      tone(ctx, { frequency: 300, duration: 0.09, gain: 0.025 * SFX_VOLUME, type: "sawtooth" });
      tone(ctx, { frequency: 180, duration: 0.16, gain: 0.026 * SFX_VOLUME, type: "sawtooth", delay: 0.09 });
    },
    denied: () => {
      tone(ctx, { frequency: 150, duration: 0.04, gain: 0.02 * SFX_VOLUME, type: "sawtooth" });
      tone(ctx, { frequency: 120, duration: 0.06, gain: 0.018 * SFX_VOLUME, type: "sawtooth", delay: 0.05 });
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
