// The sound of Delamain's garden, made in the browser (no recordings): wind that follows the real wind,
// rain when it rains, birds by day (not in winter, fewer in the cold), crickets on warm nights, and the
// pond lapping now and then. Off until the viewer turns it on; quiet by design.
import { useEffect, useRef } from 'react';

type Sky = { isDay: boolean; rain: number; snow: number; temp: number; wind: number; season: string };

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {          // pinkish noise: softer than white
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
  }
  return buf;
}

export function useGardenSound(on: boolean, sky: Sky) {
  const skyRef = useRef(sky);
  skyRef.current = sky;
  useEffect(() => {
    if (!on) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const noise = noiseBuffer(ctx);
    const loop = (filterType: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      return { f, g };
    };
    const wind = loop('lowpass', 400);
    const rain = loop('highpass', 2500);
    const chirp = (base: number) => {                 // one bird: a quick falling or rising whistle
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'sine';
      const up = Math.random() > 0.5, n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const s = t + k * 0.13;
        o.frequency.setValueAtTime(base * (up ? 0.85 : 1.15), s);
        o.frequency.exponentialRampToValueAtTime(base * (up ? 1.2 : 0.8), s + 0.09);
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.05, s + 0.02); g.gain.linearRampToValueAtTime(0, s + 0.1);
      }
      o.connect(g); g.connect(master); o.start(t); o.stop(t + n * 0.13 + 0.1);
    };
    const cricket = () => {                           // a cricket: short bursts of a high, buzzing note
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'square'; o.frequency.value = 4400 + Math.random() * 300;
      for (let k = 0; k < 4; k++) { g.gain.setValueAtTime(0.008, t + k * 0.05); g.gain.setValueAtTime(0, t + k * 0.05 + 0.025); }
      g.gain.setValueAtTime(0, t);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
    };
    const lap = () => {                               // a little water against the jetty
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      src.buffer = noise; f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 0.6);
      src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random()); src.stop(t + 0.7);
    };
    const tick = () => {
      const s = skyRef.current, now = ctx.currentTime;
      const w = Math.min(1, s.wind / 40);
      wind.g.gain.setTargetAtTime(0.05 + w * 0.35, now, 1.5);
      wind.f.frequency.setTargetAtTime(250 + w * 700 + Math.random() * 120, now, 1);
      rain.g.gain.setTargetAtTime(s.rain > 0 ? Math.min(0.35, 0.1 + s.rain * 0.08) : 0, now, 1);
      const birds = s.isDay && s.season !== 'winter' && s.rain <= 0 && s.snow <= 0 && s.temp > 2;
      if (birds && Math.random() < (s.season === 'spring' ? 0.5 : 0.25)) chirp(2200 + Math.random() * 1800);
      if (!s.isDay && s.temp > 14 && s.season !== 'winter' && Math.random() < 0.7) cricket();
      if (Math.random() < 0.08 && s.snow <= 0) lap();
    };
    const id = window.setInterval(tick, 700);
    tick();
    return () => { window.clearInterval(id); ctx.close().catch(() => {}); };
  }, [on]);
}
