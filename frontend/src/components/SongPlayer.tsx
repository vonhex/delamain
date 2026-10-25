import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface Song {
  video: string;        // YouTube video id
  start: number;        // seconds
  end: number | null;   // null: play to the end
  label: string;
}

const ORIGIN = 'https://www.youtube-nocookie.com';

// Delamain's comeback to an insult, now and then: a song played from YouTube in a small
// card. It plays until it ends or the X is pressed. playsinline keeps phones and Android
// Auto WebViews from taking it fullscreen.
export function SongPlayer({ song, onDone }: { song: Song; onDone: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // The embed reports its state by postMessage once told we are listening; 0 is "ended".
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.info?.playerState === 0 || (data?.event === 'onStateChange' && data?.info === 0)) onDone();
      } catch { /* not a player message */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onDone]);

  const listen = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), ORIGIN);

  const src = `${ORIGIN}/embed/${song.video}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`
    + `&origin=${encodeURIComponent(location.origin)}&start=${Math.floor(song.start)}`
    + (song.end ? `&end=${Math.ceil(song.end)}` : '');

  return (
    <div className="absolute top-4 right-4 z-40 w-64 rounded-lg overflow-hidden border border-red-500/50 bg-cyber-dark shadow-[0_0_24px_rgba(255,32,32,0.35)]">
      <div className="flex items-center justify-between gap-2 pl-3 pr-1 py-1 text-[10px] font-mono text-red-400 uppercase tracking-wider">
        <span className="truncate">{song.label}</span>
        <button onClick={onDone} aria-label="Stop the song"
          className="shrink-0 p-2 rounded text-gray-300 hover:text-white hover:bg-red-500/30 active:bg-red-500/40">
          <X size={20} />
        </button>
      </div>
      <iframe
        ref={frame}
        src={src}
        title={song.label}
        onLoad={listen}
        className="w-full aspect-video"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
