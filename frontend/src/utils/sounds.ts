let _ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function tone(freq: number, startOffset: number, duration: number, peak: number, type: OscillatorType = 'sine'): void {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.setValueAtTime(peak, t0 + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration);
}

// Three-note ascending chime played when Delamain first connects / greets
export function playConnectChime(): void {
  tone(523.25, 0.00, 0.20, 0.20); // C5
  tone(659.25, 0.17, 0.20, 0.20); // E5
  tone(783.99, 0.34, 0.32, 0.16); // G5
}

// Short single-note ping before each Delamain response — subtle acknowledgment
export function playResponsePing(): void {
  tone(659.25, 0.0, 0.08, 0.10); // E5, barely there
}

// Low two-note chord played when SP link drops
export function playDisconnectTone(): void {
  tone(440.00, 0.0, 0.25, 0.15); // A4
  tone(329.63, 0.1, 0.30, 0.12); // E4 — descending feel
}
