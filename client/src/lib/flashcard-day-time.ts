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
 * Biology decks: if the deck name begins with an OCR A Biology submodule code
 * (e.g. "5.1.1", "3.1.2") the session is linked to that exact topic so it
 * shows up correctly in the productivity log subtopic breakdown.
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

// All valid OCR A Biology submodule IDs from the productivity log.
const VALID_BIO_TOPIC_IDS = new Set([
  "3.1.1","3.1.2","3.1.3",
  "4.1.1","4.2.1","4.2.2",
  "5.1.1","5.1.2","5.1.3","5.1.4","5.1.5",
  "5.2.1","5.2.2",
  "6.1.1","6.1.2","6.1.3",
  "6.2.1","6.3.1","6.3.2",
]);

/**
 * Extract a biology submodule topic ID from a deck name if one is present.
 * Deck names like "5.1.1 Communication and homeostasis" yield "5.1.1".
 * Returns null when no valid topic code is found.
 */
function extractBioTopicId(deckName: string): string | null {
  const m = deckName.trim().match(/^(\d+\.\d+\.\d+)/);
  if (!m) return null;
  return VALID_BIO_TOPIC_IDS.has(m[1]) ? m[1] : null;
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
  deckId: string;
  deckSubject: string;
  deckName?: string;
  totalSessionMs: number;
  loggedIn: boolean;
}): void {
  const subject = SUBJECT_MAP[opts.deckSubject];
  if (!subject) return; // misc / unknown subjects don't contribute.
  if (opts.totalSessionMs <= 0) return;

  const date = todayKey();
  const sessionId = `flashcard-auto-${opts.deckId}`;
  const hours = opts.totalSessionMs / 3_600_000;

  // Determine the topicId for biology decks — attempt to match the deck name
  // to a known submodule code, falling back to "auto-flashcards".
  let defaultTopicId = "auto-flashcards";
  if (subject === "biology" && opts.deckName) {
    const extracted = extractBioTopicId(opts.deckName);
    if (extracted) defaultTopicId = extracted;
  }

  const all = readAll();
  const day: DayEntry = all[date] ?? { date, subjects: {} };
  const subjEntry: SubjectEntry =
    day.subjects[subject] ?? { types: [], productivity: 0 };

  // Upsert the auto session for this deck.
  const sessions = subjEntry.ankiSessions ? [...subjEntry.ankiSessions] : [];
  const idx = sessions.findIndex((s) => s.id === sessionId);

  // If the existing record already has a user-chosen topicId, preserve it.
  // Otherwise use the extracted/default one.
  const topicId =
    idx >= 0 && sessions[idx].topicId !== "auto-flashcards"
      ? sessions[idx].topicId
      : defaultTopicId;

  const next: AnkiSessionRecord = {
    id: sessionId,
    topicId,
    hours: Math.max(hours, idx >= 0 ? Math.max(sessions[idx].hours, hours) : hours),
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
