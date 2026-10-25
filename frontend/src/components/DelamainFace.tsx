import React, { useState, useEffect, useRef, useCallback } from 'react';

interface DelamainFaceProps {
  isTalking: boolean;
  mood?: 'idle' | 'angry';
  size?: 'normal' | 'large';
  // A lip-synced clip for the line being spoken. Like every clip it plays muted in an
  // off-page video; the sound is the line's audio, and audioTime() reports how far
  // into it playback is, so the clip starts at the same point.
  lineClip?: { url: string; audioTime: () => number } | null;
}

const COLOR = {
  cyan:   '#00F3FF',
  amber:  '#FFB700',
  orange: '#FF7700',
  red:    '#FF2020',
};

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const ANIMATIONS = {
  talking: ['/delamain_talking_1.mp4', '/delamain_talking_2.mp4'],
  blinking: [
    '/delamain_blink_1.mp4', '/delamain_blink_2.mp4', '/delamain_blink_3.mp4',
    '/delamain_blink_4.mp4', '/delamain_blink_5.mp4', '/delamain_blink_6.mp4',
    '/delamain_blink_7.mp4', '/delamain_blink_8.mp4', '/delamain_blink_9.mp4',
    '/delamain_blink_10.mp4',
  ],
  turning: [
    '/delamain_turn_1.mp4', '/delamain_turn_2.mp4', '/delamain_turn_3.mp4',
    '/delamain_turn_4.mp4', '/delamain_turn_5.mp4',
  ],
  random: [
    '/delamain_random_1.mp4', '/delamain_random_2.mp4', '/delamain_random_3.mp4',
    '/delamain_random_4.mp4', '/delamain_random_5.mp4', '/delamain_random_6.mp4',
    '/delamain_random_7.mp4', '/delamain_random_8.mp4', '/delamain_random_9.mp4',
    '/delamain_random_10.mp4',
  ],
  bored: [
    '/delamain_bored_1.mp4', '/delamain_bored_2.mp4', '/delamain_bored_3.mp4',
    '/delamain_bored_4.mp4', '/delamain_bored_5.mp4',
  ],
  rare: {
    reading: '/delamain_rare_reading.mp4',
    flip:    '/delamain_rare_flip.mp4',
    secret:  '/delamain_rare_secret.mp4',
  },
};

function pickFrom(pool: string[], last: string | null): string {
  if (pool.length === 1) return pool[0];
  let next = pool[Math.floor(Math.random() * pool.length)];
  while (next === last) next = pool[Math.floor(Math.random() * pool.length)];
  return next;
}

// idleMs = time since last user interaction (resets on each message)
// sessionMs = total session time (never resets, for secret rare only)
function pickIdleVideo(last: string | null, idleMs: number, sessionMs: number): string {
  const r = Math.random();

  // Secret rare — only after 45 min session regardless of interaction
  if (sessionMs > 45 * 60_000 && r < 0.008) return ANIMATIONS.rare.secret;

  const isBored     = idleMs > 30 * 60_000;
  const isDeepBored = idleMs > 60 * 60_000;

  if (isDeepBored) {
    if (r < 0.05) return ANIMATIONS.rare.reading;
    if (r < 0.55) return pickFrom(ANIMATIONS.bored, last);
    if (r < 0.90) return pickFrom(ANIMATIONS.blinking, last);
    if (r < 0.95) return pickFrom(ANIMATIONS.turning, last);
    return pickFrom(ANIMATIONS.random, last);
  }

  if (isBored) {
    if (r < 0.40) return pickFrom(ANIMATIONS.bored, last);
    if (r < 0.80) return pickFrom(ANIMATIONS.blinking, last);
    if (r < 0.90) return pickFrom(ANIMATIONS.turning, last);
    return pickFrom(ANIMATIONS.random, last);
  }

  if (r < 0.70) return pickFrom(ANIMATIONS.blinking, last);
  if (r < 0.85) return pickFrom(ANIMATIONS.turning, last);
  return pickFrom(ANIMATIONS.random, last);
}

// The clips play in <video> elements that are never added to the page, and are
// painted onto canvases inside the circle. Some Android WebViews (Fermata on
// Android Auto, for one) hand any on-page video to a native fullscreen player,
// which pulled Delamain out of his circle; an off-page video gives them nothing to grab.
// How far ahead of the audio a lip-synced clip is started, in seconds.
const SEEK_LEAD = 0.065;

// Keep a playing line clip on the audio clock. The clip's soundtrack plays from a
// separate audio element, which can start later than the clip (still loading) or drift.
// Small drift is eased out with the playback rate; a large gap is closed with a seek.
// Once the audio stops advancing (ended or paused), the clip is left to finish.
type LineSync = { video: HTMLVideoElement; clock: () => number; last: number; stalls: number };

function syncLine(s: LineSync): boolean {
  const v = s.video, t = s.clock();
  if (v.ended || v.paused) return false;
  if (t === s.last) {
    if (t === 0) { v.currentTime = 0; return true; }   // audio not started yet: hold the first frame
    if (++s.stalls > 30) { v.playbackRate = 1; return false; }
    return true;
  }
  s.last = t; s.stalls = 0;
  const drift = v.currentTime - t;
  if (Math.abs(drift) > 0.25) { v.currentTime = t + SEEK_LEAD; v.playbackRate = 1; }
  else if (Math.abs(drift) > 0.02) v.playbackRate = Math.min(1.15, Math.max(0.85, 1 - drift * 2));
  else v.playbackRate = 1;
  return true;
}

function makeOffscreenVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.disablePictureInPicture = true;
  v.preload = 'auto';
  return v;
}

// Draw the current video frame to fill the canvas, cropping like object-fit: cover.
function drawCover(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  if (video.readyState < 2 || !video.videoWidth) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, w, h);
}

function computeColor(idleMs: number): string {
  if (idleMs > 60 * 60_000) return COLOR.orange;
  if (idleMs > 30 * 60_000) return COLOR.amber;
  return COLOR.cyan;
}

const DelamainFace: React.FC<DelamainFaceProps> = ({ isTalking, mood = 'idle', size = 'normal', lineClip = null }) => {
  const [offscreen] = useState(() => [makeOffscreenVideo(), makeOffscreenVideo()] as const);
  const videoA = useRef<HTMLVideoElement | null>(offscreen[0]);
  const videoB = useRef<HTMLVideoElement | null>(offscreen[1]);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const activeSlot = useRef<'a' | 'b'>('a');
  const lastVideo = useRef<string | null>(null);
  const isTalkingRef = useRef(isTalking);
  const pendingFlip = useRef(false);
  const isFlipPlaying = useRef(false);  // true while flip anim is the active video
  const pendingLine = useRef<{ url: string; audioTime: () => number } | null>(null); // lip-synced clip waiting to play
  const lineActive = useRef(false);     // true from a line clip's request until it ends
  const angryUntilMs = useRef(0);       // wall-clock ms; hold red until this time
  const sessionStartMs = useRef(Date.now());
  const lastInteractionMs = useRef(Date.now()); // resets on each user message

  // Edge-tracking refs to detect transitions without triggering extra re-renders
  const prevTalking = useRef(isTalking);
  const prevMood = useRef(mood);

  const [showA, setShowA] = useState(true);        // which slot is stable-active
  const [fadingIn, setFadingIn] = useState<'a' | 'b' | null>(null); // slot currently fading in
  const [accentColor, setAccentColor] = useState(COLOR.cyan);

  useEffect(() => { isTalkingRef.current = isTalking; }, [isTalking]);

  // ── color helper ───────────────────────────────────────────────────────────
  const refreshColor = useCallback(() => {
    if (Date.now() < angryUntilMs.current) { setAccentColor(COLOR.red); return; }
    const idleMs = Date.now() - lastInteractionMs.current;
    setAccentColor(computeColor(idleMs));
  }, []);

  // ── pick next video ────────────────────────────────────────────────────────
  const lineAudioTime = useRef<(() => number) | null>(null); // set while the clip being loaded is a line clip
  const lineSync = useRef<LineSync | null>(null);             // the line clip now playing, kept on the audio clock

  const getNext = useCallback((): string => {
    lineAudioTime.current = null;
    if (pendingLine.current) {
      const clip = pendingLine.current;
      pendingLine.current = null;
      isFlipPlaying.current = false;
      lineAudioTime.current = clip.audioTime;
      return clip.url;
    }
    lineActive.current = false;

    // Flip takes priority unless talking needs to resume after flip finishes
    if (pendingFlip.current) {
      pendingFlip.current = false;
      isFlipPlaying.current = true;
      return ANIMATIONS.rare.flip;
    }
    isFlipPlaying.current = false;

    // While talking (and flip isn't pending), show talking animation
    if (isTalkingRef.current) return pickFrom(ANIMATIONS.talking, lastVideo.current);

    const idleMs    = Date.now() - lastInteractionMs.current;
    const sessionMs = Date.now() - sessionStartMs.current;
    return pickIdleVideo(lastVideo.current, idleMs, sessionMs);
  }, []);

  // ── advance: load next video into the inactive slot ────────────────────────
  const advance = useCallback(() => {
    refreshColor();
    const next = getNext();
    lastVideo.current = next;

    const incoming = activeSlot.current === 'a' ? videoB.current : videoA.current;
    if (!incoming) return;

    lineSync.current = null;
    incoming.playbackRate = 1;
    incoming.src = next;
    incoming.load();

    const audioTime = lineAudioTime.current;
    const onReady = () => {
      incoming.removeEventListener('canplay', onReady);
      // A line clip that took a moment to load joins the audio where it is now,
      // so the lips stay on the words instead of lagging behind them.
      // SEEK_LEAD covers the time the seek and start take, measured at about 65 ms.
      if (audioTime) {
        const offset = audioTime() + SEEK_LEAD;
        if (offset < (incoming.duration || Infinity)) incoming.currentTime = offset;
      }
      incoming.play().catch(() => {});
      if (audioTime) lineSync.current = { video: incoming, clock: audioTime, last: -1, stalls: 0 };
      const nextSlot = activeSlot.current === 'a' ? 'b' : 'a';
      activeSlot.current = nextSlot;
      setShowA(nextSlot === 'a');   // marks new stable-active (used after fade completes)
      setFadingIn(nextSlot);        // triggers fade-in animation on incoming slot
    };
    incoming.addEventListener('canplay', onReady);
  }, [getNext, refreshColor]);

  // ── off-page videos: advance when the active clip ends ─────────────────────
  useEffect(() => {
    const a = videoA.current!, b = videoB.current!;
    const endA = () => { if (activeSlot.current === 'a') advance(); };
    const endB = () => { if (activeSlot.current === 'b') advance(); };
    a.addEventListener('ended', endA);
    b.addEventListener('ended', endB);
    return () => { a.removeEventListener('ended', endA); b.removeEventListener('ended', endB); };
  }, [advance]);

  // ── paint both clips onto their canvases every frame ───────────────────────
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      if (canvasA.current) drawCover(canvasA.current, videoA.current!);
      if (canvasB.current) drawCover(canvasB.current, videoB.current!);
      if (lineSync.current && !syncLine(lineSync.current)) lineSync.current = null;
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Stop the off-page videos when the face unmounts.
  useEffect(() => () => {
    for (const v of [videoA.current, videoB.current]) {
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    }
  }, []);

  // ── boot: set first video ─────────────────────────────────────────────────
  useEffect(() => {
    const first = getNext();
    lastVideo.current = first;
    if (videoA.current) {
      videoA.current.src = first;
      videoA.current.load();
      videoA.current.play().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── line clip: cut straight to it ─────────────────────────────────────────
  // Declared before the talking effect: both fire when a line starts, and this one
  // must win so the talking effect does not load a generic loop over it.
  useEffect(() => {
    if (!lineClip) return;
    pendingLine.current = lineClip;
    lineActive.current = true;
    advance();
  }, [lineClip, advance]);

  // ── talking: advance ONLY when talking STARTS ──────────────────────────────
  // When talking ends, the current animation plays to completion; onEnded handles the rest.
  useEffect(() => {
    const justStarted = isTalking && !prevTalking.current;
    prevTalking.current = isTalking;
    if (justStarted) {
      lastInteractionMs.current = Date.now(); // user sent a message — reset bored clock
      if (!isFlipPlaying.current && !lineActive.current) advance();
    }
  }, [isTalking, advance]);

  // ── mood: advance only when becoming angry (not when resetting to idle) ────
  useEffect(() => {
    const justAngry = mood === 'angry' && prevMood.current !== 'angry';
    prevMood.current = mood;
    if (!justAngry) return;

    pendingFlip.current = true;
    angryUntilMs.current = Date.now() + 45_000;
    setAccentColor(COLOR.red);

    // Start the flip immediately if not talking; if talking, it will play when
    // the current talking animation ends and onEnded fires.
    if (!isTalkingRef.current) advance();
  }, [mood, advance]);

  // ── periodic color refresh for bored→orange and angry cooldown ────────────
  useEffect(() => {
    const id = setInterval(refreshColor, 30_000);
    return () => clearInterval(id);
  }, [refreshColor]);

  const canvasClass = 'absolute inset-0 w-full h-full';

  // Crossfade: outgoing stays fully opaque while incoming fades in on top.
  // States per slot:
  //   fading-in  → z=3, animation fadeIn (0→1)
  //   stable-active → z=2, opacity 1
  //   outgoing   → z=1, opacity 1  (holds until incoming is fully visible)
  //   inactive   → z=1, opacity 0
  const slotStyle = (slot: 'a' | 'b'): React.CSSProperties => {
    const isFadingIn = fadingIn === slot;
    const isActive   = showA === (slot === 'a') && !isFadingIn;
    const isOutgoing = showA !== (slot === 'a') && fadingIn === (slot === 'a' ? 'b' : 'a');
    if (isFadingIn)  return { zIndex: 3, opacity: 0, animation: 'videoFadeIn 250ms ease forwards' };
    if (isActive)    return { zIndex: 2, opacity: 1 };
    if (isOutgoing)  return { zIndex: 1, opacity: 1 };
    return               { zIndex: 1, opacity: 0 };
  };

  const ac = accentColor;

  return (
    <div className="relative flex flex-col items-center justify-center p-4 landscape:p-1">
      <div className={`relative transition-all duration-500 ${isTalking ? 'scale-105' : 'scale-100'}`}>

        <div
          className="absolute -inset-6 landscape:-inset-3 rounded-full blur-3xl transition-all duration-700"
          style={{
            background: hexAlpha(ac, 0.4),
            opacity: isTalking ? 1 : 0.1,
            transform: isTalking ? 'scale(1)' : 'scale(0.9)',
          }}
        />

        <div
          className={`relative rounded-full border-4 overflow-hidden transition-all duration-700 ${size === 'large' ? 'w-80 h-80 md:w-96 md:h-96 landscape:w-56 landscape:h-56' : 'w-72 h-72 md:w-80 md:h-80 landscape:w-44 landscape:h-44'}`}
          style={{
            borderColor: ac,
            boxShadow: isTalking ? `0 0 40px ${hexAlpha(ac, 0.7)}` : 'none',
          }}
        >
          <canvas
            ref={canvasA}
            className={canvasClass}
            style={slotStyle('a')}
            onAnimationEnd={() => { if (fadingIn === 'a') setFadingIn(null); }}
          />
          <canvas
            ref={canvasB}
            className={canvasClass}
            style={slotStyle('b')}
            onAnimationEnd={() => { if (fadingIn === 'b') setFadingIn(null); }}
          />

          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-10"
            style={{ background: hexAlpha(ac, 0.04), opacity: isTalking ? 1 : 0 }}
          >
            <div className="absolute inset-0 animate-[glitch_0.2s_infinite] opacity-[0.08] mix-blend-soft-light"
              style={{ background: ac }} />
          </div>

          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,118,0.06))] bg-size-[100%_2px,3px_100%] z-20 opacity-40" />
        </div>

        <div
          className="absolute top-0 left-0 w-full h-1 z-30 transition-opacity duration-300"
          style={{
            background: hexAlpha(ac, 0.6),
            boxShadow: `0 0 15px ${hexAlpha(ac, 0.8)}`,
            opacity: isTalking ? 1 : 0.2,
            animation: isTalking ? 'scan 2s linear infinite' : 'scan 6s linear infinite',
          }}
        />
      </div>

      <div className="mt-10 landscape:mt-2 flex gap-1.5 landscape:gap-1 h-12 landscape:h-6 items-end">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="w-1 transition-all duration-150 rounded-t-sm"
            style={{
              background: ac,
              opacity: isTalking ? 1 : 0.1,
              boxShadow: isTalking ? `0 0 10px ${hexAlpha(ac, 0.6)}` : 'none',
              height: isTalking ? `${10 + Math.random() * 90}%` : '10%',
              transitionDelay: `${i * 30}ms`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes videoFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes glitch {
          0% { transform: translate(0); }
          20% { transform: translate(-2px, 2px); }
          40% { transform: translate(-2px, -2px); }
          60% { transform: translate(2px, 2px); }
          80% { transform: translate(2px, -2px); }
          100% { transform: translate(0); }
        }
      `}</style>
    </div>
  );
};

export default DelamainFace;
