import type { DayEntry, SubjectEntry, Subject } from "@/hooks/use-revision-data";

// ─────────────────────────────────────────────────────────────────────────────
// Estimated study hours
//
// The tracker never asks for an explicit "hours" figure (except for Anki
// sessions), so we infer a sensible estimate from the volume of work logged on
// a day. The model is intentionally grounded in real workload, not the abstract
// activity score used elsewhere for streaks/heatmaps:
//
//   • Anki sessions contribute their explicitly logged hours.
//   • Each module/topic ticked under moduleContent ≈ 0.5h of content revision.
//   • Each exam paper record ≈ 1.25h (a paper / long section), +0.25h when it
//     is marked completed (you sat the whole thing).
//   • Any revision activity tag that isn't already represented by the concrete
//     signals above (e.g. "mixed_exercises" with nothing else logged) adds a
//     0.75h base so a logged session always counts for something.
//   • If a subject was opened (productivity rated) but carries no other signal,
//     it floors at 0.5h.
//
// Returned values are raw (unrounded) so callers can sum accurately and round
// once for display via formatHours().
// ─────────────────────────────────────────────────────────────────────────────

export function estimateSubjectHours(entry: SubjectEntry | undefined): number {
  if (!entry) return 0;
  let h = 0;

  if (entry.ankiSessions && entry.ankiSessions.length > 0) {
    for (const a of entry.ankiSessions) {
      if (Number.isFinite(a.hours)) h += Math.max(0, a.hours);
    }
  }

  if (entry.moduleContent && entry.moduleContent.length > 0) {
    h += 0.5 * entry.moduleContent.length;
  }

  if (entry.examPaperRecords && entry.examPaperRecords.length > 0) {
    for (const r of entry.examPaperRecords) {
      h += 1.25;
      if (r.completed) h += 0.25;
    }
  }

  // Base hours for activity tags not already quantified by the signals above.
  const covered = new Set<string>();
  if (entry.ankiSessions && entry.ankiSessions.length > 0) {
    covered.add("anki_flashcards");
  }
  if (entry.moduleContent && entry.moduleContent.length > 0) {
    covered.add("module_content");
  }
  if (entry.examPaperRecords && entry.examPaperRecords.length > 0) {
    covered.add("past_paper");
    covered.add("exam_practice");
  }
  for (const t of entry.types) {
    if (!covered.has(t)) h += 0.75;
  }

  if (h === 0 && entry.productivity > 0) h = 0.5;

  return h;
}

export function estimateDayHours(entry: DayEntry | undefined): number {
  if (!entry) return 0;
  return (["biology", "chemistry", "maths"] as Subject[]).reduce(
    (acc, s) => acc + estimateSubjectHours(entry.subjects?.[s]),
    0,
  );
}

// Round to the nearest half-hour and render compactly: "3h", "3.5h".
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded}h`;
}
