import { useEffect } from 'react';
import { X } from 'lucide-react';

export interface Song {
  video: string;   // YouTube video id
  start: number;   // seconds
  end: number;
  label: string;
}

// Delamain's comeback to an insult, now and then: a part of a song, played from YouTube
// in a small card that removes itself when the part is over. playsinline keeps phones
// and Android Auto WebViews from taking it fullscreen.
export function SongPlayer({ song, onDone }: { song: Song; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, (song.end - song.start) * 1000 + 1500);
    return () => clearTimeout(t);
  }, [song, onDone]);

  const src = `https://www.youtube-nocookie.com/embed/${song.video}?autoplay=1&playsinline=1&controls=0`
    + `&start=${Math.floor(song.start)}&end=${Math.ceil(song.end)}&rel=0&modestbranding=1`;

  return (
    <div className="absolute top-4 right-4 z-40 w-60 rounded-lg overflow-hidden border border-red-500/50 bg-cyber-dark shadow-[0_0_24px_rgba(255,32,32,0.35)]">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-red-400 uppercase tracking-wider">
        <span className="truncate">{song.label}</span>
        <button onClick={onDone} className="text-gray-500 hover:text-white" aria-label="Stop the song"><X size={12} /></button>
      </div>
      <iframe
        src={src}
        title={song.label}
        className="w-full aspect-video"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
