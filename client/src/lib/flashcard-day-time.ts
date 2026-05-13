/**
 * Adds time spent in a flashcard study session to today's revision entry so
 * it counts toward the day's productivity score.
 *
 * Mechanism: per (deckId × calendar day) we keep a single auto-generated
 * `AnkiSessionRecord` whose id is stable (`flashcard-auto-<deckId>`). Each
 * call to `recordFlashcardStudyTime` overwrites that record's `hours` with
 * the cumulative session total, and ensures the subject has the
 * `anki_flashcards` revision type tagged.
 *
 * We update the localStorage cache (so calendar/stats reflect it on next
 * mount) and PUT to the server in one go. The push is fire-and-forget; if
 * the user is offline the local cache is still correct.
 */

const STORAGE_KEY = "revision_tracker_data";

type Subject = "biology" | "chemistry" | "maths";
type RevisionType =
  | "module_content"
  | "exam_practice"
  | "past_paper"
  | "mixed_exercises"
  | "anki_flashcards"
  | "day_event";

interface AnkiSessionRecord {
  id: string;
  topicId: string;
  hours: number;
}

interface SubjectEntry {
  types: RevisionType[];
  productivity: number;
  events?: string[];
  moduleContent?: string[];
  examPaperRecords?: unknown[];
  ankiSessions?: AnkiSessionRecord[];
  notes?: string;
}

interface DayEntry {
  date: string;
  subjects: Partial<Record<Subject, SubjectEntry>>;
  notes?: string;
}

type RevisionData = Record<string, DayEntry>;

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readAll(): RevisionData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as RevisionData;
  } catch {}
  return {};
}

function writeAll(data: RevisionData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

const SUBJECT_MAP: Record<string, Subject | null> = {
  biology: "biology",
  chemistry: "chemistry",
  maths: "maths",
  miscellaneous: null,
};

export function recordFlashcardStudyTime(opts: {
  deckId: string;
  deckSubject: string;
  deckTopicId?: string;
  totalSessionMs: number;
  loggedIn: boolean;
}): void {
  const subject = SUBJECT_MAP[opts.deckSubject];
  if (!subject) return; // misc / unknown subjects don't contribute.
  if (opts.totalSessionMs <= 0) return;

  const date = todayKey();
  const sessionId = `flashcard-auto-${opts.deckId}`;
  const hours = opts.totalSessionMs / 3_600_000;
  const topicId = opts.deckTopicId && opts.deckSubject === "biology"
    ? opts.deckTopicId
    : "auto-flashcards";

  const all = readAll();
  const day: DayEntry = all[date] ?? { date, subjects: {} };
  const subjEntry: SubjectEntry =
    day.subjects[subject] ?? { types: [], productivity: 0, events: [] };

  // Upsert the auto session for this deck.
  const sessions = subjEntry.ankiSessions ? [...subjEntry.ankiSessions] : [];
  const idx = sessions.findIndex((s) => s.id === sessionId);
  const next: AnkiSessionRecord = {
    id: sessionId,
    topicId: idx >= 0 ? sessions[idx].topicId : topicId,
    hours: Math.max(hours, idx >= 0 ? Math.max(sessions[idx].hours, hours) : hours),
  };
  if (idx >= 0) sessions[idx] = next; else sessions.push(next);

  const types = new Set<RevisionType>(subjEntry.types ?? []);
  types.add("anki_flashcards");

  const updatedSubject: SubjectEntry = {
    ...subjEntry,
    types: Array.from(types),
    ankiSessions: sessions,
    events: Array.from(new Set([...(subjEntry.events ?? []), `flashcard:${opts.deckId}:${topicId}:${hours.toFixed(2)}`])),
  };
  const updatedDay: DayEntry = {
    ...day,
    date,
    subjects: { ...day.subjects, [subject]: updatedSubject },
  };
  all[date] = updatedDay;
  writeAll(all);

  if (opts.loggedIn) {
    fetch(`/api/revision/${date}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: updatedDay }),
    }).catch(() => {
      /* fire-and-forget; localStorage is already updated */
    });
  }
}
