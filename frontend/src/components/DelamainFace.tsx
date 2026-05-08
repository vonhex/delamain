import React, { useState, useEffect, useRef } from 'react';

interface DelamainFaceProps {
  isTalking: boolean;
  mood?: 'idle' | 'sad' | 'freakout' | 'laughing';
}

const ANIMATIONS = {
  talking: ['/delamain_talking_1.mp4', '/delamain_talking_2.mp4'],
  blinking: [
    '/delamain_blink_1.mp4', '/delamain_blink_2.mp4', '/delamain_blink_3.mp4',
    '/delamain_blink_4.mp4', '/delamain_blink_5.mp4', '/delamain_blink_6.mp4',
    '/delamain_blink_7.mp4', '/delamain_blink_8.mp4', '/delamain_blink_9.mp4',
    '/delamain_blink_10.mp4'
  ],
  turning: [
    '/delamain_turn_1.mp4', '/delamain_turn_2.mp4', '/delamain_turn_3.mp4',
    '/delamain_turn_4.mp4', '/delamain_turn_5.mp4'
  ],
  random: [
    '/delamain_random_1.mp4', '/delamain_random_2.mp4', '/delamain_random_3.mp4',
    '/delamain_random_4.mp4', '/delamain_random_5.mp4', '/delamain_random_6.mp4',
    '/delamain_random_7.mp4', '/delamain_random_8.mp4', '/delamain_random_9.mp4',
    '/delamain_random_10.mp4'
  ]
};

const DelamainFace: React.FC<DelamainFaceProps> = ({ isTalking, mood = 'idle' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentVideo, setCurrentVideo] = useState(ANIMATIONS.blinking[0]);
  const lastVideoRef = useRef<string | null>(null);

  useEffect(() => {
    if (isTalking) {
      const pool = ANIMATIONS.talking;
      let nextVideo = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) {
        while (nextVideo === lastVideoRef.current) {
          nextVideo = pool[Math.floor(Math.random() * pool.length)];
        }
      }
      lastVideoRef.current = nextVideo;
      setCurrentVideo(nextVideo);
    } else {
      // Weighted Random Selection: 70% blinking, 15% turning, 15% random
      const rand = Math.random();
      let pool: string[] = ANIMATIONS.blinking;
      
      if (rand < 0.7) {
        pool = ANIMATIONS.blinking;
      } else if (rand < 0.85) {
        pool = ANIMATIONS.turning;
      } else {
        pool = ANIMATIONS.random;
      }
      
      let nextVideo = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) {
        // Prevent immediate repeat
        while (nextVideo === lastVideoRef.current) {
          nextVideo = pool[Math.floor(Math.random() * pool.length)];
        }
      }
      lastVideoRef.current = nextVideo;
      setCurrentVideo(nextVideo);
    }
  }, [isTalking, mood]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(e => console.error("Video play failed:", e));
    }
  }, [currentVideo]);


  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <div className={`relative transition-all duration-500 ${isTalking ? 'scale-105' : 'scale-100'}`}>
        
        {/* Synthetic Talking Glow / Pulse */}
        <div className={`absolute -inset-6 rounded-full blur-3xl transition-all duration-300 bg-cyber-blue/40 ${isTalking ? 'opacity-100 animate-pulse' : 'opacity-10 scale-90'}`} />
        
        {/* Main Avatar Container */}
        <div className={`relative w-64 h-64 md:w-80 md:h-80 rounded-full border-4 overflow-hidden transition-all duration-500 ${isTalking ? 'border-cyber-blue shadow-[0_0_40px_rgba(0,243,255,0.7)]' : 'border-cyber-gray shadow-none'}`}>
          
          <video 
            ref={videoRef}
            src={currentVideo}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Talking "Glitch" Overlay */}
          <div className={`absolute inset-0 bg-cyber-blue/10 pointer-events-none transition-opacity duration-300 ${isTalking ? 'opacity-100' : 'opacity-0'}`}>
            <div className="absolute inset-0 animate-[glitch_0.2s_infinite] opacity-30 bg-cyber-blue mix-blend-overlay" />
          </div>

          {/* Holographic Scanlines */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,118,0.06))] bg-[length:100%_2px,3px_100%] z-10 opacity-40" />
        </div>
        
        {/* Active Data Stream / Scanner */}
        <div className={`absolute top-0 left-0 w-full h-1 bg-cyber-blue/60 shadow-[0_0_15px_rgba(0,243,255,0.8)] z-20 transition-opacity duration-300 ${isTalking ? 'opacity-100 animate-[scan_2s_linear_infinite]' : 'opacity-20 animate-[scan_6s_linear_infinite]'}`} />
      </div>
      
      {/* Audio Reactive Waveform Placeholder */}
      <div className="mt-10 flex gap-1.5 h-12 items-end">
        {[...Array(20)].map((_, i) => (
          <div 
            key={i} 
            className={`w-1 bg-cyber-blue transition-all duration-150 rounded-t-sm ${isTalking ? 'opacity-100 shadow-[0_0_10px_rgba(0,243,255,0.6)]' : 'opacity-10'}`}
            style={{ 
              height: isTalking ? `${10 + Math.random() * 90}%` : '10%',
              transitionDelay: `${i * 30}ms`
            }}
          />
        ))}
      </div>
      
      <style>{`
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
