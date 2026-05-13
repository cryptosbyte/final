import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, CheckCircle2, RotateCw, Smartphone, Sparkles, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/lib/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { MarkdownPreview } from "@/components/markdown-editor";
import { renderCloze } from "@/lib/cloze";
import { recordFlashcardStudyTime } from "@/lib/flashcard-day-time";

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

/**
 * Snapshot we capture *before* sending a review, so the Undo button can
 * restore both the card's SR state on the server and the local queue.
 */
interface ReviewHistoryEntry {
  card: Card;
  /** Index in the queue at the time the card was shown (always 0 here). */
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
  const [deckTopicId, setDeckTopicId] = useState<string>("");
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.innerWidth >= window.innerHeight,
  );
  const startRef = useRef<number>(Date.now());
  /** Cumulative time spent in this session, in ms. */
  const sessionMsRef = useRef<number>(0);

  const current = queue[0];

  const cloze = useMemo(
    () => current?.type === "cloze" ? renderCloze(current.front) : null,
    [current],
  );

  useEffect(() => {
    if (!user) return;
    jsonFetch<{ cards: Card[] }>(`/api/flashcards/due?deckId=${deckId}&limit=500`)
      .then(j => {
        const arr = [...j.cards];
        for (let i = arr.length - 1; i > 0; i--) {
          const j2 = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j2]] = [arr[j2], arr[i]];
        }
        setQueue(arr);
      })
      .catch(() => toast({ title: "Could not load due cards", variant: "destructive" }))
      .finally(() => setLoaded(true));
    // Fetch deck metadata so we know which subject the time should count
    // toward on today's calendar entry.
    jsonFetch<{ subject?: string; parentId?: string | null; name?: string }>(`/api/flashcard-decks/${deckId}`)
      .then(j => {
        if (j.subject) setDeckSubject(j.subject);
        if (j.subject === "biology" && j.parentId && j.name) setDeckTopicId(j.name);
      })
      .catch(() => { /* non-fatal */ });
  }, [user, deckId, toast]);

  // Watch screen orientation on mobile; the study UI requires landscape.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsLandscape(window.innerWidth >= window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    // Best-effort: try to lock orientation on mobile (Chrome/Android only).
    if (isMobile) {
      const so = (screen as Screen & { orientation?: ScreenOrientation & { lock?: (o: string) => Promise<void> } }).orientation;
      so?.lock?.("landscape").catch(() => { /* often blocked, that's fine */ });
    }
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [isMobile]);

  useEffect(() => {
    startRef.current = Date.now();
    setRevealed(false);
  }, [current?.id]);

  async function rate(rating: 1 | 2 | 3 | 4) {
    if (!current) return;
    const snapshot: ReviewHistoryEntry = { card: { ...current }, queueLength: queue.length };
    const durationMs = Date.now() - startRef.current;
    const dateKey = format(new Date(), "yyyy-MM-dd");
    // Cap each card at 5 minutes — guards against tabs left open overnight
    // inflating today's productivity score.
    sessionMsRef.current += Math.min(durationMs, 5 * 60 * 1000);
    if (deckSubject) {
      recordFlashcardStudyTime({
        deckId,
        deckSubject,
        deckTopicId: deckSubject === "biology" ? deckTopicId : undefined,
        totalSessionMs: sessionMsRef.current,
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
    setQueue(q => {
      const [first, ...rest] = q;
      if (rating === 1 && first) {
        const insertAt = Math.min(rest.length, 4 + Math.floor(Math.random() * 3));
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
    setStats(s => ({
      done: Math.max(0, s.done - 1),
      // We don't know which counter to decrement without storing the rating;
      // recompute conservatively. (Rare edge case — keep state simple.)
      again: s.again,
      good: s.good,
    }));
    // Put the previous card back at the front of the queue. If the previous
    // rating had re-queued it (Again), there may be a duplicate further down;
    // we leave it because it'll be re-rated and converge.
    setQueue(q => [last.card, ...q.filter(c => c.id !== last.card.id)]);
    setRevealed(false);
  }

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Cmd/Ctrl+Z: undo last review.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (history.length > 0) {
          e.preventDefault();
          undoLast();
        }
        return;
      }
      if (!current) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const r = ["1", "2", "3", "4"].indexOf(e.key);
        if (r >= 0) {
          e.preventDefault();
          rate((r + 1) as 1 | 2 | 3 | 4);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!user) return <div className="p-8 text-center text-muted-foreground">Sign in to study.</div>;
  if (!loaded) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  // On mobile we *require* landscape for legibility; show a full-screen
  // prompt until the device is rotated. The orientation listener will
  // dismiss it automatically.
  if (isMobile && !isLandscape) {
    return (
      <div className="fixed inset-0 z-40 bg-background flex flex-col items-center justify-center p-8 text-center gap-4">
        <div className="w-20 h-20 rounded-3xl bg-primary/10 grid place-items-center animate-pulse">
          <Smartphone className="w-10 h-10 text-primary rotate-90" />
        </div>
        <h2 className="text-lg font-bold">Rotate your phone</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Flashcard reviews look best in landscape. Turn your phone sideways
          to start studying.
        </p>
        <Link
          href={`/flashcards/${deckId}`}
          className="text-xs text-muted-foreground underline mt-2"
        >
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

  const frontMd = current.type === "cloze"
    ? (revealed ? cloze!.revealed : cloze!.hidden)
    : current.front;

  return (
    <div className="max-w-3xl w-full mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/flashcards/${deckId}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Stop session
        </Link>
        <div className="flex items-center gap-3">
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
        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-4">
          {current.type === "cloze" ? (revealed ? "Answer" : "Fill in the blanks") : (revealed ? "Answer" : "Question")}
        </div>
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
      </div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 flex items-center justify-center gap-2"
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
              className={`${r.color} text-white py-3 rounded-xl font-semibold flex flex-col items-center text-sm transition-transform hover:scale-[1.02] active:scale-95`}
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
      </p>
    </div>
  );
}
