import { useState, useEffect, useMemo, useRef } from "react";
import {
  motion,
  AnimatePresence,
  animate,
  useMotionValue,
} from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { parseISO, format, differenceInCalendarDays } from "date-fns";
import type { RevisionData, Subject } from "@/hooks/use-revision-data";
import {
  estimateDayHours,
  estimateSubjectHours,
  formatHours,
} from "@/lib/activity-hours";

// The recap covers the exam season: April, May, June 2026.
const RECAP_YEAR = 2026;
const RECAP_MONTHS = [3, 4, 5]; // Apr, May, Jun (0-indexed)

const SUBJECT_META: { id: Subject; name: string; var: string }[] = [
  { id: "biology", name: "Biology", var: "--biology" },
  { id: "chemistry", name: "Chemistry", var: "--chemistry" },
  { id: "maths", name: "Maths", var: "--maths" },
];

const SLIDE_DURATION_MS = 5200;

function inRecapWindow(dateKey: string): boolean {
  const d = parseISO(dateKey);
  return d.getFullYear() === RECAP_YEAR && RECAP_MONTHS.includes(d.getMonth());
}

interface RecapMetrics {
  totalHours: number;
  activeDays: number;
  longestStreak: number;
  pastPapers: number;
  ankiHours: number;
  topics: number;
  subjectHours: { id: Subject; name: string; var: string; hours: number }[];
  topSubject: { name: string; var: string; hours: number } | null;
  biggestDay: { date: string; hours: number } | null;
  avgPerActiveDay: number;
  waterBottles: number;
}

function computeMetrics(data: RevisionData): RecapMetrics {
  const keys = Object.keys(data)
    .filter(inRecapWindow)
    .sort();

  let totalHours = 0;
  let pastPapers = 0;
  let ankiHours = 0;
  let waterBottles = 0;
  const topicSet = new Set<string>();
  const subjectHourMap: Record<Subject, number> = {
    biology: 0,
    chemistry: 0,
    maths: 0,
  };

  const activeKeys: string[] = [];
  let biggestDay: { date: string; hours: number } | null = null;

  for (const key of keys) {
    const entry = data[key];
    const dayHours = estimateDayHours(entry);
    totalHours += dayHours;
    waterBottles += entry?.waterBottles ?? 0;

    if (dayHours > 0) {
      activeKeys.push(key);
      if (!biggestDay || dayHours > biggestDay.hours) {
        biggestDay = { date: key, hours: dayHours };
      }
    }

    for (const { id } of SUBJECT_META) {
      const s = entry?.subjects?.[id];
      if (!s) continue;
      subjectHourMap[id] += estimateSubjectHours(s);
      pastPapers += s.examPaperRecords?.length ?? 0;
      for (const a of s.ankiSessions ?? []) {
        if (Number.isFinite(a.hours)) ankiHours += Math.max(0, a.hours);
      }
      for (const m of s.moduleContent ?? []) topicSet.add(`${id}:${m}`);
    }
  }

  // Longest streak of consecutive active days within the window.
  let longestStreak = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const key of activeKeys) {
    const d = parseISO(key);
    if (prev && differenceInCalendarDays(d, prev) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longestStreak) longestStreak = run;
    prev = d;
  }

  const subjectHours = SUBJECT_META.map((m) => ({
    id: m.id,
    name: m.name,
    var: m.var,
    hours: subjectHourMap[m.id],
  }));

  const topSubject =
    subjectHours.filter((s) => s.hours > 0).sort((a, b) => b.hours - a.hours)[0] ??
    null;

  return {
    totalHours,
    activeDays: activeKeys.length,
    longestStreak,
    pastPapers,
    ankiHours,
    topics: topicSet.size,
    subjectHours,
    topSubject: topSubject
      ? { name: topSubject.name, var: topSubject.var, hours: topSubject.hours }
      : null,
    biggestDay,
    avgPerActiveDay: activeKeys.length > 0 ? totalHours / activeKeys.length : 0,
    waterBottles,
  };
}

function CountUp({
  value,
  duration = 1.5,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
}) {
  const mv = useMotionValue(0);
  const [text, setText] = useState(decimals ? (0).toFixed(decimals) : "0");

  useEffect(() => {
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) =>
        setText(
          decimals
            ? v.toFixed(decimals)
            : Math.round(v).toLocaleString("en-GB"),
        ),
    });
    return () => controls.stop();
  }, [value, duration, decimals, mv]);

  return (
    <span>
      {text}
      {suffix}
    </span>
  );
}

interface Slide {
  id: string;
  gradient: string;
  accent: string;
  content: React.ReactNode;
}

function buildSlides(m: RecapMetrics): Slide[] {
  const slides: Slide[] = [];

  slides.push({
    id: "intro",
    gradient: "linear-gradient(160deg, #1d1147 0%, #4c1d95 55%, #7c3aed 100%)",
    accent: "#c4b5fd",
    content: (
      <div className="text-center">
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-sm font-bold uppercase tracking-[0.4em] text-white/70"
        >
          Exam Season
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25, type: "spring", stiffness: 200, damping: 16 }}
          className="mt-3 text-7xl md:text-8xl font-black tracking-tight text-white"
        >
          WRAPPED
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-5 text-lg font-semibold text-white/80"
        >
          April → June 2026
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="mt-12 text-xs uppercase tracking-widest text-white/50"
        >
          Tap to begin →
        </motion.p>
      </div>
    ),
  });

  slides.push({
    id: "hours",
    gradient: "linear-gradient(160deg, #0f172a 0%, #1e3a8a 50%, #2563eb 100%)",
    accent: "#93c5fd",
    content: (
      <div className="text-center">
        <p className="text-lg font-semibold text-white/80">You put in</p>
        <div className="mt-2 text-8xl md:text-9xl font-black text-white leading-none">
          <CountUp value={Math.round(m.totalHours)} />
        </div>
        <p className="mt-3 text-2xl font-bold text-white/90">hours of revision</p>
        <p className="mt-6 text-sm text-white/60">
          across April, May & June. That's roughly{" "}
          {Math.round(m.totalHours / 24)} full days of pure focus.
        </p>
      </div>
    ),
  });

  slides.push({
    id: "days",
    gradient: "linear-gradient(160deg, #042f2e 0%, #047857 55%, #10b981 100%)",
    accent: "#6ee7b7",
    content: (
      <div className="text-center">
        <p className="text-lg font-semibold text-white/80">You showed up on</p>
        <div className="mt-2 text-8xl md:text-9xl font-black text-white leading-none">
          <CountUp value={m.activeDays} />
        </div>
        <p className="mt-3 text-2xl font-bold text-white/90">different days</p>
        <p className="mt-6 text-sm text-white/60">
          averaging {formatHours(m.avgPerActiveDay)} on every day you studied.
        </p>
      </div>
    ),
  });

  if (m.longestStreak > 1) {
    slides.push({
      id: "streak",
      gradient: "linear-gradient(160deg, #431407 0%, #c2410c 55%, #f97316 100%)",
      accent: "#fdba74",
      content: (
        <div className="text-center">
          <div className="text-6xl">🔥</div>
          <div className="mt-3 text-8xl md:text-9xl font-black text-white leading-none">
            <CountUp value={m.longestStreak} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white/90">day streak</p>
          <p className="mt-6 text-sm text-white/60">
            Your longest unbroken run of revision. Relentless.
          </p>
        </div>
      ),
    });
  }

  if (m.subjectHours.some((s) => s.hours > 0)) {
    const maxHours = Math.max(...m.subjectHours.map((s) => s.hours), 1);
    slides.push({
      id: "subjects",
      gradient: "linear-gradient(160deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)",
      accent: "#a5b4fc",
      content: (
        <div className="w-full max-w-sm">
          <p className="text-center text-lg font-semibold text-white/80">
            Where your hours went
          </p>
          <div className="mt-8 space-y-5">
            {m.subjectHours.map((s, i) => (
              <div key={s.id}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-base font-bold text-white">{s.name}</span>
                  <span className="text-sm font-semibold text-white/70">
                    {formatHours(s.hours)}
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-white/15 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.hours / maxHours) * 100}%` }}
                    transition={{ delay: 0.3 + i * 0.18, duration: 0.9, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: `hsl(var(${s.var}))` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {m.topSubject && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              className="mt-8 text-center text-sm text-white/70"
            >
              Your #1 was{" "}
              <span
                className="font-black"
                style={{ color: `hsl(var(${m.topSubject.var}))` }}
              >
                {m.topSubject.name}
              </span>
            </motion.p>
          )}
        </div>
      ),
    });
  }

  if (m.pastPapers > 0) {
    slides.push({
      id: "papers",
      gradient: "linear-gradient(160deg, #4a044e 0%, #a21caf 55%, #ec4899 100%)",
      accent: "#f9a8d4",
      content: (
        <div className="text-center">
          <div className="text-6xl">📝</div>
          <div className="mt-3 text-8xl md:text-9xl font-black text-white leading-none">
            <CountUp value={m.pastPapers} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white/90">past papers</p>
          <p className="mt-6 text-sm text-white/60">
            Logged and worked through. Every one made you sharper.
          </p>
        </div>
      ),
    });
  }

  if (m.ankiHours > 0) {
    slides.push({
      id: "anki",
      gradient: "linear-gradient(160deg, #0c4a6e 0%, #0e7490 55%, #06b6d4 100%)",
      accent: "#67e8f9",
      content: (
        <div className="text-center">
          <div className="text-6xl">🃏</div>
          <div className="mt-3 text-8xl md:text-9xl font-black text-white leading-none">
            <CountUp value={m.ankiHours} decimals={m.ankiHours % 1 === 0 ? 0 : 1} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white/90">hours on flashcards</p>
          <p className="mt-6 text-sm text-white/60">
            Spaced repetition, one card at a time.
          </p>
        </div>
      ),
    });
  }

  if (m.topics > 0) {
    slides.push({
      id: "topics",
      gradient: "linear-gradient(160deg, #422006 0%, #a16207 55%, #eab308 100%)",
      accent: "#fde047",
      content: (
        <div className="text-center">
          <div className="text-6xl">📚</div>
          <div className="mt-3 text-8xl md:text-9xl font-black text-white leading-none">
            <CountUp value={m.topics} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white/90">topics revised</p>
          <p className="mt-6 text-sm text-white/60">
            Across Biology, Chemistry and Maths. You covered the ground.
          </p>
        </div>
      ),
    });
  }

  if (m.biggestDay && m.biggestDay.hours > 0) {
    slides.push({
      id: "biggest",
      gradient: "linear-gradient(160deg, #450a0a 0%, #b91c1c 55%, #ef4444 100%)",
      accent: "#fca5a5",
      content: (
        <div className="text-center">
          <p className="text-lg font-semibold text-white/80">Your biggest grind</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {format(parseISO(m.biggestDay.date), "EEEE d MMMM")}
          </p>
          <div className="mt-4 text-8xl md:text-9xl font-black text-white leading-none">
            <CountUp
              value={m.biggestDay.hours}
              decimals={m.biggestDay.hours % 1 === 0 ? 0 : 1}
            />
          </div>
          <p className="mt-3 text-2xl font-bold text-white/90">hours in one day</p>
          <p className="mt-6 text-sm text-white/60">Absolute lock-in. 💪</p>
        </div>
      ),
    });
  }

  slides.push({
    id: "outro",
    gradient: "linear-gradient(160deg, #2e1065 0%, #6d28d9 50%, #db2777 100%)",
    accent: "#f5d0fe",
    content: (
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 12 }}
          className="text-7xl"
        >
          🎉
        </motion.div>
        <h2 className="mt-5 text-4xl md:text-5xl font-black text-white leading-tight">
          The exams are over.
        </h2>
        <p className="mt-4 text-lg text-white/80">
          {Math.round(m.totalHours)} hours of proof that you showed up.
        </p>
        <p className="mt-1 text-lg text-white/80">Now go rest — you earned it.</p>
      </div>
    ),
  });

  return slides;
}

export function ExamRecap({
  data,
  open,
  onClose,
}: {
  data: RevisionData;
  open: boolean;
  onClose: () => void;
}) {
  const metrics = useMemo(() => computeMetrics(data), [data]);
  const slides = useMemo(() => buildSlides(metrics), [metrics]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setIndex(0);
      setPaused(false);
    }
  }, [open]);

  const goNext = () => {
    setIndex((i) => {
      if (i >= slides.length - 1) {
        onClose();
        return i;
      }
      return i + 1;
    });
  };
  const goPrev = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    if (!open || paused) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(goNext, SLIDE_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, open, paused, slides.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);

  if (!open) return null;

  // Clamp in case live data sync shrinks the conditional slide list while open.
  const safeIndex = Math.min(index, slides.length - 1);
  const current = slides[safeIndex];
  const hasData = metrics.totalHours > 0 || metrics.activeDays > 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 md:p-6">
      <div
        className="relative w-full max-w-md h-[88vh] max-h-[760px] rounded-3xl overflow-hidden shadow-2xl select-none"
        style={{ background: current.gradient }}
      >
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1.5 p-3">
          {slides.map((s, i) => (
            <div
              key={s.id}
              className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden"
            >
              <motion.div
                className="h-full rounded-full bg-white"
                initial={false}
                animate={{ width: i < safeIndex ? "100%" : i === safeIndex ? "100%" : "0%" }}
                transition={
                  i === safeIndex && !paused
                    ? { duration: SLIDE_DURATION_MS / 1000, ease: "linear" }
                    : { duration: 0 }
                }
                style={i === safeIndex ? undefined : { width: i < safeIndex ? "100%" : "0%" }}
              />
            </div>
          ))}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3.5 right-3 z-30 w-8 h-8 rounded-full grid place-items-center bg-black/20 text-white/90 hover:bg-black/40 transition-colors"
          aria-label="Close recap"
          data-testid="button-close-recap"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Tap zones */}
        <button
          className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
          onClick={goPrev}
          aria-label="Previous"
        />
        <button
          className="absolute right-0 top-0 bottom-0 w-2/3 z-10"
          onClick={goNext}
          aria-label="Next"
        />

        {/* Slide content */}
        <div
          className="absolute inset-0 flex items-center justify-center px-8"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {!hasData ? (
            <div className="text-center">
              <div className="text-6xl">🗓️</div>
              <p className="mt-5 text-xl font-bold text-white">
                No revision logged yet
              </p>
              <p className="mt-2 text-sm text-white/70">
                Log some study days in April–June to unlock your recap.
              </p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                initial={{ opacity: 0, scale: 0.94, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.02, y: -12 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full flex items-center justify-center"
              >
                {current.content}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Desktop nav hints */}
        {hasData && (
          <div className="absolute bottom-3 left-0 right-0 z-20 flex items-center justify-between px-4 text-white/40 pointer-events-none">
            <ChevronLeft className="w-5 h-5" />
            <span className="text-[11px] uppercase tracking-widest">
              {safeIndex + 1} / {slides.length}
            </span>
            <ChevronRight className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}
