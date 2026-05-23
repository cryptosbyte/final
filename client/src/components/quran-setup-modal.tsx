import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { X, Trash2, CheckCircle2, Circle, RotateCcw, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useQuranPlan, getPlanProgress, getPagesForDate, getPageRangeForDate,
  getSurahsForPageRange, QURAN_TOTAL_PAGES, getTotalPagesRead,
} from "@/hooks/use-quran-plan";

const PRESETS = [
  { days: 30,  label: "30 days",  sub: "1 juz per day" },
  { days: 60,  label: "60 days",  sub: "½ juz per day" },
  { days: 90,  label: "90 days",  sub: "~6–7 pages/day" },
  { days: 180, label: "6 months", sub: "~3–4 pages/day" },
  { days: 365, label: "1 year",   sub: "~1–2 pages/day" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function QuranSetupModal({ open, onClose }: Props) {
  const { plan, createPlan, markDone, unmarkDone, deletePlan } = useQuranPlan();
  const [selectedDays, setSelectedDays] = useState(30);
  const [customDays, setCustomDays] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [startDate, setStartDate] = useState(todayStr());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pagesInput, setPagesInput] = useState("");
  const [showPagesInput, setShowPagesInput] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmDelete(false);
      setShowPagesInput(false);
      setPagesInput("");
    }
  }, [open]);

  const totalDays = useCustom ? (parseInt(customDays) || 0) : selectedDays;
  const pagesPerDay = totalDays > 0 ? Math.ceil(QURAN_TOTAL_PAGES / totalDays) : 0;

  const today = todayStr();

  // ── Active plan view helpers ─────────────────────────────────────────────
  const progress = plan ? getPlanProgress(plan) : null;
  const pagesToday = plan ? getPagesForDate(plan, today) : 0;
  const rangeToday = plan ? getPageRangeForDate(plan, today) : null;
  const surahsToday = rangeToday
    ? getSurahsForPageRange(rangeToday.start, rangeToday.end)
    : null;
  const isTodayDone = plan
    ? ((plan.dailyPages ?? {})[today] !== undefined || (plan.completedDates ?? []).includes(today))
    : false;
  const dayIndexToday = plan
    ? differenceInCalendarDays(parseISO(today), parseISO(plan.startDate)) + 1
    : 0;
  const planInProgress = plan
    ? dayIndexToday >= 1 && dayIndexToday <= plan.totalDays
    : false;

  // Dynamic daily target (recalculated pages remaining / days remaining)
  const dynamicTarget = plan ? pagesToday : 0;

  // Last 7 days of the plan for the mini log
  const recentDays = plan
    ? Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        const ds = d.toISOString().slice(0, 10);
        const di = differenceInCalendarDays(parseISO(ds), parseISO(plan.startDate)) + 1;
        if (di < 1 || di > plan.totalDays) return null;
        const logged = (plan.dailyPages ?? {})[ds] !== undefined || (plan.completedDates ?? []).includes(ds);
        const pagesLogged = (plan.dailyPages ?? {})[ds];
        return { dateStr: ds, dayIndex: di, done: logged, pagesLogged };
      }).filter(Boolean)
    : [];

  function handleMarkDone() {
    if (!plan) return;
    if (showPagesInput) {
      const pages = parseInt(pagesInput);
      if (isNaN(pages) || pages < 1) return;
      markDone(today, Math.min(pages, QURAN_TOTAL_PAGES));
      setShowPagesInput(false);
      setPagesInput("");
    } else {
      setShowPagesInput(true);
      setPagesInput(String(dynamicTarget > 0 ? dynamicTarget : plan.pagesPerDay));
    }
  }

  function handleMarkDoneQuick() {
    if (!plan) return;
    markDone(today, dynamicTarget > 0 ? dynamicTarget : plan.pagesPerDay);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal card */}
          <motion.div
            className="relative z-10 w-[min(94vw,500px)] max-h-[85vh] overflow-y-auto rounded-3xl bg-card border border-border/60 shadow-2xl p-6"
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* ── HEADER ─────────────────────────────────────────── */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-3xl select-none" aria-hidden>🌙</span>
              <div>
                <h2 className="text-lg font-bold tracking-tight">Quran Completion</h2>
                <p className="text-xs text-muted-foreground">
                  {plan ? "Track your daily reading progress" : "Plan a full Khatm Al-Quran"}
                </p>
              </div>
            </div>

            {!plan ? (
              /* ── SETUP VIEW ─────────────────────────────────── */
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    How many days?
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESETS.map(p => (
                      <button
                        key={p.days}
                        onClick={() => { setSelectedDays(p.days); setUseCustom(false); }}
                        className={`flex flex-col items-center py-2.5 px-2 rounded-xl border text-sm font-semibold transition-all ${
                          !useCustom && selectedDays === p.days
                            ? "bg-sky-500 border-sky-500 text-white"
                            : "border-border bg-secondary/40 text-foreground hover:bg-secondary"
                        }`}
                      >
                        <span>{p.label}</span>
                        <span className={`text-[10px] font-normal mt-0.5 ${!useCustom && selectedDays === p.days ? "text-white/80" : "text-muted-foreground"}`}>
                          {p.sub}
                        </span>
                      </button>
                    ))}
                    <button
                      onClick={() => setUseCustom(true)}
                      className={`flex flex-col items-center py-2.5 px-2 rounded-xl border text-sm font-semibold transition-all ${
                        useCustom
                          ? "bg-sky-500 border-sky-500 text-white"
                          : "border-border bg-secondary/40 text-foreground hover:bg-secondary"
                      }`}
                    >
                      <span>Custom</span>
                      <span className={`text-[10px] font-normal mt-0.5 ${useCustom ? "text-white/80" : "text-muted-foreground"}`}>
                        enter days
                      </span>
                    </button>
                  </div>

                  {useCustom && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="number" min={1} max={3650} placeholder="e.g. 45"
                        value={customDays}
                        onChange={e => setCustomDays(e.target.value)}
                        className="flex-1 h-9 px-3 text-sm border border-border rounded-lg bg-background"
                        autoFocus
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">days</span>
                    </div>
                  )}
                </div>

                {pagesPerDay > 0 && (
                  <div className="bg-sky-500/8 border border-sky-500/20 rounded-xl px-4 py-3 text-sm space-y-0.5">
                    <p className="font-semibold text-foreground">
                      {pagesPerDay} page{pagesPerDay !== 1 ? "s" : ""} per day
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {QURAN_TOTAL_PAGES} pages ÷ {totalDays} days
                      {" · "}Day 1: {getSurahsForPageRange(1, pagesPerDay)}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Start date</p>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="h-9 px-3 text-sm border border-border rounded-lg bg-background w-full"
                  />
                </div>

                <Button
                  onClick={() => { if (totalDays > 0 && startDate) { createPlan(startDate, totalDays); } }}
                  disabled={totalDays < 1 || !startDate}
                  className="w-full font-semibold"
                >
                  Start Khatm
                </Button>
              </div>
            ) : (
              /* ── ACTIVE PLAN VIEW ───────────────────────────── */
              <div className="space-y-5">
                {/* Progress ring / stats */}
                {progress && (
                  <div className="flex items-center gap-4">
                    {/* Circular progress */}
                    <div className="relative shrink-0 w-20 h-20">
                      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--border))" strokeWidth="2.5" />
                        <circle
                          cx="18" cy="18" r="15.9" fill="none"
                          stroke="hsl(199 89% 48%)"
                          strokeWidth="2.5"
                          strokeDasharray={`${progress.pctComplete} ${100 - progress.pctComplete}`}
                          strokeLinecap="round"
                          style={{ transition: "stroke-dasharray 0.6s ease" }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center flex-col">
                        <span className="text-base font-bold leading-none">{progress.pctComplete}%</span>
                        <span className="text-[9px] text-muted-foreground leading-none mt-0.5">done</span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pages read</span>
                        <span className="font-semibold">{progress.pagesRead} / {QURAN_TOTAL_PAGES}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Days done</span>
                        <span className="font-semibold">{progress.totalCompleted} / {plan.totalDays}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Current streak</span>
                        <span className="font-semibold">{progress.streak} day{progress.streak !== 1 ? "s" : ""} 🔥</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Today's target</span>
                        <span className="font-semibold text-sky-500">
                          {isTodayDone
                            ? `${(plan.dailyPages ?? {})[today] ?? plan.pagesPerDay} pages ✓`
                            : `${dynamicTarget > 0 ? dynamicTarget : plan.pagesPerDay} pages`}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Today's reading */}
                {planInProgress && (
                  <div className={`rounded-xl border p-4 ${isTodayDone ? "border-emerald-500/30 bg-emerald-500/6" : pagesToday > 0 ? "border-sky-500/30 bg-sky-500/6" : "border-border bg-secondary/30"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Today · Day {dayIndexToday}
                        </p>
                        {isTodayDone ? (
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            ✓ Today's reading done — {(plan.dailyPages ?? {})[today] ?? plan.pagesPerDay} pages logged
                          </p>
                        ) : pagesToday > 0 ? (
                          <>
                            <p className="text-sm font-semibold text-foreground">
                              Read {pagesToday} page{pagesToday !== 1 ? "s" : ""}
                              {rangeToday && (
                                <span className="font-normal text-muted-foreground">
                                  {" "}(pp. {rangeToday.start}–{rangeToday.end})
                                </span>
                              )}
                            </p>
                            {surahsToday && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{surahsToday}</p>
                            )}
                            <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-1">
                              Target auto-adjusts based on your remaining pages &amp; days
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">All caught up for today!</p>
                        )}
                      </div>

                      {!isTodayDone && (
                        <button
                          onClick={handleMarkDoneQuick}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-sky-500 text-white hover:bg-sky-600 transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Done
                        </button>
                      )}
                      {isTodayDone && (
                        <button
                          onClick={() => unmarkDone(today)}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground hover:bg-secondary/70 transition-colors"
                        >
                          Undo
                        </button>
                      )}
                    </div>

                    {/* Pages input row */}
                    {!isTodayDone && (
                      <div className="mt-3 pt-3 border-t border-border/40">
                        {showPagesInput ? (
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <input
                              type="number"
                              min={1}
                              max={QURAN_TOTAL_PAGES}
                              value={pagesInput}
                              onChange={e => setPagesInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") handleMarkDone();
                                if (e.key === "Escape") { setShowPagesInput(false); setPagesInput(""); }
                              }}
                              placeholder="Pages read today"
                              className="flex-1 h-8 px-3 text-sm border border-border rounded-lg bg-background"
                              autoFocus
                            />
                            <button
                              onClick={handleMarkDone}
                              disabled={!pagesInput || parseInt(pagesInput) < 1}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500 text-white disabled:opacity-50 hover:bg-sky-600"
                            >
                              Log
                            </button>
                            <button
                              onClick={handleMarkDoneQuick}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70"
                              title={`Log ${dynamicTarget > 0 ? dynamicTarget : plan.pagesPerDay} pages (today's target)`}
                            >
                              Log {dynamicTarget > 0 ? dynamicTarget : plan.pagesPerDay}
                            </button>
                            <button
                              onClick={() => { setShowPagesInput(false); setPagesInput(""); }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleMarkDoneQuick}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-sky-500 text-white hover:bg-sky-600 transition-colors"
                            >
                              <Circle className="w-3.5 h-3.5" />
                              Mark done ({dynamicTarget > 0 ? dynamicTarget : plan.pagesPerDay} pages)
                            </button>
                            <button
                              onClick={() => { setShowPagesInput(true); setPagesInput(""); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                              title="Log a different number of pages"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              Custom
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {progress?.isKhatmDone && (
                  <div className="rounded-xl border border-sky-500/40 bg-sky-500/8 p-4 text-center">
                    <p className="text-2xl mb-1" aria-hidden>🌙✨</p>
                    <p className="text-sm font-bold text-foreground">Khatm Complete!</p>
                    <p className="text-xs text-muted-foreground">
                      Completed {plan.completedAt ? format(parseISO(plan.completedAt), "d MMMM yyyy") : ""}
                    </p>
                  </div>
                )}

                {/* Recent days mini log */}
                {recentDays.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Last 7 days</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {recentDays.map(d => d && (
                        <button
                          key={d.dateStr}
                          onClick={() => d.done ? unmarkDone(d.dateStr) : markDone(d.dateStr)}
                          title={`Day ${d.dayIndex} · ${format(parseISO(d.dateStr), "EEE d MMM")}${d.done ? ` (${d.pagesLogged ?? plan.pagesPerDay} pages)` : ""}`}
                          className={`flex flex-col items-center gap-0.5 w-11 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${
                            d.done
                              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                              : d.dateStr < today
                                ? "bg-red-500/8 border-red-500/20 text-red-500"
                                : "bg-secondary/50 border-border text-muted-foreground"
                          }`}
                        >
                          <span>{format(parseISO(d.dateStr), "EEE")}</span>
                          {d.done
                            ? <span className="text-[9px]">{d.pagesLogged ?? plan.pagesPerDay}p</span>
                            : <span>{d.dateStr < today ? "✗" : "·"}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Plan info */}
                <div className="text-xs text-muted-foreground border-t border-border/50 pt-3 flex justify-between gap-2 flex-wrap">
                  <span>Started {format(parseISO(plan.startDate), "d MMM yyyy")}</span>
                  <span>{plan.totalDays} day plan · {QURAN_TOTAL_PAGES - getTotalPagesRead(plan)} pages remaining</span>
                </div>

                {/* Delete */}
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset / start over
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <Trash2 className="w-4 h-4 text-destructive shrink-0" />
                    <p className="text-xs text-foreground flex-1">Delete this plan and all progress?</p>
                    <button onClick={() => { deletePlan(); setConfirmDelete(false); }} className="text-xs font-semibold text-destructive hover:opacity-75">Delete</button>
                    <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
