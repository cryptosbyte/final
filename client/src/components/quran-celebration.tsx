import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

// ─── Confetti helpers (reused pattern from confetti-overlay) ──────────────────
const KHATM_EMOJIS = ["🌙", "⭐", "✨", "🌟", "💫", "☪️", "🎊"];
const DAY_EMOJIS   = ["📖", "🌙", "✨", "⭐", "💫"];
const PARTICLES    = 40;

interface Particle { id: number; emoji: string; tx: number; ty: number; rot: number; delay: number; size: number; }

function makeParticles(emojis: string[]): Particle[] {
  return Array.from({ length: PARTICLES }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 150 + Math.random() * 300;
    return {
      id: i, emoji: emojis[Math.floor(Math.random() * emojis.length)],
      tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist + 180,
      rot: (Math.random() - 0.5) * 720, delay: Math.random() * 100,
      size: 16 + Math.random() * 16,
    };
  });
}

function ParticleBurst({ emojis }: { emojis: string[] }) {
  const [particles] = useState(() => makeParticles(emojis));
  return (
    <div className="fixed inset-0 pointer-events-none z-[110] overflow-hidden" aria-hidden>
      {particles.map(p => (
        <span
          key={p.id}
          className="absolute top-1/2 left-1/2 select-none"
          style={{
            fontSize: `${p.size}px`,
            animation: `rt-confetti-fly 2000ms cubic-bezier(.18,.7,.4,1) ${p.delay}ms forwards`,
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
  );
}

// ─── Day-done toast ───────────────────────────────────────────────────────────
interface DayDoneDetail { dayNum: number; date: string; }
const AUTO_DAY_MS = 3500;

function DayDoneToast({ active, onDismiss }: { active: DayDoneDetail & { key: number } | null; onDismiss: () => void }) {
  return createPortal(
    <AnimatePresence>
      {active && (
        <>
          <ParticleBurst emojis={DAY_EMOJIS} />
          <motion.div
            key={active.key}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[105] flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-card border border-border/60 shadow-2xl"
            initial={{ y: 60, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
          >
            <span className="text-2xl select-none" aria-hidden>📖</span>
            <div>
              <p className="text-sm font-bold text-foreground">Day {active.dayNum} complete!</p>
              <p className="text-xs text-muted-foreground">Keep going — Mashallah! 🌙</p>
            </div>
            <button
              onClick={onDismiss}
              className="ml-2 w-6 h-6 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <motion.div
              aria-hidden
              className="absolute left-0 bottom-0 h-0.5 rounded-full"
              style={{ background: "hsl(199 89% 48%)" }}
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: AUTO_DAY_MS / 1000, ease: "linear" }}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ─── Khatm complete overlay ───────────────────────────────────────────────────
const AUTO_KHATM_MS = 8000;

function KhatmOverlay({ active, onDismiss }: { active: { key: number } | null; onDismiss: () => void }) {
  return createPortal(
    <AnimatePresence>
      {active && (
        <motion.div
          key={active.key}
          className="fixed inset-0 z-[100] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <ParticleBurst emojis={KHATM_EMOJIS} />

          {/* Backdrop */}
          <motion.button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="absolute inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Card */}
          <motion.div
            className="relative z-10 w-[min(92vw,480px)] rounded-3xl bg-card shadow-2xl border border-border/60 px-8 py-10 text-center overflow-hidden"
            initial={{ scale: 0.5, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 20 }}
          >
            {/* Glow */}
            <motion.div
              aria-hidden
              className="absolute left-1/2 top-20 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
              style={{
                background: "radial-gradient(circle, hsl(199 89% 48% / 0.45) 0%, hsl(260 80% 60% / 0.15) 50%, transparent 75%)",
                filter: "blur(10px)",
              }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: [0.5, 1.2, 1], opacity: [0, 0.8, 0.6] }}
              transition={{ duration: 1.6, ease: "easeOut" }}
            />

            <button
              type="button"
              onClick={onDismiss}
              className="absolute top-3 right-3 w-9 h-9 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors z-20"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Moon + stars */}
            <motion.div
              className="relative text-[100px] leading-none mb-2 select-none"
              style={{ filter: "drop-shadow(0 12px 28px hsl(199 89% 48% / 0.6))" }}
              initial={{ scale: 0.3, rotate: -30, y: 30 }}
              animate={{ scale: [0.3, 1.3, 1], rotate: [-30, 10, 0], y: [30, -10, 0] }}
              transition={{ duration: 1.1, ease: [0.18, 0.7, 0.4, 1] }}
              aria-hidden
            >
              <motion.span
                className="inline-block"
                animate={{ y: [0, -7, 0], scale: [1, 1.05, 1] }}
                transition={{ duration: 2, ease: "easeInOut", repeat: Infinity, delay: 1.2 }}
              >
                🌙
              </motion.span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="space-y-2"
            >
              <div className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "hsl(199 89% 48%)" }}>
                Khatm Al-Quran
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                Alhamdulillah — you completed the Quran! ✨
              </h2>
              <p className="text-sm text-muted-foreground pt-1">
                You have completed a full reading of the Quran. May Allah accept it from you.
              </p>
              <div className="flex justify-center gap-2 mt-4 flex-wrap">
                {["🌙","⭐","📖","✨","☪️"].map((e, i) => (
                  <motion.span
                    key={i}
                    className="text-2xl select-none"
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.6 + i * 0.08, type: "spring", stiffness: 300 }}
                    aria-hidden
                  >
                    {e}
                  </motion.span>
                ))}
              </div>
            </motion.div>

            <motion.div
              aria-hidden
              className="absolute left-0 bottom-0 h-1"
              style={{ background: "linear-gradient(90deg, hsl(199 89% 48%), hsl(260 80% 60%))" }}
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: AUTO_KHATM_MS / 1000, ease: "linear" }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ─── Root mount (put in Layout) ───────────────────────────────────────────────
export function QuranCelebrationOverlay() {
  const [dayDone, setDayDone] = useState<(DayDoneDetail & { key: number }) | null>(null);
  const [khatmDone, setKhatmDone] = useState<{ key: number } | null>(null);

  useEffect(() => {
    const onDay = (e: Event) => {
      const ce = e as CustomEvent<DayDoneDetail>;
      setDayDone({ ...ce.detail, key: Date.now() });
    };
    const onKhatm = () => {
      setKhatmDone({ key: Date.now() });
    };
    window.addEventListener("quran-day-complete", onDay);
    window.addEventListener("quran-khatm-complete", onKhatm);
    return () => {
      window.removeEventListener("quran-day-complete", onDay);
      window.removeEventListener("quran-khatm-complete", onKhatm);
    };
  }, []);

  // Auto-dismiss day toast
  useEffect(() => {
    if (!dayDone) return;
    const t = window.setTimeout(() => setDayDone(null), AUTO_DAY_MS + 500);
    return () => window.clearTimeout(t);
  }, [dayDone]);

  // Auto-dismiss khatm
  useEffect(() => {
    if (!khatmDone) return;
    const t = window.setTimeout(() => setKhatmDone(null), AUTO_KHATM_MS + 500);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setKhatmDone(null); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [khatmDone]);

  if (typeof document === "undefined") return null;

  return (
    <>
      <DayDoneToast active={dayDone} onDismiss={() => setDayDone(null)} />
      <KhatmOverlay active={khatmDone} onDismiss={() => setKhatmDone(null)} />
    </>
  );
}
