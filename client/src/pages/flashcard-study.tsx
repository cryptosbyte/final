import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, CheckCircle2, Edit3, Pause, Play, RotateCw, Smartphone, Sparkles, Undo2, X } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/lib/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { MarkdownEditor, MarkdownPreview } from "@/components/markdown-editor";
import { renderCloze } from "@/lib/cloze";
import { recordFlashcardStudyTime, extractBioTopicId } from "@/lib/flashcard-day-time";
import { buildFillTokens, checkAnswer, type FillToken } from "@/lib/fill-blanks";
import { encodeForWaf } from "@/lib/b64-payload";

interface Card {
  id: string;
  deckId: string;
  type: "basic" | "cloze";
  front: string;
  back: string;
  reps: number;
  lapses: number;
  ease: number;
  interval: number;
  dueAt: string;
}

interface ReviewHistoryEntry {
  card: Card;
  queueLength: number;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const RATING_LABELS = [
  { rating: 1, label: "Again", hint: "Forgot — show in ~10m", color: "bg-red-500 hover:bg-red-600", key: "1" },
  { rating: 2, label: "Hard",  hint: "Recalled with effort",  color: "bg-orange-500 hover:bg-orange-600", key: "2" },
  { rating: 3, label: "Good",  hint: "Recalled correctly",     color: "bg-emerald-500 hover:bg-emerald-600", key: "3" },
  { rating: 4, label: "Easy",  hint: "Trivially easy",         color: "bg-blue-500 hover:bg-blue-600", key: "4" },
] as const;

function readFillBlanksMode(): boolean {
  try { return localStorage.getItem("revision_tracker_fill_blanks_mode") === "1"; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Priority persistence — "again" and "hard" cards are stored per deck so the
// next study session loads them first.
// ---------------------------------------------------------------------------
const PRIORITY_KEY = (deckId: string) => `rt_fc_priority_${deckId}`;

interface DeckPriority { again: string[]; hard: string[] }

function readPriority(deckId: string): DeckPriority {
  try {
    const raw = localStorage.getItem(PRIORITY_KEY(deckId));
    if (raw) return JSON.parse(raw) as DeckPriority;
  } catch { /* ignore */ }
  return { again: [], hard: [] };
}

function writePriority(deckId: string, p: DeckPriority) {
  try { localStorage.setItem(PRIORITY_KEY(deckId), JSON.stringify(p)); } catch { /* ignore */ }
}

function addAgainPriority(deckId: string, cardId: string) {
  const p = readPriority(deckId);
  if (!p.again.includes(cardId)) p.again = [cardId, ...p.again];
  p.hard = p.hard.filter(id => id !== cardId);
  writePriority(deckId, p);
}

function addHardPriority(deckId: string, cardId: string) {
  const p = readPriority(deckId);
  if (p.again.includes(cardId)) return;
  if (!p.hard.includes(cardId)) p.hard = [cardId, ...p.hard];
  writePriority(deckId, p);
}

function clearCardPriority(deckId: string, cardId: string) {
  const p = readPriority(deckId);
  p.again = p.again.filter(id => id !== cardId);
  p.hard = p.hard.filter(id => id !== cardId);
  writePriority(deckId, p);
}

function sortByPriority(cards: Card[], deckId: string): Card[] {
  const { again, hard } = readPriority(deckId);
  const againSet = new Set(again);
  const hardSet = new Set(hard);
  const tier = (c: Card) => againSet.has(c.id) ? 0 : hardSet.has(c.id) ? 1 : 2;
  return [...cards].sort((a, b) => tier(a) - tier(b));
}

// ---------------------------------------------------------------------------
// FillBlanksView
// ---------------------------------------------------------------------------
function FillBlanksView({
  tokens,
  inputs,
  checked,
  results,
  onChange,
}: {
  tokens: FillToken[];
  inputs: string[];
  checked: boolean;
  results: boolean[];
  onChange: (idx: number, val: string) => void;
}) {
  return (
    <div className="leading-loose text-base text-foreground whitespace-pre-wrap font-normal">
      {tokens.map((t, i) => {
        if (t.type === "text") {
          return <span key={i}>{t.value}</span>;
        }
        const val = inputs[t.blankIndex] ?? "";
        const correct = checked ? results[t.blankIndex] : undefined;
        return (
          <input
            key={i}
            type="text"
            value={val}
            onChange={e => onChange(t.blankIndex, e.target.value)}
            disabled={checked}
            spellCheck={false}
            autoComplete="off"
            className={[
              "inline-block mx-0.5 bg-transparent border-b-2 outline-none text-center align-baseline transition-colors",
              checked
                ? correct
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-red-500 text-red-500 dark:text-red-400"
                : "border-foreground/30 focus:border-primary",
            ].join(" ")}
            style={{ width: Math.max(44, t.value.length * 10) + "px" }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Edit Modal — edit the current card's front/back without leaving study
// ---------------------------------------------------------------------------
function QuickEditModal({
  card,
  onSave,
  onClose,
}: {
  card: Card;
  onSave: (updated: Card) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!front.trim()) {
      toast({ title: "Front cannot be empty", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await jsonFetch<Card>(`/api/flashcards/${card.id}`, {
        method: "PUT",
        body: JSON.stringify({ front: encodeForWaf(front), back: encodeForWaf(back) }),
      });
      onSave(updated);
      toast({ title: "Card updated" });
      onClose();
    } catch {
      toast({ title: "Could not save card", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-card border rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Edit3 className="w-4 h-4" /> Edit card
          </h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">
            {card.type === "cloze" ? "Cloze text" : "Front (question)"}
          </label>
          <MarkdownEditor value={front} onChange={setFront} placeholder="Front side…" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">
            {card.type === "cloze" ? "Optional explanation" : "Back (answer)"}
          </label>
          <MarkdownEditor value={back} onChange={setBack} placeholder="Back side…" />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FlashcardStudyPage() {
  const params = useParams<{ id: string }>();
  const deckId = params.id!;
  const { user } = useAuthContext();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [queue, setQueue] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [stats, setStats] = useState({ done: 0, again: 0, good: 0 });
  const [deckSubject, setDeckSubject] = useState<string>("");
  const [deckName, setDeckName] = useState<string>("");
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.innerWidth >= window.innerHeight,
  );

  // Pause state
  const [paused, setPaused] = useState(false);
  const pausedAtRef = useRef<number | null>(null);
  const pausedMsRef = useRef<number>(0);

  // Quick edit modal
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  // Fill-in-the-blanks mode (global setting read from localStorage).
  const [fillBlanksMode] = useState<boolean>(readFillBlanksMode);
  const [blankInputs, setBlankInputs] = useState<string[]>([]);
  const [blankChecked, setBlankChecked] = useState(false);
  const [blankResults, setBlankResults] = useState<boolean[]>([]);

  const startRef = useRef<number>(Date.now());
  const sessionMsByTopicRef = useRef<Record<string, number>>({});
  const deckMapRef = useRef<Record<string, { name: string; subject: string }>>({});

  const current = queue[0];

  const cloze = useMemo(
    () => current?.type === "cloze" ? renderCloze(current.front) : null,
    [current],
  );

  const fillTokenData = useMemo(() => {
    if (!fillBlanksMode || !current || current.type !== "basic") return null;
    return buildFillTokens(current.front, current.back ?? "");
  }, [fillBlanksMode, current?.id, current?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    jsonFetch<{ cards: Card[] }>(`/api/flashcards/due?deckId=${deckId}&limit=500`)
      .then(j => {
        const arr = [...j.cards];
        for (let i = arr.length - 1; i > 0; i--) {
          const j2 = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j2]] = [arr[j2], arr[i]];
        }
        setQueue(sortByPriority(arr, deckId));
      })
      .catch(() => toast({ title: "Could not load due cards", variant: "destructive" }))
      .finally(() => setLoaded(true));
    jsonFetch<{ subject?: string; name?: string }>(`/api/flashcard-decks/${deckId}`)
      .then(j => {
        if (j.subject) setDeckSubject(j.subject);
        if (j.name) setDeckName(j.name);
      })
      .catch(() => { /* non-fatal */ });
    jsonFetch<{ decks: Array<{ id: string; name: string; subject: string }> }>("/api/flashcard-decks")
      .then(j => {
        for (const d of j.decks) {
          deckMapRef.current[d.id] = { name: d.name, subject: d.subject };
        }
      })
      .catch(() => { /* non-fatal */ });
  }, [user, deckId, toast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsLandscape(window.innerWidth >= window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    if (isMobile) {
      const so = (screen as Screen & { orientation?: ScreenOrientation & { lock?: (o: string) => Promise<void> } }).orientation;
      so?.lock?.("landscape").catch(() => { /* often blocked, that's fine */ });
    }
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [isMobile]);

  // Reset per-card state when the card changes.
  useEffect(() => {
    startRef.current = Date.now();
    pausedMsRef.current = 0;
    pausedAtRef.current = null;
    setPaused(false);
    setRevealed(false);
    setBlankChecked(false);
    setBlankResults([]);
    setBlankInputs([]);
  }, [current?.id]);

  // Keep blankInputs length in sync with answers array length.
  useEffect(() => {
    if (!fillTokenData) return;
    setBlankInputs(Array(fillTokenData.answers.length).fill(""));
  }, [fillTokenData]);

  function togglePause() {
    if (paused) {
      // Resuming: accumulate the paused duration
      if (pausedAtRef.current !== null) {
        pausedMsRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      setPaused(false);
    } else {
      pausedAtRef.current = Date.now();
      setPaused(true);
    }
  }

  async function rate(rating: 1 | 2 | 3 | 4) {
    if (!current || paused) return;
    const snapshot: ReviewHistoryEntry = { card: { ...current }, queueLength: queue.length };

    // Subtract any time the session was paused from the duration
    const rawMs = Date.now() - startRef.current;
    const durationMs = Math.max(0, rawMs - pausedMsRef.current);
    const dateKey = format(new Date(), "yyyy-MM-dd");
    const cappedMs = Math.min(durationMs, 5 * 60 * 1000);

    const cardDeck = deckMapRef.current[current.deckId];
    const cardSubject = cardDeck?.subject ?? deckSubject;

    if (cardSubject) {
      let topicId = "auto-flashcards";
      if (cardSubject === "biology") {
        if (cardDeck) {
          const extracted = extractBioTopicId(cardDeck.name);
          if (extracted) topicId = extracted;
        }
        if (topicId === "auto-flashcards" && deckName) {
          const extracted = extractBioTopicId(deckName);
          if (extracted) topicId = extracted;
        }
      }
      const sessionKey =
        topicId !== "auto-flashcards"
          ? `flashcard-auto-${topicId}`
          : `flashcard-auto-${current.deckId}`;
      sessionMsByTopicRef.current[sessionKey] =
        (sessionMsByTopicRef.current[sessionKey] ?? 0) + cappedMs;
      recordFlashcardStudyTime({
        deckSubject: cardSubject,
        topicId,
        sessionKey,
        totalSessionMs: sessionMsByTopicRef.current[sessionKey],
        loggedIn: !!user,
      });
    }
    try {
      await jsonFetch(`/api/flashcards/${current.id}/review`, {
        method: "POST",
        body: JSON.stringify({ rating, durationMs, dateKey }),
      });
      window.dispatchEvent(new Event("revision-tracker-flashcards-changed"));
    } catch {
      toast({ title: "Could not save review (still advancing)", variant: "destructive" });
    }
    setHistory(h => [...h.slice(-19), snapshot]);
    setStats(s => ({
      done: s.done + 1,
      again: s.again + (rating === 1 ? 1 : 0),
      good: s.good + (rating >= 3 ? 1 : 0),
    }));
    if (rating === 1) addAgainPriority(deckId, current.id);
    else if (rating === 2) addHardPriority(deckId, current.id);
    else clearCardPriority(deckId, current.id);

    setQueue(q => {
      const [first, ...rest] = q;
      if (rating === 1 && first) {
        const insertAt = Math.min(rest.length, 4 + Math.floor(Math.random() * 3));
        return [...rest.slice(0, insertAt), first, ...rest.slice(insertAt)];
      }
      if (rating === 2 && first) {
        const insertAt = Math.min(rest.length, 8 + Math.floor(Math.random() * 5));
        return [...rest.slice(0, insertAt), first, ...rest.slice(insertAt)];
      }
      return rest;
    });
  }

  async function undoLast() {
    const last = history[history.length - 1];
    if (!last) return;
    try {
      await jsonFetch(`/api/flashcards/${last.card.id}/restore-state`, {
        method: "POST",
        body: JSON.stringify({
          interval: last.card.interval,
          ease: last.card.ease,
          reps: last.card.reps,
          lapses: last.card.lapses,
          dueAt: last.card.dueAt,
        }),
      });
      window.dispatchEvent(new Event("revision-tracker-flashcards-changed"));
    } catch {
      toast({ title: "Could not undo on server (going back locally)", variant: "destructive" });
    }
    setHistory(h => h.slice(0, -1));
    setStats(s => ({ done: Math.max(0, s.done - 1), again: s.again, good: s.good }));
    setQueue(q => [last.card, ...q.filter(c => c.id !== last.card.id)]);
    setRevealed(false);
  }

  function checkBlanks() {
    if (!fillTokenData) return;
    const results = fillTokenData.answers.map((ans, i) =>
      checkAnswer(blankInputs[i] ?? "", ans),
    );
    setBlankResults(results);
    setBlankChecked(true);
  }

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Pause toggle: P key
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        togglePause();
        return;
      }
      if (paused) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (history.length > 0) { e.preventDefault(); undoLast(); }
        return;
      }
      if (!current) return;
      if (fillBlanksMode && current.type === "basic") {
        if (!blankChecked && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          checkBlanks();
          return;
        }
        if (blankChecked) {
          const r = ["1", "2", "3", "4"].indexOf(e.key);
          if (r >= 0) { e.preventDefault(); rate((r + 1) as 1 | 2 | 3 | 4); }
        }
        return;
      }
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const r = ["1", "2", "3", "4"].indexOf(e.key);
        if (r >= 0) { e.preventDefault(); rate((r + 1) as 1 | 2 | 3 | 4); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!user) return <div className="p-8 text-center text-muted-foreground">Sign in to study.</div>;
  if (!loaded) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  if (isMobile && !isLandscape) {
    return (
      <div className="fixed inset-0 z-40 bg-background flex flex-col items-center justify-center p-8 text-center gap-4">
        <div className="w-20 h-20 rounded-3xl bg-primary/10 grid place-items-center animate-pulse">
          <Smartphone className="w-10 h-10 text-primary rotate-90" />
        </div>
        <h2 className="text-lg font-bold">Rotate your phone</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Flashcard reviews look best in landscape. Turn your phone sideways to start studying.
        </p>
        <Link href={`/flashcards/${deckId}`} className="text-xs text-muted-foreground underline mt-2">
          Go back to the deck
        </Link>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center space-y-4">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
        <h2 className="text-xl font-bold">All done!</h2>
        <p className="text-sm text-muted-foreground">
          {stats.done > 0
            ? `Reviewed ${stats.done} card${stats.done === 1 ? "" : "s"} · ${stats.good} correct · ${stats.again} to revisit.`
            : "No cards are due in this deck (or its subdecks) right now. Come back later or add new ones."}
        </p>
        <div className="flex gap-2 justify-center">
          {history.length > 0 && (
            <button
              onClick={undoLast}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-secondary text-foreground text-sm font-semibold hover:bg-secondary/70"
            >
              <Undo2 className="w-4 h-4" /> Undo last
            </button>
          )}
          <Link href={`/flashcards/${deckId}`} className="inline-block px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90">
            Back to deck
          </Link>
        </div>
      </div>
    );
  }

  const isFillBlanksCard = fillBlanksMode && current.type === "basic" && !!fillTokenData;

  const frontMd = current.type === "cloze"
    ? (revealed ? cloze!.revealed : cloze!.hidden)
    : current.front;

  const wrongAnswers = blankChecked
    ? fillTokenData?.answers.filter((_, i) => !blankResults[i]).map((ans, idx) => {
        const globalIdx = fillTokenData!.answers.findIndex(
          (a, i) => a === ans && !blankResults[i] && i >= idx,
        );
        return { answer: ans, index: globalIdx };
      })
    : [];

  return (
    <>
      {editingCard && (
        <QuickEditModal
          card={editingCard}
          onSave={(updated) => {
            setQueue(q => q.map(c => c.id === updated.id ? { ...c, front: updated.front, back: updated.back } : c));
            setEditingCard(null);
          }}
          onClose={() => setEditingCard(null)}
        />
      )}

      {/* Pause overlay */}
      {paused && (
        <div className="fixed inset-0 z-40 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center gap-5">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 grid place-items-center">
            <Pause className="w-10 h-10 text-primary" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold">Session paused</h2>
            <p className="text-sm text-muted-foreground mt-1">Press <kbd className="px-1.5 py-0.5 rounded bg-secondary text-xs">P</kbd> or click resume to continue</p>
          </div>
          <button
            onClick={togglePause}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-semibold hover:opacity-90"
          >
            <Play className="w-4 h-4" /> Resume
          </button>
        </div>
      )}

      <div className="max-w-3xl w-full mx-auto p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link href={`/flashcards/${deckId}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" /> Stop session
          </Link>
          <div className="flex items-center gap-3">
            {fillBlanksMode && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
                Fill blanks on
              </span>
            )}
            {/* Pause button */}
            <button
              onClick={togglePause}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
                paused
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-secondary text-foreground hover:bg-secondary/70"
              }`}
              title="Pause / resume session (P)"
            >
              {paused ? <><Play className="w-3.5 h-3.5" /> Resume</> : <><Pause className="w-3.5 h-3.5" /> Pause</>}
            </button>
            <button
              onClick={undoLast}
              disabled={history.length === 0}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary text-foreground hover:bg-secondary/70 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Undo last review (Cmd/Ctrl+Z)"
              data-testid="button-undo"
            >
              <Undo2 className="w-3.5 h-3.5" /> Back
            </button>
            <div className="text-xs text-muted-foreground flex items-center gap-3">
              <span><strong className="text-foreground">{stats.done}</strong> done</span>
              <span><strong className="text-foreground">{queue.length}</strong> left</span>
              {stats.done > 0 && (
                <span>
                  <strong className="text-emerald-500">{Math.round(stats.good / stats.done * 100)}%</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className="bg-card border rounded-2xl p-8 sm:p-10 shadow-sm min-h-[320px] flex flex-col"
          data-testid="study-card"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              {isFillBlanksCard
                ? "Fill in the blanks"
                : current.type === "cloze"
                ? (revealed ? "Answer" : "Fill in the blanks")
                : (revealed ? "Answer" : "Question")}
            </div>
            {/* Quick edit button */}
            <button
              onClick={() => setEditingCard(current)}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-secondary transition-colors"
              title="Edit this card (without leaving the session)"
            >
              <Edit3 className="w-3 h-3" /> Edit card
            </button>
          </div>

          {isFillBlanksCard ? (
            <div className="flex-1 space-y-4">
              <FillBlanksView
                tokens={fillTokenData!.tokens}
                inputs={blankInputs}
                checked={blankChecked}
                results={blankResults}
                onChange={(idx, val) =>
                  setBlankInputs(prev => prev.map((v, i) => i === idx ? val : v))
                }
              />
              {blankChecked && wrongAnswers && wrongAnswers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-dashed border-border space-y-1">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Missed answers
                  </p>
                  {fillTokenData!.answers.map((ans, i) =>
                    blankResults[i] ? null : (
                      <p key={i} className="text-sm text-red-500 dark:text-red-400">
                        Blank {i + 1}: <strong>{ans}</strong>
                      </p>
                    ),
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 study-card-prose">
              <MarkdownPreview value={frontMd} />
              {revealed && current.type === "basic" && current.back && (
                <div className="mt-6 pt-6 border-t border-dashed border-border">
                  <MarkdownPreview value={current.back} />
                </div>
              )}
              {revealed && current.type === "cloze" && current.back && (
                <div className="mt-6 pt-6 border-t border-dashed border-border opacity-80">
                  <MarkdownPreview value={current.back} />
                </div>
              )}
            </div>
          )}
        </div>

        {isFillBlanksCard ? (
          !blankChecked ? (
            <button
              onClick={checkBlanks}
              disabled={paused}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
              data-testid="button-check-blanks"
            >
              <CheckCircle2 className="w-4 h-4" /> Check answers · <kbd className="text-xs opacity-70">Space</kbd>
            </button>
          ) : (
            <div className="space-y-2">
              {blankResults.every(r => r) ? (
                <p className="text-center text-sm font-semibold text-emerald-500">
                  All correct! Rate how easy it felt:
                </p>
              ) : (
                <p className="text-center text-sm font-semibold text-muted-foreground">
                  {blankResults.filter(r => r).length}/{blankResults.length} correct — rate your recall:
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RATING_LABELS.map(r => (
                  <button
                    key={r.rating}
                    onClick={() => rate(r.rating as 1 | 2 | 3 | 4)}
                    disabled={paused}
                    className={`${r.color} text-white py-3 rounded-xl font-semibold flex flex-col items-center text-sm transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50`}
                    data-testid={`button-rate-${r.rating}`}
                  >
                    <span>{r.label}</span>
                    <span className="text-[10px] opacity-80 font-normal mt-0.5">{r.hint}</span>
                    <span className="text-[10px] opacity-60 mt-0.5">{r.key}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        ) : !revealed ? (
          <button
            onClick={() => !paused && setRevealed(true)}
            disabled={paused}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
            data-testid="button-reveal"
          >
            <Sparkles className="w-4 h-4" /> Show answer · <kbd className="text-xs opacity-70">Space</kbd>
          </button>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {RATING_LABELS.map(r => (
              <button
                key={r.rating}
                onClick={() => rate(r.rating as 1 | 2 | 3 | 4)}
                disabled={paused}
                className={`${r.color} text-white py-3 rounded-xl font-semibold flex flex-col items-center text-sm transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50`}
                data-testid={`button-rate-${r.rating}`}
              >
                <span>{r.label}</span>
                <span className="text-[10px] opacity-80 font-normal mt-0.5">{r.hint}</span>
                <span className="text-[10px] opacity-60 mt-0.5">{r.key}</span>
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-2">
          <RotateCw className="w-3 h-3" /> Cards you press <strong>Again</strong> on come back later in this session.
          <span className="opacity-60">·</span>
          <Undo2 className="w-3 h-3" /> Press <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px]">Cmd/Ctrl+Z</kbd> to undo.
          <span className="opacity-60">·</span>
          <Pause className="w-3 h-3" /> Press <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px]">P</kbd> to pause.
        </p>
      </div>
    </>
  );
}
