import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export interface ProductivityRecordDetail {
  rating: number;
  prevMax: number;
}

const EVENT_NAME = "revision-tracker-productivity-record";
const AUTO_CLOSE_MS = 4500;

export function notifyProductivityRecord(detail: ProductivityRecordDetail) {
  window.dispatchEvent(new CustomEvent<ProductivityRecordDetail>(EVENT_NAME, { detail }));
}

interface ActiveRecord {
  rating: number;
  prevMax: number;
  key: number;
}

export function AchievementOverlay() {
  const [active, setActive] = useState<ActiveRecord | null>(null);

  useEffect(() => {
    const onRecord = (e: Event) => {
      const ce = e as CustomEvent<ProductivityRecordDetail>;
      if (!ce.detail) return;
      setActive({
        rating: ce.detail.rating,
        prevMax: ce.detail.prevMax,
        key: Date.now(),
      });
    };
    window.addEventListener(EVENT_NAME, onRecord);
    return () => window.removeEventListener(EVENT_NAME, onRecord);
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(null), AUTO_CLOSE_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {active && (
        <motion.div
          key={active.key}
          className="fixed inset-0 z-[100] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          data-testid="achievement-overlay"
        >
          {/* Shadow backdrop */}
          <motion.button
            type="button"
            aria-label="Dismiss achievement"
            onClick={() => setActive(null)}
            className="absolute inset-0 bg-black/65 backdrop-blur-md cursor-pointer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Card */}
          <motion.div
            className="relative z-10 w-[min(92vw,460px)] rounded-3xl bg-card shadow-2xl border border-border/60 px-8 py-10 text-center overflow-hidden"
            initial={{ scale: 0.6, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            {/* Glow ring behind flame */}
            <motion.div
              aria-hidden
              className="absolute left-1/2 top-[88px] -translate-x-1/2 w-56 h-56 rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, hsl(var(--apple-orange) / 0.55) 0%, hsl(var(--apple-orange) / 0.10) 45%, transparent 70%)",
                filter: "blur(8px)",
              }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{
                scale: [0.6, 1.15, 1],
                opacity: [0, 0.9, 0.7],
              }}
              transition={{ duration: 1.4, ease: "easeOut" }}
            />

            {/* Close button */}
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Close"
              data-testid="button-close-achievement"
              className="absolute top-3 right-3 w-9 h-9 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors z-20"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Flame */}
            <motion.div
              className="relative text-[112px] leading-none mb-3 select-none"
              style={{
                filter: "drop-shadow(0 12px 24px hsl(var(--apple-orange) / 0.55))",
              }}
              initial={{ scale: 0.4, rotate: -25, y: 20 }}
              animate={{
                scale: [0.4, 1.25, 1],
                rotate: [-25, 8, 0],
                y: [20, -8, 0],
              }}
              transition={{
                duration: 1.0,
                ease: [0.18, 0.7, 0.4, 1],
              }}
              aria-hidden
            >
              <motion.span
                className="inline-block"
                animate={{
                  y: [0, -6, 0],
                  scale: [1, 1.04, 1],
                  rotate: [0, -3, 3, 0],
                }}
                transition={{
                  duration: 1.6,
                  ease: "easeInOut",
                  repeat: Infinity,
                  delay: 1.0,
                }}
              >
                🔥
              </motion.span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.4 }}
              className="space-y-1.5"
            >
              <div
                className="text-[11px] font-bold tracking-[0.20em] uppercase"
                style={{ color: "hsl(var(--apple-orange))" }}
              >
                New record
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                Well done — you broke your productivity record!
              </h2>
              <p className="text-sm text-muted-foreground pt-1">
                {active.prevMax > 0 ? (
                  <>
                    You hit <span className="font-bold text-foreground">{active.rating}/5</span> — beating your previous best of {active.prevMax}/5.
                  </>
                ) : (
                  <>
                    First time logging a productivity rating — <span className="font-bold text-foreground">{active.rating}/5</span>. Keep it up!
                  </>
                )}
              </p>
            </motion.div>

            {/* Auto-close progress bar */}
            <motion.div
              aria-hidden
              className="absolute left-0 bottom-0 h-1"
              style={{ background: "hsl(var(--apple-orange))" }}
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: AUTO_CLOSE_MS / 1000, ease: "linear" }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
