import { useState, useMemo } from "react";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, startOfWeek, endOfWeek, eachDayOfInterval, differenceInCalendarDays, subDays, addDays, isToday } from "date-fns";
import { useTodos } from "@/hooks/use-todos";
import { getNextExamForSubject, ExamSubject, EXAM_DATES } from "@/lib/exam-dates";
import { Flame, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { useRevisionData, Subject, ExamPaperRecord, SubjectEntry, DayEntry } from "@/hooks/use-revision-data";
import { useAuthContext } from "@/lib/auth-context";
import { FlashcardsStatsSection } from "@/components/flashcards-stats-section";

const SUBJECTS: { id: Subject; name: string; color: string }[] = [
  { id: "biology", name: "Biology", color: "hsl(var(--biology))" },
  { id: "chemistry", name: "Chemistry", color: "hsl(var(--chemistry))" },
  { id: "maths", name: "Maths", color: "hsl(var(--maths))" }
];

const SUBJECT_COUNTDOWN_CONFIG: { id: ExamSubject; name: string; colorVar: string }[] = [
  { id: "biology",   name: "Biology (OCR A)",   colorVar: "--biology" },
  { id: "chemistry", name: "Chemistry (OCR B)",  colorVar: "--chemistry" },
  { id: "maths",     name: "Maths (Edexcel)",    colorVar: "--maths" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Shared activity helpers
//
// The daily activity score reads every signal a day can carry, not just the
// `types[]` count. Each subject contributes:
//   • 1.0 per revision type tag, plus a +1.0 bonus when "mixed_exercises" is
//     selected (acknowledges the higher cognitive load vs. plain content).
//   • 0.5 per module/topic id ticked under moduleContent.
//   • 1.0 per logged exam paper, +1.0 bonus per `completed: true`, +0.5 per
//     paper that has marks entered (rewards proper logging, not just adding).
//   • 1.0 per anki session, plus 0.75 per logged hour (capped at 8h to dampen
//     outliers). Biology gets a ×1.5 multiplier on the anki component because
//     OCR A Bio recall is flashcard-heavy.
//   • 0.5 × productivity rating (so 5★ adds 2.5).
//   • Notes signal: 0.5 baseline if subject notes are >20 chars + 0.5 per
//     occurrence of "completed/done/finished" (case-insensitive), capped at 4.
// At day level we additionally fold in the general notes signal and apply a
// proximity-to-exam multiplier (1.0 → 1.5 from 60d out down to 7d) so that
// effort logged closer to an exam is weighted more heavily.
// ─────────────────────────────────────────────────────────────────────────────

const COMPLETED_RX = /\b(?:completed|complete|done|finished|finish)\b/gi;

function countCompletedMentions(text: string | undefined): number {
  if (!text) return 0;
  const m = text.match(COMPLETED_RX);
  return m ? m.length : 0;
}

function notesScore(notes: string | undefined): number {
  if (!notes) return 0;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return 0;
  // Any non-empty note registers a small token so streak/heatmap stay in sync
  // (streak counts notes-only days as active — the score must too).
  let s = 0.25;
  if (trimmed.length > 20) s += 0.25; // substantive-note bump
  s += 0.5 * countCompletedMentions(trimmed);
  return Math.min(s, 4);
}

function subjectActivityScore(
  entry: SubjectEntry | undefined,
  subject?: Subject,
): number {
  if (!entry) return 0;
  let score = 0;

  // Revision type tags + mixed-exercises bonus.
  score += entry.types.length;
  if (entry.types.includes("mixed_exercises")) score += 1;

  // Module / topic coverage.
  if (entry.moduleContent && entry.moduleContent.length > 0) {
    score += 0.5 * entry.moduleContent.length;
  }

  // Exam paper records — count, completion, and whether marks were entered.
  if (entry.examPaperRecords && entry.examPaperRecords.length > 0) {
    for (const r of entry.examPaperRecords) {
      score += 1;
      if (r.completed) score += 1;
      if (r.marksObtained != null && r.totalMarks) score += 0.5;
    }
  }

  // Anki — sessions + hours. Biology gets a 1.5× boost on the anki block.
  if (entry.ankiSessions && entry.ankiSessions.length > 0) {
    let ankiBlock = entry.ankiSessions.length;
    const hours = entry.ankiSessions.reduce(
      (acc, a) => acc + (Number.isFinite(a.hours) ? Math.max(0, a.hours) : 0),
      0,
    );
    ankiBlock += 0.75 * Math.min(hours, 8);
    if (subject === "biology") ankiBlock *= 1.5;
    score += ankiBlock;
  }

  // Productivity self-rating contributes proportionally.
  if (entry.productivity > 0) score += 0.5 * entry.productivity;

  // Notes signal for this subject.
  score += notesScore(entry.notes);

  // Floor: any logged productivity should at minimum register as 1 unit so
  // streaks/heatmap behaviour stays sane.
  if (score === 0 && entry.productivity > 0) score = 1;

  return score;
}

function subjectIsActive(entry: SubjectEntry | undefined): boolean {
  if (!entry) return false;
  return (
    entry.types.length > 0 ||
    entry.productivity > 0 ||
    !!(entry.moduleContent && entry.moduleContent.length > 0) ||
    !!(entry.examPaperRecords && entry.examPaperRecords.length > 0) ||
    !!(entry.ankiSessions && entry.ankiSessions.length > 0) ||
    !!(entry.notes && entry.notes.trim().length > 0)
  );
}

function dayHasAnyActivity(entry: DayEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.notes && entry.notes.trim().length > 0) return true;
  return (["biology", "chemistry", "maths"] as Subject[]).some(
    (s) => subjectIsActive(entry.subjects?.[s]),
  );
}

// Proximity-to-exam multiplier — same shape used at the day level so that a
// logged hour 5 days before chemistry counts more than the same hour in April.
function dayUrgencyMultiplier(dateKey: string | undefined): number {
  if (!dateKey) return 1;
  let minDays = Infinity;
  for (const e of EXAM_DATES) {
    const diff = differenceInCalendarDays(parseISO(e.date), parseISO(dateKey));
    if (diff >= 0 && diff < minDays) minDays = diff;
  }
  if (!Number.isFinite(minDays)) return 1;
  if (minDays >= 60) return 1;
  if (minDays <= 7) return 1.5;
  // Linear ramp 60d → 1.0 down to 7d → 1.5.
  return 1 + (60 - minDays) * (0.5 / 53);
}

function dayActivityScore(
  entry: DayEntry | undefined,
  dateKey?: string,
): number {
  if (!entry) return 0;
  const subjectsTotal = (["biology", "chemistry", "maths"] as Subject[]).reduce(
    (acc, s) => acc + subjectActivityScore(entry.subjects?.[s], s),
    0,
  );
  const general = notesScore(entry.notes);
  const raw = subjectsTotal + general;
  return raw * dayUrgencyMultiplier(dateKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Current Streak
// ─────────────────────────────────────────────────────────────────────────────

function StreakCard({ data }: { data: ReturnType<typeof useRevisionData>["data"] }) {
  const { current, longest, todayActive } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Walk back from today (or yesterday if today empty) for current streak.
    let current = 0;
    let cursor = new Date(today);
    const todayKey = format(today, "yyyy-MM-dd");
    const todayActive = dayHasAnyActivity(data[todayKey]);

    if (!todayActive) {
      cursor = subDays(cursor, 1); // Allow streak to count up through yesterday.
    }
    while (true) {
      const key = format(cursor, "yyyy-MM-dd");
      if (dayHasAnyActivity(data[key])) {
        current++;
        cursor = subDays(cursor, 1);
      } else {
        break;
      }
    }

    // Longest streak across all logged data.
    const activeKeys = Object.keys(data)
      .filter((k) => dayHasAnyActivity(data[k]))
      .sort();
    let longest = 0;
    let run = 0;
    let prev: Date | null = null;
    for (const k of activeKeys) {
      const d = parseISO(k);
      if (prev && differenceInCalendarDays(d, prev) === 1) {
        run++;
      } else {
        run = 1;
      }
      longest = Math.max(longest, run);
      prev = d;
    }

    return { current, longest, todayActive };
  }, [data]);

  const subtitle = current === 0
    ? "No active streak — log today to start one."
    : todayActive
      ? `You've revised ${current === 1 ? "today" : `${current} days in a row`}. Keep it going!`
      : `${current} day${current === 1 ? "" : "s"} streak — log today before midnight to keep it alive.`;

  return (
    <div className="max-w-6xl mx-auto">
      <div
        className="bg-card border rounded-xl p-6 shadow-sm flex items-center gap-5"
        style={{ borderLeftWidth: 4, borderLeftColor: "hsl(25 95% 55%)" }}
        data-testid="streak-card"
      >
        <div
          className="w-16 h-16 rounded-full grid place-items-center shrink-0"
          style={{ background: "linear-gradient(135deg, hsl(25 95% 55% / 0.18), hsl(0 90% 60% / 0.12))" }}
        >
          <Flame
            className="w-8 h-8"
            style={{ color: current > 0 ? "hsl(25 95% 55%)" : "hsl(var(--muted-foreground))" }}
            fill={current > 0 ? "hsl(25 95% 55% / 0.25)" : "none"}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="text-4xl font-bold"
              style={{ color: current > 0 ? "hsl(25 95% 55%)" : "hsl(var(--muted-foreground))" }}
              data-testid="streak-current"
            >
              {current}
            </span>
            <span className="text-base font-semibold text-foreground">
              day{current === 1 ? "" : "s"} current streak
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="text-right shrink-0 hidden sm:block">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Longest</p>
          <p className="text-2xl font-bold text-foreground" data-testid="streak-longest">{longest}</p>
          <p className="text-xs text-muted-foreground">day{longest === 1 ? "" : "s"}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subject Balance — chi-square goodness-of-fit + A* day-investment recs
// ─────────────────────────────────────────────────────────────────────────────

// chi-square critical values for df=2.
const CHI2_CRITICAL_DF2 = { p10: 4.605, p05: 5.991, p01: 9.21 };

function gradeFromAvg(avg: number, subject: Subject): "A*" | "A" | "B" | "Below B" {
  // Subject-wide simple boundary: average across the three GRADE_BOUNDARIES papers.
  const b = GRADE_BOUNDARIES[subject];
  const aStar = (b.aStar.p1 + b.aStar.p2 + b.aStar.p3) / 3;
  const a = (b.a.p1 + b.a.p2 + b.a.p3) / 3;
  if (avg >= aStar) return "A*";
  if (avg >= a) return "A";
  if (avg >= a - 2) return "B";
  return "Below B";
}

function SubjectBalanceSection({ data }: { data: ReturnType<typeof useRevisionData>["data"] }) {
  const WINDOW_DAYS = 5;

  const analysis = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const subjects: Subject[] = ["biology", "chemistry", "maths"];

    // 1) Observed activity scores in last WINDOW_DAYS.
    const observed: Record<Subject, number> = { biology: 0, chemistry: 0, maths: 0 };
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = subDays(today, i);
      const key = format(d, "yyyy-MM-dd");
      const entry = data[key];
      subjects.forEach((s) => {
        observed[s] += subjectActivityScore(entry?.subjects?.[s], s);
      });
    }
    const observedTotal = subjects.reduce((acc, s) => acc + observed[s], 0);

    // 2) Days until each subject's *next* exam (used to weight expected proportion).
    const daysUntil: Record<Subject, number> = { biology: 60, chemistry: 60, maths: 60 };
    subjects.forEach((s) => {
      const next = getNextExamForSubject(s);
      if (next) {
        daysUntil[s] = Math.max(1, differenceInCalendarDays(parseISO(next.date), today));
      }
    });

    // 3) Current paper-marks average % per subject (proxy for A* readiness).
    const paperAvgs: Record<Subject, { avg: number; count: number }> = {
      biology: { avg: 0, count: 0 },
      chemistry: { avg: 0, count: 0 },
      maths: { avg: 0, count: 0 },
    };
    Object.values(data).forEach((entry) => {
      subjects.forEach((s) => {
        const recs = entry.subjects?.[s]?.examPaperRecords;
        if (!recs) return;
        recs.forEach((r) => {
          if (r.marksObtained != null && r.totalMarks) {
            const pct = (r.marksObtained / r.totalMarks) * 100;
            paperAvgs[s].avg = (paperAvgs[s].avg * paperAvgs[s].count + pct) / (paperAvgs[s].count + 1);
            paperAvgs[s].count += 1;
          }
        });
      });
    });

    // 4) Module coverage % per subject (Bio/Chem/Maths Pure topics).
    const coverage: Record<Subject, { done: number; total: number }> = {
      biology: { done: 0, total: ALL_MODULES.biology.length },
      chemistry: { done: 0, total: ALL_MODULES.chemistry.length },
      maths: { done: 0, total: ALL_MODULES.maths.length },
    };
    const seen: Record<Subject, Set<string>> = { biology: new Set(), chemistry: new Set(), maths: new Set() };
    Object.values(data).forEach((entry) => {
      subjects.forEach((s) => {
        (entry.subjects?.[s]?.moduleContent ?? []).forEach((id) => seen[s].add(id));
      });
    });
    subjects.forEach((s) => {
      coverage[s].done = ALL_MODULES[s].filter((m) => seen[s].has(m.id)).length;
    });

    // 5) Expected proportions — weight each subject by:
    //    urgency (1/days_until_exam) × A*-gap (max(0, aStar_target - currentAvg)/aStar_target + 0.25)
    //                                × coverage-gap (1 - coverage% + 0.15)
    const aStarTarget: Record<Subject, number> = {
      biology: (GRADE_BOUNDARIES.biology.aStar.p1 + GRADE_BOUNDARIES.biology.aStar.p2 + GRADE_BOUNDARIES.biology.aStar.p3) / 3,
      chemistry: (GRADE_BOUNDARIES.chemistry.aStar.p1 + GRADE_BOUNDARIES.chemistry.aStar.p2 + GRADE_BOUNDARIES.chemistry.aStar.p3) / 3,
      maths: (GRADE_BOUNDARIES.maths.aStar.p1 + GRADE_BOUNDARIES.maths.aStar.p2 + GRADE_BOUNDARIES.maths.aStar.p3) / 3,
    };
    const weights: Record<Subject, number> = { biology: 0, chemistry: 0, maths: 0 };
    subjects.forEach((s) => {
      const urgency = 1 / daysUntil[s];
      const currentAvg = paperAvgs[s].count > 0 ? paperAvgs[s].avg : 0;
      const target = aStarTarget[s];
      const gradeGap = currentAvg === 0 ? 1 : Math.max(0, (target - currentAvg) / target) + 0.25;
      const covPct = coverage[s].total === 0 ? 1 : coverage[s].done / coverage[s].total;
      const coverageGap = 1 - covPct + 0.15;
      weights[s] = urgency * gradeGap * coverageGap;
    });
    const wSum = subjects.reduce((acc, s) => acc + weights[s], 0) || 1;
    const expectedShare: Record<Subject, number> = {
      biology: weights.biology / wSum,
      chemistry: weights.chemistry / wSum,
      maths: weights.maths / wSum,
    };

    // 6) Chi-square goodness-of-fit. Cochran's rule of thumb requires every
    //    expected count >= ~1 (and ideally >= 5) for the test to be valid;
    //    otherwise tiny denominators explode the statistic. Require both.
    const MIN_EXPECTED = 1;
    let chi2 = 0;
    const expectedCounts = subjects.map((s) => expectedShare[s] * observedTotal);
    const minExp = Math.min(...expectedCounts);
    const canTest = observedTotal >= 5 && minExp >= MIN_EXPECTED;
    if (canTest) {
      subjects.forEach((s) => {
        const exp = Math.max(expectedShare[s] * observedTotal, MIN_EXPECTED);
        chi2 += Math.pow(observed[s] - exp, 2) / exp;
      });
    }
    const significance: "balanced" | "imbalanced" | "very imbalanced" | "insufficient" =
      !canTest ? "insufficient" :
      chi2 >= CHI2_CRITICAL_DF2.p01 ? "very imbalanced" :
      chi2 >= CHI2_CRITICAL_DF2.p05 ? "imbalanced" :
      "balanced";

    // 7) Per-subject recommendation: how many sessions over the next WINDOW_DAYS
    //    are needed to bring observed share up to expected share, plus a daily-hours hint.
    //    Sessions-needed = max(0, expectedShare × projectedTotal − observed). Use projected
    //    total = max(observedTotal, WINDOW_DAYS × 3) so recs are forward-looking.
    const projectedTotal = Math.max(observedTotal, WINDOW_DAYS * 3);
    const perSubject = subjects.map((s) => {
      const obsShare = observedTotal > 0 ? observed[s] / observedTotal : 0;
      const expShare = expectedShare[s];
      const targetSessions = expShare * projectedTotal;
      const deficit = Math.max(0, targetSessions - observed[s]);
      const sessionsPerDay = deficit / WINDOW_DAYS;
      // Convert "sessions" to a rough daily-hours hint (~1h per session unit).
      const hoursPerDay = sessionsPerDay * 1.0;
      const currentAvg = paperAvgs[s].count > 0 ? paperAvgs[s].avg : null;
      const grade = currentAvg != null ? gradeFromAvg(currentAvg, s) : null;
      const aStarGap = currentAvg != null ? Math.max(0, aStarTarget[s] - currentAvg) : null;
      const covPct = coverage[s].total === 0 ? 100 : Math.round((coverage[s].done / coverage[s].total) * 100);
      return {
        subject: s,
        observed: observed[s],
        obsSharePct: Math.round(obsShare * 100),
        expSharePct: Math.round(expShare * 100),
        deficit,
        sessionsPerDay,
        hoursPerDay,
        daysUntil: daysUntil[s],
        currentAvg,
        grade,
        aStarTarget: aStarTarget[s],
        aStarGap,
        coveragePct: covPct,
        neglected: obsShare + 0.05 < expShare,
      };
    });

    return { observed, observedTotal, expectedShare, chi2, significance, perSubject };
  }, [data]);

  const sigLabel: Record<typeof analysis.significance, { text: string; cls: string }> = {
    balanced: { text: "Balanced", cls: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300" },
    imbalanced: { text: "Imbalanced (p < 0.05)", cls: "bg-amber-100 text-amber-700 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300" },
    "very imbalanced": { text: "Heavily skewed (p < 0.01)", cls: "bg-red-100 text-red-700 ring-red-300 dark:bg-red-500/15 dark:text-red-300" },
    insufficient: { text: "Not enough data yet", cls: "bg-muted text-muted-foreground ring-border" },
  };
  const sig = sigLabel[analysis.significance];

  const colorVarMap: Record<Subject, string> = {
    biology: "--biology",
    chemistry: "--chemistry",
    maths: "--maths",
  };
  const nameMap: Record<Subject, string> = {
    biology: "Biology",
    chemistry: "Chemistry",
    maths: "Maths",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Subject Balance</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Chi-square goodness-of-fit on the last {WINDOW_DAYS} days vs. an A*-targeting expected mix
            (weighted by exam urgency, current paper average, and module coverage gap).
          </p>
        </div>
        <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full ring-1 ${sig.cls}`} data-testid="balance-significance">
          χ² = {analysis.chi2.toFixed(2)} · {sig.text}
        </span>
      </div>

      {/* Stacked observed vs expected bar */}
      <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4" data-testid="balance-bar">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Last {WINDOW_DAYS} days — observed share
          </p>
          <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
            {(["biology", "chemistry", "maths"] as Subject[]).map((s) => {
              const pct = analysis.observedTotal > 0 ? (analysis.observed[s] / analysis.observedTotal) * 100 : 0;
              if (pct === 0) return null;
              return <div key={s} style={{ width: `${pct}%`, background: `hsl(var(${colorVarMap[s]}))` }} />;
            })}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expected share to maximise A* odds
          </p>
          <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
            {(["biology", "chemistry", "maths"] as Subject[]).map((s) => {
              const pct = analysis.expectedShare[s] * 100;
              return <div key={s} style={{ width: `${pct}%`, background: `hsl(var(${colorVarMap[s]}) / 0.55)` }} />;
            })}
          </div>
        </div>
      </div>

      {/* Per-subject recommendation cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {analysis.perSubject.map((row) => {
          const color = `hsl(var(${colorVarMap[row.subject]}))`;
          const recHrs = row.hoursPerDay;
          const recLabel = recHrs >= 0.25
            ? `~${recHrs.toFixed(recHrs >= 1 ? 1 : 2)} h/day for the next ${WINDOW_DAYS} days`
            : `On track`;
          return (
            <div
              key={row.subject}
              className="bg-card border rounded-xl p-5 shadow-sm space-y-3"
              style={{ borderLeftWidth: 4, borderLeftColor: color }}
              data-testid={`balance-card-${row.subject}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                  <h3 className="font-semibold text-base">{nameMap[row.subject]}</h3>
                </div>
                {row.neglected && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-500/15 dark:text-red-300">
                    Neglected
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Observed</p>
                  <p className="text-lg font-bold" style={{ color }}>{row.obsSharePct}%</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Target</p>
                  <p className="text-lg font-bold text-foreground">{row.expSharePct}%</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Days to exam</p>
                  <p className="text-base font-semibold text-foreground">{row.daysUntil}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Coverage</p>
                  <p className="text-base font-semibold text-foreground">{row.coveragePct}%</p>
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">A* readiness</p>
                {row.currentAvg != null ? (
                  <p className="text-sm">
                    Avg paper score: <strong className="text-foreground">{row.currentAvg.toFixed(0)}%</strong>
                    {" · "}A* needs <strong className="text-foreground">{row.aStarTarget.toFixed(0)}%</strong>
                    {row.aStarGap != null && row.aStarGap > 0 && (
                      <span className="text-amber-600 dark:text-amber-400"> (gap {row.aStarGap.toFixed(0)}%)</span>
                    )}
                    {row.aStarGap === 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400"> ✓ at A* pace</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No paper marks logged yet.</p>
                )}
              </div>

              <div className="rounded-lg p-3 text-sm" style={{ background: `hsl(var(${colorVarMap[row.subject]}) / 0.08)` }}>
                <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color }}>
                  Recommendation
                </p>
                <p className="text-foreground font-medium">{recLabel}</p>
                {row.deficit > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Add <strong>{Math.ceil(row.deficit)}</strong> more session{Math.ceil(row.deficit) === 1 ? "" : "s"} this window to hit balance.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-month heatmap (Apr–Jun 2026)
// ─────────────────────────────────────────────────────────────────────────────

function ThreeMonthHeatmap({ data, todayBonus = 0 }: { data: ReturnType<typeof useRevisionData>["data"]; todayBonus?: number }) {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const { weeks, maxScore, totalActiveDays, examDateSet } = useMemo(() => {
    const start = new Date(2026, 3, 1); // 1 Apr 2026
    const end = new Date(2026, 5, 30);  // 30 Jun 2026
    const gridStart = startOfWeek(start, { weekStartsOn: 1 }); // Monday
    const gridEnd = endOfWeek(end, { weekStartsOn: 1 });
    const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

    const examDateSet = new Set(EXAM_DATES.map((e) => e.date));

    const weeks: { date: Date; key: string; inRange: boolean; score: number; isExam: boolean }[][] = [];
    let week: { date: Date; key: string; inRange: boolean; score: number; isExam: boolean }[] = [];
    let maxScore = 0;
    let totalActiveDays = 0;

    allDays.forEach((d, idx) => {
      const key = format(d, "yyyy-MM-dd");
      const inRange = isWithinInterval(d, { start, end });
      const score = inRange ? dayActivityScore(data[key], key) + (key === todayKey ? todayBonus : 0) : 0;
      if (score > 0) totalActiveDays++;
      if (score > maxScore) maxScore = score;
      week.push({ date: d, key, inRange, score, isExam: inRange && examDateSet.has(key) });
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      } else if (idx === allDays.length - 1) {
        weeks.push(week);
      }
    });

    return { weeks, maxScore, totalActiveDays, examDateSet };
  }, [data]);

  const intensityClass = (score: number) => {
    if (score === 0) return 0;
    const ratio = maxScore === 0 ? 0 : score / maxScore;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  const colorForLevel = (level: number) => {
    if (level === 0) return "hsl(var(--secondary) / 0.4)";
    const alpha = 0.2 + level * 0.18; // 0.38 → 0.92
    return `hsl(var(--primary) / ${alpha})`;
  };

  // Month labels on top of weeks where the first day of a new in-range month appears.
  const monthLabels: { idx: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wIdx) => {
    const firstInRange = week.find((c) => c.inRange);
    if (firstInRange) {
      const m = firstInRange.date.getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ idx: wIdx, label: format(firstInRange.date, "MMM") });
        lastMonth = m;
      }
    }
  });

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">3-Month Activity Heatmap</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every day of the Apr–Jun 2026 revision window. Darker = more activity.{" "}
            <span className="text-foreground font-semibold">{totalActiveDays}</span> active day
            {totalActiveDays === 1 ? "" : "s"} so far.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span
              key={lvl}
              className="w-3 h-3 rounded-sm border border-border/50"
              style={{ background: colorForLevel(lvl) }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-5 shadow-sm overflow-x-auto" data-testid="heatmap">
        <div className="inline-flex flex-col gap-1 min-w-full">
          {/* Month label strip */}
          <div className="flex gap-1 pl-7 h-4 relative">
            {weeks.map((_, wIdx) => {
              const lbl = monthLabels.find((m) => m.idx === wIdx);
              return (
                <div key={wIdx} className="w-3.5 text-[10px] font-semibold text-muted-foreground">
                  {lbl ? lbl.label : ""}
                </div>
              );
            })}
          </div>

          <div className="flex gap-1">
            {/* Weekday labels (M, W, F) */}
            <div className="flex flex-col gap-1 pr-1 text-[9px] text-muted-foreground w-6">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={i} className="h-3.5 leading-3.5 flex items-center" style={{ visibility: i % 2 === 0 ? "visible" : "hidden" }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-1">
                {week.map((cell) => {
                  const lvl = intensityClass(cell.score);
                  const tooltip = cell.inRange
                    ? `${format(cell.date, "EEE d MMM yyyy")}${cell.score > 0 ? ` — score ${cell.score.toFixed(1)}` : " — no activity"}${cell.isExam ? " · EXAM DAY" : ""}`
                    : "";
                  return (
                    <div
                      key={cell.key}
                      title={tooltip}
                      data-testid={`heatmap-cell-${cell.key}`}
                      className={`w-3.5 h-3.5 rounded-sm border ${cell.isExam ? "ring-2 ring-red-500" : "border-border/40"}`}
                      style={{
                        background: cell.inRange ? colorForLevel(lvl) : "transparent",
                        borderColor: cell.inRange ? undefined : "transparent",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground mt-3">
          <span className="inline-block w-2 h-2 rounded-sm ring-2 ring-red-500 mr-1 align-middle" />
          Red outline marks an exam day.
        </p>
      </div>
    </div>
  );
}

function ExamCountdown() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-foreground mb-3">Exam Countdown</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SUBJECT_COUNTDOWN_CONFIG.map(({ id, name, colorVar }) => {
          const nextExam = getNextExamForSubject(id);
          if (!nextExam) {
            return (
              <div key={id} className="bg-card border rounded-xl p-5 shadow-sm flex flex-col gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(var(${colorVar}))` }} />
                  <span className="font-semibold text-sm text-muted-foreground">{name}</span>
                </div>
                <p className="text-2xl font-bold text-muted-foreground">All done!</p>
                <p className="text-xs text-muted-foreground">All exams completed</p>
              </div>
            );
          }

          const daysLeft = differenceInCalendarDays(parseISO(nextExam.date), today);
          const countLabel =
            daysLeft === 0 ? "Today!" :
            daysLeft === 1 ? "Tomorrow" :
            `${daysLeft} days`;

          const urgency =
            daysLeft <= 7  ? "text-red-500" :
            daysLeft <= 21 ? "text-amber-500" :
            `text-[hsl(var(${colorVar}))]`;

          return (
            <div
              key={id}
              className="bg-card border rounded-xl p-5 shadow-sm flex flex-col gap-1"
              style={{ borderLeftWidth: 4, borderLeftColor: `hsl(var(${colorVar}))` }}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(var(${colorVar}))` }} />
                <span className="font-semibold text-sm text-foreground">{name}</span>
              </div>
              <p className={`text-3xl font-bold ${urgency}`}>{countLabel}</p>
              <p className="text-sm font-medium text-foreground">{nextExam.paper}</p>
              <p className="text-xs text-muted-foreground">{format(parseISO(nextExam.date), "EEE d MMMM yyyy")}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ALL_MODULES: Record<Subject, { id: string; label: string }[]> = {
  biology: [
    { id: "3.1.1", label: "3.1.1 Exchange surfaces" },
    { id: "3.1.2", label: "3.1.2 Transport in animals" },
    { id: "3.1.3", label: "3.1.3 Transport in plants" },
    { id: "4.1.1", label: "4.1.1 Communicable diseases" },
    { id: "4.2.1", label: "4.2.1 Biodiversity" },
    { id: "4.2.2", label: "4.2.2 Classification & evolution" },
    { id: "5.1.1", label: "5.1.1 Communication & homeostasis" },
    { id: "5.1.2", label: "5.1.2 Excretion" },
    { id: "5.1.3", label: "5.1.3 Neuronal communication" },
    { id: "5.1.4", label: "5.1.4 Hormonal communication" },
    { id: "5.1.5", label: "5.1.5 Plant & animal responses" },
    { id: "5.2.1", label: "5.2.1 Photosynthesis" },
    { id: "5.2.2", label: "5.2.2 Respiration" },
    { id: "6.1.1", label: "6.1.1 Cellular control" },
    { id: "6.1.2", label: "6.1.2 Patterns of inheritance" },
    { id: "6.1.3", label: "6.1.3 Manipulating genomes" },
    { id: "6.2.1", label: "6.2.1 Cloning & biotechnology" },
    { id: "6.3.1", label: "6.3.1 Ecosystems" },
    { id: "6.3.2", label: "6.3.2 Populations & sustainability" },
  ],
  chemistry: [
    { id: "EL", label: "EL" },
    { id: "DF", label: "DF" },
    { id: "ES", label: "ES" },
    { id: "OZ", label: "OZ" },
    { id: "WM", label: "WM" },
    { id: "O",  label: "O"  },
    { id: "CI", label: "CI" },
    { id: "PL", label: "PL" },
    { id: "DM", label: "DM" },
    { id: "CD", label: "CD" },
  ],
  maths: [
    ...([
      "Exponentials and Logs Modelling",
      "Exponentials and Logs",
      "Coordinate Geometry",
      "Proof",
      "Vectors",
      "Integration Parametric Equations",
      "Integration Differential Equations",
      "Integration Trapezium Rule",
      "Integration",
      "Numerical Methods",
      "Parametrics",
      "Sectors and Segments",
      "Differentiation Optimisation",
      "Implicit Differentiation",
      "Differentiation",
      "Trigonometry Modelling",
      "Trigonometry",
      "Binomial Expansion",
      "Sequences and Series Modelling",
      "Sequences and Series",
      "Modulus Function",
      "Functions",
    ].map(t => ({ id: `Pure:${t}`, label: t }))),
  ],
};

function ModuleCoverageSection({ data }: { data: ReturnType<typeof useRevisionData>["data"] }) {
  const subjectConfig: { id: Subject; name: string; colorVar: string; color: string }[] = [
    { id: "biology",   name: "Biology (OCR A)",   colorVar: "--biology",   color: "hsl(var(--biology))"   },
    { id: "chemistry", name: "Chemistry (OCR B)",  colorVar: "--chemistry", color: "hsl(var(--chemistry))" },
    { id: "maths",     name: "Maths (Edexcel)",    colorVar: "--maths",     color: "hsl(var(--maths))"     },
  ];

  const coverage = useMemo(() => {
    const result: Record<Subject, Set<string>> = { biology: new Set(), chemistry: new Set(), maths: new Set() };
    Object.values(data).forEach(entry => {
      (["biology", "chemistry", "maths"] as Subject[]).forEach(subj => {
        const mc = entry.subjects?.[subj]?.moduleContent ?? [];
        mc.forEach(id => {
          result[subj].add(id);
        });
      });
    });
    return result;
  }, [data]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Module Coverage</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Modules (and Pure topics for Maths) revised at least once across all logged sessions.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {subjectConfig.map(({ id, name, color }) => {
          const modules = ALL_MODULES[id];
          const done = modules.filter(m => coverage[id].has(m.id));
          const remaining = modules.filter(m => !coverage[id].has(m.id));
          const total = modules.length;
          const doneCount = done.length;
          const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

          const pieData =
            doneCount === 0
              ? [{ name: "Remaining", value: total }]
              : doneCount === total
              ? [{ name: "Completed", value: total }]
              : [
                  { name: "Completed", value: doneCount },
                  { name: "Remaining", value: remaining.length },
                ];

          const GREY = "hsl(var(--muted))";

          return (
            <div key={id} className="bg-card border rounded-xl p-6 shadow-sm flex flex-col gap-4" style={{ borderLeftWidth: 4, borderLeftColor: color }}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <h3 className="font-semibold text-base">{name}</h3>
              </div>

              <div className="flex items-center gap-6">
                {/* Donut chart */}
                <div className="relative shrink-0" style={{ width: 110, height: 110 }}>
                  <PieChart width={110} height={110}>
                    <Pie
                      data={pieData}
                      cx={50}
                      cy={50}
                      innerRadius={34}
                      outerRadius={50}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {pieData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.name === "Completed" ? color :
                            doneCount === 0 ? GREY : GREY
                          }
                        />
                      ))}
                    </Pie>
                  </PieChart>
                  {/* Centre label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-bold leading-none" style={{ color: doneCount === 0 ? "hsl(var(--muted-foreground))" : color }}>{pct}%</span>
                    <span className="text-[10px] text-muted-foreground leading-none mt-0.5">{doneCount}/{total}</span>
                  </div>
                </div>

                {/* Legend */}
                <div className="flex flex-col gap-2 text-sm min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-foreground font-medium">{doneCount} done</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: GREY }} />
                    <span className="text-muted-foreground">{remaining.length} remaining</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{total} {id === "maths" ? "Pure topics" : "modules"} total</div>
                </div>
              </div>

              {/* Remaining list (collapsed if all done) */}
              {remaining.length > 0 && (
                <div className="border-t pt-3 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Not yet covered</p>
                  <div className="flex flex-wrap gap-1.5">
                    {remaining.map(m => (
                      <span key={m.id} className="text-[11px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 leading-tight">
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {remaining.length === 0 && (
                <div className="border-t pt-3 text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}><polyline points="1.5,6 4.5,9 10.5,3" /></svg>
                  All modules covered!
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GRADE_BOUNDARIES: Record<Subject, {
  aStar: Record<string, number>;
  a: Record<string, number>;
}> = {
  biology: {
    aStar: { p1: 69, p2: 69, p3: 70, custom: (69 + 69 + 70) / 3 },
    a:     { p1: 59, p2: 60, p3: 60, custom: (59 + 60 + 60) / 3 }
  },
  chemistry: {
    aStar: { p1: 73.1, p2: 78, p3: 85, custom: (73.1 + 78 + 85) / 3 },
    a:     { p1: 64.5, p2: 64, p3: 68.3, custom: (64.5 + 64 + 68.3) / 3 }
  },
  maths: {
    aStar: { p1: 86, p2: 86, p3: 86, custom: 86 },
    a:     { p1: 71.3, p2: 71.3, p3: 71.3, custom: 71.3 }
  }
};

function getPaperKey(paper: string): string {
  if (paper === "Paper 1") return "p1";
  if (paper === "Paper 2") return "p2";
  if (paper.startsWith("Paper 3")) return "p3";
  return "custom";
}

function predictGrade(pct: number, paperKey: string, subject: Subject): string {
  const b = GRADE_BOUNDARIES[subject];
  const aStar = b.aStar[paperKey] ?? b.aStar.custom;
  const a = b.a[paperKey] ?? b.a.custom;
  if (pct >= aStar) return "A*";
  if (pct >= a) return "A";
  if (pct >= a - 2) return "B";
  return "Below B";
}

interface PaperStat {
  label: string;
  pct: number;
  marks: string;
  paper: string;
  paperKey: string;
  subject: Subject;
  colorVar: string;
  grade: string;
}

function PaperMarksSection({ data }: { data: ReturnType<typeof useRevisionData>["data"] }) {
  const subjects: { id: Subject; name: string; colorVar: string; color: string }[] = [
    { id: "biology",   name: "Biology (OCR A)",   colorVar: "--biology",   color: "hsl(var(--biology))" },
    { id: "chemistry", name: "Chemistry (OCR B)",  colorVar: "--chemistry", color: "hsl(var(--chemistry))" },
    { id: "maths",     name: "Maths (Edexcel)",    colorVar: "--maths",     color: "hsl(var(--maths))" }
  ];

  const papersBySubject = useMemo(() => {
    const result: Record<Subject, PaperStat[]> = { biology: [], chemistry: [], maths: [] };
    Object.entries(data).forEach(([, entry]) => {
      subjects.forEach(({ id, colorVar }) => {
        const recs = entry.subjects?.[id]?.examPaperRecords as ExamPaperRecord[] | undefined;
        if (!recs) return;
        recs.forEach(rec => {
          if (rec.marksObtained == null || !rec.totalMarks) return;
          const pct = Math.round((rec.marksObtained / rec.totalMarks) * 100);
          const label = rec.isCustom
            ? (rec.customLabel?.trim() || rec.paper)
            : `${rec.year} ${rec.paper}`;
          const paperKey = rec.isCustom ? getPaperKey(rec.paper) : getPaperKey(rec.paper);
          const grade = predictGrade(pct, paperKey, id);
          if (!result[id].find(p => p.label === label)) {
            result[id].push({ label, pct, marks: `${rec.marksObtained}/${rec.totalMarks}`, paper: rec.paper, paperKey, subject: id, colorVar, grade });
          }
        });
      });
    });
    return result;
  }, [data]);

  const hasAnyData = subjects.some(s => papersBySubject[s.id].length > 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Paper Marks Progress</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Scores across all completed exam papers with marks entered.</p>
      </div>

      {!hasAnyData && (
        <div className="bg-card border rounded-xl p-8 text-center text-muted-foreground text-sm">
          No paper marks recorded yet. Open a day entry, select <strong>Exam Paper Practice</strong>, check a year, and enter your marks.
        </div>
      )}

      {subjects.map(({ id, name, color, colorVar }) => {
        const papers = papersBySubject[id];
        if (papers.length === 0) return null;
        const avg = Math.round(papers.reduce((s, p) => s + p.pct, 0) / papers.length);

        return (
          <div key={id} className="bg-card border rounded-xl p-6 shadow-sm space-y-5" style={{ borderLeftWidth: 4, borderLeftColor: color }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <h3 className="font-semibold text-base">{name}</h3>
              </div>
              <span className="text-sm text-muted-foreground">Average: <strong className="text-foreground">{avg}%</strong> across {papers.length} paper{papers.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Bar chart */}
            <div style={{ height: Math.max(180, papers.length * 36) }} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={papers} layout="vertical" margin={{ top: 0, right: 50, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="label" width={130} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                  <RechartsTooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    formatter={(val: number, _: string, entry: any) => [`${val}% (${entry.payload.marks})`, "Score"]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))", fontSize: 12, boxShadow: "0 4px 12px -2px hsl(var(--foreground) / 0.15)" }}
                    labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                    itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                  />
                  <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {papers.map((p, i) => (
                      <Cell key={i} fill={
                        p.grade === "A*" ? "#f59e0b" :
                        p.grade === "A"  ? color :
                        p.grade === "B"  ? `hsl(var(${colorVar})/0.55)` :
                                           `hsl(var(${colorVar})/0.3)`
                      } />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Detail table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2 pr-4">Paper</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2 pr-4">Marks</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2 pr-4">Score</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2">Est. Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {papers.map((p, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4 text-foreground font-medium">{p.label}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{p.marks}</td>
                      <td className="py-2 pr-4 text-right">
                        <span className="font-semibold text-foreground">{p.pct}%</span>
                      </td>
                      <td className="py-2 text-right">
                        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${
                          p.grade === "A*" ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300" :
                          p.grade === "A"  ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300" :
                          p.grade === "B"  ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" :
                                             "bg-muted text-muted-foreground ring-1 ring-border"
                        }`}>
                          {p.grade}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SkelBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-secondary/60 ${className}`} />;
}

function StatsSkeleton() {
  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-10 space-y-10" data-testid="stats-skeleton">
      {/* Exam countdown */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <SkelBox key={i} className="h-28" />)}
      </div>
      {/* Streak card */}
      <div className="max-w-6xl mx-auto"><SkelBox className="h-32" /></div>
      {/* Subject balance */}
      <div className="max-w-6xl mx-auto space-y-3">
        <SkelBox className="h-6 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <SkelBox key={i} className="h-56" />)}
        </div>
      </div>
      {/* Heatmap */}
      <div className="max-w-6xl mx-auto space-y-3">
        <SkelBox className="h-6 w-72" />
        <SkelBox className="h-44" />
      </div>
      {/* Title row */}
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        <SkelBox className="h-10 w-72" />
        <SkelBox className="h-10 w-56" />
      </div>
      {/* Totals grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {[0, 1, 2].map(i => <SkelBox key={i} className="h-32" />)}
      </div>
      {/* Daily activity chart */}
      <div className="max-w-6xl mx-auto"><SkelBox className="h-[460px]" /></div>
      {/* Module coverage */}
      <div className="max-w-6xl mx-auto"><SkelBox className="h-80" /></div>
      {/* Paper marks */}
      <div className="max-w-6xl mx-auto"><SkelBox className="h-72" /></div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Water Stats Section
// ─────────────────────────────────────────────────────────────────────────────

function WaterStatsSection({ data }: { data: ReturnType<typeof useRevisionData>["data"] }) {
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const last30: number[] = [];
    const last14Days: { label: string; bottles: number }[] = [];

    for (let i = 29; i >= 0; i--) {
      const d = subDays(today, i);
      const key = format(d, "yyyy-MM-dd");
      const bottles = data[key]?.waterBottles ?? 0;
      last30.push(bottles);
      if (i < 14) {
        last14Days.push({ label: format(d, "d"), bottles });
      }
    }

    const loggedDays = last30.filter(b => b > 0);
    const avgBottles = loggedDays.length > 0
      ? loggedDays.reduce((a, b) => a + b, 0) / loggedDays.length
      : 0;
    const onTargetDays = last30.filter(b => b >= 3 && b <= 4).length;
    const totalLoggedDays = loggedDays.length;

    const todayKey = format(today, "yyyy-MM-dd");
    const todayBottles = data[todayKey]?.waterBottles ?? 0;

    return { avgBottles, onTargetDays, totalLoggedDays, last14Days, todayBottles };
  }, [data]);

  const bottleColor = (n: number) => {
    if (n === 0) return "hsl(var(--muted-foreground) / 0.25)";
    if (n < 3) return "hsl(38 95% 55%)";
    if (n <= 4) return "hsl(199 89% 48%)";
    return "hsl(199 89% 68%)";
  };

  const todayMessage = stats.todayBottles === 0
    ? "Not logged yet today"
    : stats.todayBottles < 3
    ? `${stats.todayBottles} bottle${stats.todayBottles === 1 ? "" : "s"} today — aim for 3–4`
    : stats.todayBottles <= 4
    ? `${stats.todayBottles} bottles today — right on target`
    : `${stats.todayBottles} bottles today — well hydrated`;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Hydration</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Water bottles tracked per day. 3–4 is the ideal daily target.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Today */}
        <div className="bg-card border rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-full grid place-items-center shrink-0"
            style={{ background: `${bottleColor(stats.todayBottles)}22` }}
          >
            <svg viewBox="0 0 14 20" className="w-6 h-9" style={{ fill: bottleColor(stats.todayBottles) }}>
              <path d="M4 2 L2 6 L2 16 Q2 18 7 18 Q12 18 12 16 L12 6 L10 2 Z" />
              <rect x="4.5" y="0" width="5" height="2.5" rx="0.8" />
            </svg>
          </div>
          <div>
            <p className="text-3xl font-bold" style={{ color: bottleColor(stats.todayBottles) }}>
              {stats.todayBottles > 0 ? stats.todayBottles : "–"}
            </p>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Today</p>
            <p className="text-xs text-muted-foreground mt-1">{todayMessage}</p>
          </div>
        </div>

        {/* 30-day average */}
        <div className="bg-card border rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-sky-500/10 shrink-0">
            <svg viewBox="0 0 14 20" className="w-6 h-9 fill-sky-500">
              <path d="M4 2 L2 6 L2 16 Q2 18 7 18 Q12 18 12 16 L12 6 L10 2 Z" />
              <rect x="4.5" y="0" width="5" height="2.5" rx="0.8" />
            </svg>
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground">
              {stats.avgBottles > 0 ? stats.avgBottles.toFixed(1) : "–"}
            </p>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Avg / logged day (30d)</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalLoggedDays > 0
                ? `Based on ${stats.totalLoggedDays} day${stats.totalLoggedDays === 1 ? "" : "s"} with data`
                : "No water data logged yet"}
            </p>
          </div>
        </div>

        {/* On-target days */}
        <div className="bg-card border rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-emerald-500/10">
            <svg viewBox="0 0 24 24" className="w-6 h-6 stroke-emerald-500 fill-none" strokeWidth={2}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground">{stats.onTargetDays}</p>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-0.5">On-target days (30d)</p>
            <p className="text-xs text-muted-foreground mt-1">Days with 3–4 bottles logged</p>
          </div>
        </div>
      </div>

      {/* Last 14 days mini chart */}
      <div className="bg-card border rounded-xl p-5 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Last 14 Days</p>
        <div className="flex items-end gap-1.5 h-20">
          {stats.last14Days.map(({ label, bottles }) => {
            const heightPct = bottles > 0 ? Math.max(12, (bottles / 6) * 100) : 4;
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-1" title={`${bottles} bottle${bottles === 1 ? "" : "s"}`}>
                <div
                  className="w-full rounded-t-sm transition-all"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: bottleColor(bottles),
                    opacity: bottles === 0 ? 0.3 : 1,
                  }}
                />
                <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "hsl(199 89% 48%)" }} />
            <span className="text-[10px] text-muted-foreground">3–4 (ideal)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "hsl(38 95% 55%)" }} />
            <span className="text-[10px] text-muted-foreground">1–2 (low)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "hsl(199 89% 68%)" }} />
            <span className="text-[10px] text-muted-foreground">5–6 (great)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const { user, isLoading: authLoading, login } = useAuthContext();
  const { data, syncing, synced } = useRevisionData(user);
  const isInitialLoading = !!user && syncing && !synced;
  const todos = useTodos();
  const todayCompletedBonus = useMemo(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const count = todos.filter(t =>
      t.completed && t.completedAt && t.completedAt.startsWith(todayStr)
    ).length;
    return count * 0.5;
  }, [todos]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    // Stats only covers Apr–Jun 2026. Snap to current month when in range, otherwise April 2026.
    if (now.getFullYear() === 2026 && now.getMonth() >= 3 && now.getMonth() <= 5) {
      return new Date(2026, now.getMonth(), 1);
    }
    return new Date(2026, 3, 1);
  });

  const monthData = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = endOfMonth(selectedMonth);
    const days = eachDayOfInterval({ start, end });

    let bioTotal = 0;
    let chemTotal = 0;
    let mathsTotal = 0;
    let bioProd = 0;
    let chemProd = 0;
    let mathsProd = 0;
    let bioCount = 0;
    let chemCount = 0;
    let mathsCount = 0;

    const round1 = (n: number) => Math.round(n * 10) / 10;

    const dailyData = days.map(day => {
      const dateStr = format(day, "yyyy-MM-dd");
      const entry = data[dateStr];

      // Read every signal each subject contains via the shared helper:
      // tags, mixed-exercises bonus, modules, papers (with completion/marks),
      // anki sessions+hours (biology-weighted), notes ("completed" mentions),
      // and productivity rating.
      const bioScore = subjectActivityScore(entry?.subjects?.biology, "biology");
      const chemScore = subjectActivityScore(entry?.subjects?.chemistry, "chemistry");
      const mathsScore = subjectActivityScore(entry?.subjects?.maths, "maths");

      // Active-day rollup uses the richer "anything logged" definition so that
      // notes-only days still count.
      if (subjectIsActive(entry?.subjects?.biology)) {
        bioTotal++;
        bioProd += entry?.subjects?.biology?.productivity ?? 0;
        bioCount++;
      }
      if (subjectIsActive(entry?.subjects?.chemistry)) {
        chemTotal++;
        chemProd += entry?.subjects?.chemistry?.productivity ?? 0;
        chemCount++;
      }
      if (subjectIsActive(entry?.subjects?.maths)) {
        mathsTotal++;
        mathsProd += entry?.subjects?.maths?.productivity ?? 0;
        mathsCount++;
      }

      // Apply the day-level urgency multiplier so that effort closer to an
      // exam visibly pushes the bars up. General notes are added once to the
      // visually-largest stack so they're not invisible on otherwise-empty days.
      const urgency = dayUrgencyMultiplier(dateStr);
      const general = notesScore(entry?.notes);
      let bio = bioScore * urgency;
      let chem = chemScore * urgency;
      let maths = mathsScore * urgency;
      if (general > 0) {
        const max = Math.max(bio, chem, maths, 0);
        if (max === bio) bio += general * urgency;
        else if (max === chem) chem += general * urgency;
        else maths += general * urgency;
      }

      return {
        name: format(day, "d MMM"),
        biology: round1(bio),
        chemistry: round1(chem),
        maths: round1(maths),
      };
    });

    const totalStats = [
      { name: "Biology", sessions: bioTotal, avgProd: bioCount > 0 ? (bioProd / bioCount).toFixed(1) : 0, fill: "hsl(var(--biology))" },
      { name: "Chemistry", sessions: chemTotal, avgProd: chemCount > 0 ? (chemProd / chemCount).toFixed(1) : 0, fill: "hsl(var(--chemistry))" },
      { name: "Maths", sessions: mathsTotal, avgProd: mathsCount > 0 ? (mathsProd / mathsCount).toFixed(1) : 0, fill: "hsl(var(--maths))" },
    ];

    return { dailyData, totalStats };
  }, [selectedMonth, data]);

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
    );
  }
  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <BarChart3 className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-bold">Sign in to view Stats</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Statistics are calculated from your revision history stored in your account, so you can see your progress across devices.
        </p>
        <Button onClick={login}>Sign in</Button>
      </div>
    );
  }
  if (isInitialLoading) {
    return <StatsSkeleton />;
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-10 space-y-10">
      <ExamCountdown />

      <StreakCard data={data} />

      <SubjectBalanceSection data={data} />

      <ThreeMonthHeatmap data={data} todayBonus={todayCompletedBonus} />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Revision Statistics</h1>
          <p className="text-muted-foreground mt-1">Track your progress and maintain your momentum.</p>
        </div>
        
        <div className="flex bg-secondary p-1 rounded-lg">
          {[3, 4, 5].map((monthIndex) => {
            const date = new Date(2026, monthIndex, 1);
            const isSelected = selectedMonth.getMonth() === monthIndex;
            return (
              <button
                key={monthIndex}
                onClick={() => setSelectedMonth(date)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isSelected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {format(date, "MMMM")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {monthData.totalStats.map(stat => (
          <div key={stat.name} className="bg-card border rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: stat.fill }} />
              <h3 className="font-semibold text-lg">{stat.name}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-3xl font-bold">{stat.sessions}</p>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider mt-1">Active Days</p>
              </div>
              <div>
                <p className="text-3xl font-bold">{stat.avgProd}</p>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider mt-1">Avg Focus</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-6xl mx-auto bg-card border rounded-xl p-6 shadow-sm" id="daily-activity">
        <h3 className="font-semibold text-lg mb-6">Daily Activity ({format(selectedMonth, "MMMM")})</h3>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={monthData.dailyData}
              margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="name" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                dy={10}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                allowDecimals={false}
              />
              <RechartsTooltip 
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', boxShadow: '0 4px 12px -2px hsl(var(--foreground) / 0.15)' }}
                labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Bar dataKey="biology" name="Biology" stackId="a" fill="hsl(var(--biology))" radius={[0, 0, 0, 0]} />
              <Bar dataKey="chemistry" name="Chemistry" stackId="a" fill="hsl(var(--chemistry))" radius={[0, 0, 0, 0]} />
              <Bar dataKey="maths" name="Maths" stackId="a" fill="hsl(var(--maths))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <ModuleCoverageSection data={data} />

      <PaperMarksSection data={data} />

      <FlashcardsStatsSection user={user} />

      <WaterStatsSection data={data} />
    </div>
  );
}
