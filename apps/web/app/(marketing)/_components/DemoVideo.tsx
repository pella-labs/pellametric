"use client";

import { useRef, useState } from "react";
import "./demo-video.css";

export function DemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  return (
    <section className="mk-demo-section" aria-label="Watch the demo">
      <div className="mk-section-header">
        <span className="mk-mono mk-xs">00 / See Bematist in 30 seconds</span>
      </div>
      <div className="mk-demo-wrap">
        <div className="mk-demo-frame">
          <video
            ref={videoRef}
            className="mk-demo-video"
            src="/demo.mp4"
            poster="/demo-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Bematist product demo"
          />
          <div className="mk-demo-controls">
            <button
              type="button"
              onClick={togglePlay}
              className="mk-demo-btn"
              aria-label={playing ? "Pause video" : "Play video"}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              className="mk-demo-btn"
              aria-label={muted ? "Unmute video" : "Mute video"}
            >
              {muted ? <MutedIcon /> : <UnmutedIcon />}
              <span className="mk-demo-btn-label">{muted ? "Unmute" : "Mute"}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63Zm2.5 0c0 .94-.2 1.82-.54 2.64l1.52 1.52A8.96 8.96 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71ZM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73L16.25 17c-.65.49-1.39.88-2.25 1.11v2.06c1.41-.29 2.71-.95 3.76-1.89l2.22 2.22L21 19.73 12 10.73 4.27 3ZM12 4 9.91 6.09 12 8.18V4Z" />
    </svg>
  );
}

function UnmutedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02ZM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77Z" />
    </svg>
  );
}
