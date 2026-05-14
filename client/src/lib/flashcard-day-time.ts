/**
 * Adds time spent in a flashcard study session to today's revision entry so
 * it counts toward the day's productivity score.
 *
 * Each call upserts a single `AnkiSessionRecord` whose id is `sessionKey`.
 * Callers are responsible for resolving the correct topicId and sessionKey
 * before calling this function — typically by inspecting the card's own
 * subdeck name so that studying a parent deck ("Module 5") still logs time
 * under the correct leaf topic ("5.1.2", "5.2.1", etc.).
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
  | "anki_flashcards";

interface AnkiSessionRecord {
  id: string;
  topicId: string;
  hours: number;
}

interface SubjectEntry {
  types: RevisionType[];
  productivity: number;
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

// All valid OCR A Biology submodule IDs used in the productivity log.
export const VALID_BIO_TOPIC_IDS = new Set([
  "3.1.1","3.1.2","3.1.3",
  "4.1.1","4.2.1","4.2.2",
  "5.1.1","5.1.2","5.1.3","5.1.4","5.1.5",
  "5.2.1","5.2.2",
  "6.1.1","6.1.2","6.1.3",
  "6.2.1","6.3.1","6.3.2",
]);

/**
 * Extract a biology submodule topic ID from a deck name if one is present.
 * e.g. "5.1.2 Excretion as an example of homeostatic control" → "5.1.2"
 * Returns null when no valid OCR A topic code is found at the start.
 */
export function extractBioTopicId(deckName: string): string | null {
  const m = deckName.trim().match(/^(\d+\.\d+\.\d+)/);
  if (!m) return null;
  return VALID_BIO_TOPIC_IDS.has(m[1]!) ? m[1]! : null;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
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
  /**
   * The subject of the deck ("biology" | "chemistry" | "maths" | "miscellaneous").
   */
  deckSubject: string;
  /**
   * The resolved biology topic ID (e.g. "5.1.2") or "auto-flashcards" when
   * the subdeck name does not start with a recognised module code.
   * For non-biology subjects this field is ignored; callers may pass anything.
   */
  topicId: string;
  /**
   * Stable unique key for the AnkiSessionRecord being upserted.
   * Use "flashcard-auto-<topicId>" for biology, "flashcard-auto-<deckId>"
   * for other subjects, so that different review sessions on the same topic
   * always accumulate into the same record.
   */
  sessionKey: string;
  totalSessionMs: number;
  loggedIn: boolean;
}): void {
  const subject = SUBJECT_MAP[opts.deckSubject];
  if (!subject) return; // misc / unknown subjects don't contribute.
  if (opts.totalSessionMs <= 0) return;

  const date = todayKey();
  const hours = opts.totalSessionMs / 3_600_000;

  const all = readAll();
  const day: DayEntry = all[date] ?? { date, subjects: {} };
  const subjEntry: SubjectEntry =
    day.subjects[subject] ?? { types: [], productivity: 0 };

  const sessions = subjEntry.ankiSessions ? [...subjEntry.ankiSessions] : [];
  const idx = sessions.findIndex((s) => s.id === opts.sessionKey);

  const topicId = subject === "biology" ? opts.topicId : opts.topicId;

  const next: AnkiSessionRecord = {
    id: opts.sessionKey,
    topicId,
    hours: Math.max(hours, idx >= 0 ? Math.max(sessions[idx]!.hours, hours) : hours),
  };
  if (idx >= 0) sessions[idx] = next; else sessions.push(next);

  const types = new Set<RevisionType>(subjEntry.types ?? []);
  types.add("anki_flashcards");

  const updatedSubject: SubjectEntry = {
    ...subjEntry,
    types: Array.from(types),
    ankiSessions: sessions,
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
