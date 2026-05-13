import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/api-client";

export interface FlashcardDayStat {
  dateKey: string;
  reviews: number;
  durationMs: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export type FlashcardStatsByDate = Record<string, FlashcardDayStat>;

/**
 * Fetch aggregated flashcard review stats keyed by local date. Used by
 * the Stats page and Calendar / day-entry views to fold flashcard activity
 * into the same daily timeline as revision sessions. Re-fetches on a
 * `revision-tracker-flashcards-changed` window event so the UI updates
 * immediately after a study session.
 */
export function useFlashcardDailyStats(user: AuthUser | null) {
  const [stats, setStats] = useState<FlashcardStatsByDate>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setStats({});
        setLoaded(true);
        return;
      }
      try {
        const res = await fetch("/api/flashcards/daily-stats", { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { days: FlashcardDayStat[] };
        if (cancelled) return;
        const map: FlashcardStatsByDate = {};
        for (const d of json.days) map[d.dateKey] = d;
        setStats(map);
      } catch {
        if (!cancelled) setStats({});
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    function onChange() { load(); }
    window.addEventListener("revision-tracker-flashcards-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("revision-tracker-flashcards-changed", onChange);
    };
  }, [user]);

  return { stats, loaded };
}
