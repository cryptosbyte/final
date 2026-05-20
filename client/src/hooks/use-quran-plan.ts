import { useState, useCallback } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";

export const QURAN_TOTAL_PAGES = 604;
const STORAGE_KEY = "quran_khatm_plan";

export interface QuranPlan {
  id: string;
  startDate: string;
  totalDays: number;
  pagesPerDay: number;
  completedDates: string[];
  dailyPages: Record<string, number>;
  completedAt?: string;
}

// ─── Surah page-start map (Madani mushaf, 604 pages) ─────────────────────────
const SURAHS: [number, string, number][] = [
  [1,"Al-Fatiha",1],[2,"Al-Baqarah",2],[3,"Ali 'Imran",50],[4,"An-Nisa",77],
  [5,"Al-Ma'idah",106],[6,"Al-An'am",128],[7,"Al-A'raf",151],[8,"Al-Anfal",177],
  [9,"At-Tawbah",187],[10,"Yunus",208],[11,"Hud",221],[12,"Yusuf",235],
  [13,"Ar-Ra'd",249],[14,"Ibrahim",255],[15,"Al-Hijr",262],[16,"An-Nahl",267],
  [17,"Al-Isra",282],[18,"Al-Kahf",293],[19,"Maryam",305],[20,"Ta-Ha",312],
  [21,"Al-Anbiya",322],[22,"Al-Hajj",332],[23,"Al-Mu'minun",342],[24,"An-Nur",350],
  [25,"Al-Furqan",359],[26,"Ash-Shu'ara",367],[27,"An-Naml",377],[28,"Al-Qasas",385],
  [29,"Al-Ankabut",396],[30,"Ar-Rum",404],[31,"Luqman",411],[32,"As-Sajdah",415],
  [33,"Al-Ahzab",418],[34,"Saba",428],[35,"Fatir",434],[36,"Ya-Sin",440],
  [37,"As-Saffat",446],[38,"Sad",453],[39,"Az-Zumar",459],[40,"Ghafir",467],
  [41,"Fussilat",477],[42,"Ash-Shura",483],[43,"Az-Zukhruf",489],[44,"Ad-Dukhan",496],
  [45,"Al-Jathiyah",499],[46,"Al-Ahqaf",502],[47,"Muhammad",507],[48,"Al-Fath",511],
  [49,"Al-Hujurat",515],[50,"Qaf",518],[51,"Adh-Dhariyat",520],[52,"At-Tur",523],
  [53,"An-Najm",526],[54,"Al-Qamar",528],[55,"Ar-Rahman",531],[56,"Al-Waqi'ah",534],
  [57,"Al-Hadid",537],[58,"Al-Mujadila",542],[59,"Al-Hashr",545],[60,"Al-Mumtahanah",549],
  [61,"As-Saf",551],[62,"Al-Jumu'ah",553],[63,"Al-Munafiqun",554],[64,"At-Taghabun",556],
  [65,"At-Talaq",558],[66,"At-Tahrim",560],[67,"Al-Mulk",562],[68,"Al-Qalam",564],
  [69,"Al-Haqqah",566],[70,"Al-Ma'arij",568],[71,"Nuh",570],[72,"Al-Jinn",572],
  [73,"Al-Muzzammil",574],[74,"Al-Muddaththir",575],[75,"Al-Qiyamah",577],
  [76,"Al-Insan",578],[77,"Al-Mursalat",580],[78,"An-Naba",582],[79,"An-Nazi'at",583],
  [80,"Abasa",585],[81,"At-Takwir",586],[82,"Al-Infitar",587],[83,"Al-Mutaffifin",587],
  [84,"Al-Inshiqaq",589],[85,"Al-Buruj",590],[86,"At-Tariq",591],[87,"Al-A'la",591],
  [88,"Al-Ghashiyah",592],[89,"Al-Fajr",593],[90,"Al-Balad",594],[91,"Ash-Shams",595],
  [92,"Al-Layl",595],[93,"Ad-Duha",596],[94,"Ash-Sharh",596],[95,"At-Tin",597],
  [96,"Al-Alaq",597],[97,"Al-Qadr",598],[98,"Al-Bayyinah",598],[99,"Az-Zalzalah",599],
  [100,"Al-Adiyat",599],[101,"Al-Qari'ah",600],[102,"At-Takathur",600],[103,"Al-Asr",601],
  [104,"Al-Humazah",601],[105,"Al-Fil",601],[106,"Quraysh",602],[107,"Al-Ma'un",602],
  [108,"Al-Kawthar",602],[109,"Al-Kafirun",603],[110,"An-Nasr",603],[111,"Al-Masad",603],
  [112,"Al-Ikhlas",604],[113,"Al-Falaq",604],[114,"An-Nas",604],
];

/** Returns "Surah A – Surah B" or "Surah A" for a given page range. */
export function getSurahsForPageRange(startPage: number, endPage: number): string {
  const sp = Math.max(1, Math.min(startPage, QURAN_TOTAL_PAGES));
  const ep = Math.max(1, Math.min(endPage, QURAN_TOTAL_PAGES));
  const inRange = SURAHS.filter(([, , pg]) => pg >= sp && pg <= ep);
  const firstCandidates = SURAHS.filter(([, , pg]) => pg <= sp);
  const first = firstCandidates[firstCandidates.length - 1];
  const names: string[] = [];
  if (first && !inRange.find(([n]) => n === first[0])) names.push(first[1]);
  inRange.forEach(([, name]) => { if (!names.includes(name)) names.push(name); });
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} – ${names[1]}`;
  return `${names[0]} – ${names[names.length - 1]}`;
}

// ─── Pages-due calculation ────────────────────────────────────────────────────

/** Total pages actually read across all logged days. */
export function getTotalPagesRead(plan: QuranPlan): number {
  const fromDailyPages = Object.values(plan.dailyPages ?? {}).reduce((sum, p) => sum + p, 0);
  // Backward-compat: completedDates entries that have no dailyPages entry
  const legacyDates = (plan.completedDates ?? []).filter(d => !(plan.dailyPages ?? {})[d]);
  const fromLegacy = legacyDates.length * plan.pagesPerDay;
  return Math.min(QURAN_TOTAL_PAGES, fromDailyPages + fromLegacy);
}

/**
 * Returns the recommended pages for `dateStr` dynamically, recalculating
 * based on how many pages remain and how many days are left.
 */
export function getPagesForDate(plan: QuranPlan, dateStr: string): number {
  const startDate = parseISO(plan.startDate);
  const date = parseISO(dateStr);
  const dayIndex = differenceInCalendarDays(date, startDate) + 1;
  if (dayIndex < 1 || dayIndex > plan.totalDays) return 0;

  const totalRead = getTotalPagesRead(plan);
  const remaining = Math.max(0, QURAN_TOTAL_PAGES - totalRead);
  if (remaining === 0) return 0;

  // Has today already been logged?
  const todayLogged = (plan.dailyPages ?? {})[dateStr] !== undefined ||
    (plan.completedDates ?? []).includes(dateStr);
  if (todayLogged) return 0;

  // Days left including today
  const daysLeft = Math.max(1, plan.totalDays - dayIndex + 1);
  return Math.ceil(remaining / daysLeft);
}

/**
 * Returns the page range that SHOULD be read on `dateStr`.
 */
export function getPageRangeForDate(plan: QuranPlan, dateStr: string): { start: number; end: number } | null {
  const pages = getPagesForDate(plan, dateStr);
  if (pages === 0) return null;
  const totalRead = getTotalPagesRead(plan);
  const startPage = totalRead + 1;
  const endPage = Math.min(startPage + pages - 1, QURAN_TOTAL_PAGES);
  return { start: startPage, end: endPage };
}

/** Progress stats for the entire plan. */
export function getPlanProgress(plan: QuranPlan) {
  const pagesRead = getTotalPagesRead(plan);
  const pctComplete = Math.min(100, Math.round((pagesRead / QURAN_TOTAL_PAGES) * 100));
  const isKhatmDone = !!plan.completedAt;

  // Total days with any reading logged
  const allLoggedDates = new Set([
    ...(plan.completedDates ?? []),
    ...Object.keys(plan.dailyPages ?? {}),
  ]);
  const totalCompleted = allLoggedDates.size;

  // Current streak: consecutive dates with reading up to today
  const sorted = [...allLoggedDates].sort();
  let streak = 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  let cursor = todayStr;
  while (sorted.includes(cursor)) {
    streak++;
    const d = new Date(cursor);
    d.setDate(d.getDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return { totalCompleted, pagesRead, pctComplete, isKhatmDone, streak };
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadPlan(): QuranPlan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as QuranPlan;
      // Migrate old plans that have no dailyPages field
      if (!p.dailyPages) p.dailyPages = {};
      return p;
    }
  } catch { /* ignore */ }
  return null;
}

function savePlan(plan: QuranPlan | null) {
  try {
    if (plan) localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQuranPlan() {
  const [plan, setPlan] = useState<QuranPlan | null>(loadPlan);

  const createPlan = useCallback((startDate: string, totalDays: number) => {
    const newPlan: QuranPlan = {
      id: Date.now().toString(),
      startDate,
      totalDays,
      pagesPerDay: Math.ceil(QURAN_TOTAL_PAGES / totalDays),
      completedDates: [],
      dailyPages: {},
    };
    savePlan(newPlan);
    setPlan(newPlan);
  }, []);

  /** Log `pagesRead` for a given date. If omitted, uses the dynamic daily target. */
  const markDone = useCallback((dateStr: string, pagesRead?: number) => {
    const current = loadPlan();
    if (!current) return;

    // Calculate how many pages to log if not provided
    const pages = pagesRead ?? getPagesForDate(current, dateStr);

    const newDailyPages = { ...(current.dailyPages ?? {}), [dateStr]: pages };
    // Also keep completedDates in sync for backward compat
    const newDates = [...new Set([...(current.completedDates ?? []), dateStr])].sort();

    const totalRead = Math.min(
      QURAN_TOTAL_PAGES,
      Object.values(newDailyPages).reduce((s, p) => s + p, 0) +
        (current.completedDates ?? []).filter(d => !newDailyPages[d]).length * current.pagesPerDay,
    );
    const isKhatm = totalRead >= QURAN_TOTAL_PAGES || newDates.length >= current.totalDays;

    const updated: QuranPlan = {
      ...current,
      completedDates: newDates,
      dailyPages: newDailyPages,
      completedAt: isKhatm && !current.completedAt ? dateStr : current.completedAt,
    };
    savePlan(updated);
    setPlan(updated);

    if (isKhatm && !current.completedAt) {
      window.dispatchEvent(new CustomEvent("quran-khatm-complete", { detail: { plan: updated } }));
    } else {
      window.dispatchEvent(new CustomEvent("quran-day-complete", {
        detail: { dayNum: newDates.length, date: dateStr },
      }));
    }
  }, []);

  const unmarkDone = useCallback((dateStr: string) => {
    const current = loadPlan();
    if (!current) return;
    const newDailyPages = { ...(current.dailyPages ?? {}) };
    delete newDailyPages[dateStr];
    const updated: QuranPlan = {
      ...current,
      completedDates: (current.completedDates ?? []).filter(d => d !== dateStr),
      dailyPages: newDailyPages,
      completedAt: undefined,
    };
    savePlan(updated);
    setPlan(updated);
  }, []);

  const deletePlan = useCallback(() => {
    savePlan(null);
    setPlan(null);
  }, []);

  return { plan, createPlan, markDone, unmarkDone, deletePlan };
}
