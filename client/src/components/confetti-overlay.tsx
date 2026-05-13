import { useEffect, useRef, useState } from "react";

const EMOJIS = ["🎉", "✨", "🎊", "⭐", "🌟", "💫", "🥳"];
const PARTICLES_PER_BURST = 36;
const MAX_BURSTS = 3;
const BURST_DURATION_MS = 1800;

interface Particle {
  id: number;
  emoji: string;
  tx: number;
  ty: number;
  rot: number;
  delay: number;
  size: number;
}

interface Burst {
  id: number;
  particles: Particle[];
}

export function ConfettiOverlay({ trigger }: { trigger: number }) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  // Initialize to the current trigger so we never fire on (re)mount —
  // only on subsequent increments. Without this, when DayEntryModal
  // unmounts/remounts (date toggling null ↔ set), a stale non-zero
  // trigger from a previous open would auto-fire confetti on every
  // day click.
  const lastTriggerRef = useRef<number>(trigger);

  useEffect(() => {
    if (trigger === lastTriggerRef.current) return;
    lastTriggerRef.current = trigger;

    const particles: Particle[] = Array.from({ length: PARTICLES_PER_BURST }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 180 + Math.random() * 280;
      return {
        id: i,
        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance + 200,
        rot: (Math.random() - 0.5) * 720,
        delay: Math.random() * 80,
        size: 18 + Math.random() * 14,
      };
    });

    setBursts(prev => [...prev, { id: trigger, particles }].slice(-MAX_BURSTS));
    const t = window.setTimeout(() => {
      setBursts(prev => prev.filter(b => b.id !== trigger));
    }, BURST_DURATION_MS + 200);
    return () => window.clearTimeout(t);
  }, [trigger]);

  if (bursts.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[80] overflow-hidden" aria-hidden>
      {bursts.map(b => (
        <div key={b.id} className="absolute inset-0">
          {b.particles.map(p => (
            <span
              key={p.id}
              className="absolute top-1/2 left-1/2 select-none"
              style={{
                fontSize: `${p.size}px`,
                animation: `rt-confetti-fly ${BURST_DURATION_MS}ms cubic-bezier(.18,.7,.4,1) ${p.delay}ms forwards`,
                ["--rt-tx" as never]: `${p.tx}px`,
                ["--rt-ty" as never]: `${p.ty}px`,
                ["--rt-rot" as never]: `${p.rot}deg`,
                willChange: "transform, opacity",
              }}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
