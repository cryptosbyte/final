import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Quote, Plus, Shuffle, X, Trash2 } from "lucide-react";

const STORAGE_KEY = "revision_tracker_user_quotes";
const PICK_KEY = "revision_tracker_quote_pick";

const DEFAULT_QUOTES: { text: string; author?: string }[] = [
  { text: "And say: My Lord, increase me in knowledge.", author: "Qur'an 20:114" },
  { text: "Indeed, with hardship comes ease.", author: "Qur'an 94:6" },
  { text: "Allah does not burden a soul beyond that it can bear.", author: "Qur'an 2:286" },
  { text: "And whoever relies upon Allah — then He is sufficient for him.", author: "Qur'an 65:3" },
  { text: "Allah will raise those who have believed among you, and those given knowledge, by degrees.", author: "Qur'an 58:11" },
  { text: "So remember Me; I will remember you.", author: "Qur'an 2:152" },
  { text: "Verily, in the remembrance of Allah do hearts find rest.", author: "Qur'an 13:28" },
  { text: "Seeking knowledge is an obligation upon every Muslim.", author: "Prophet Muhammad ﷺ (Ibn Majah)" },
  { text: "Whoever travels a path in search of knowledge, Allah will make easy for him a path to Paradise.", author: "Prophet Muhammad ﷺ (Muslim)" },
  { text: "The most beloved of deeds to Allah are those that are most consistent, even if small.", author: "Prophet Muhammad ﷺ (Bukhari & Muslim)" },
  { text: "Take advantage of five before five: your youth before your old age, your health before your sickness, your wealth before your poverty, your free time before your busyness, and your life before your death.", author: "Prophet Muhammad ﷺ (al-Hakim)" },
  { text: "Tie your camel and then place your trust in Allah.", author: "Prophet Muhammad ﷺ (Tirmidhi)" },
  { text: "Verily, actions are by intentions.", author: "Prophet Muhammad ﷺ (Bukhari & Muslim)" },
  { text: "He who does not thank people, does not thank Allah.", author: "Prophet Muhammad ﷺ (Tirmidhi)" },
  { text: "Time is like a sword: if you do not cut it, it will cut you.", author: "Imam al-Shafi'i" },
  { text: "Whoever does not taste the humiliation of learning for an hour, will drink the humiliation of ignorance forever.", author: "Imam al-Shafi'i" },
  { text: "I complained to Wakee' about my poor memory, and he advised me to abandon sin — for knowledge is a light, and the light of Allah is not given to a sinner.", author: "Imam al-Shafi'i" },
  { text: "Knowledge is not what is memorised; knowledge is what benefits.", author: "Imam al-Shafi'i" },
  { text: "Patience is of two kinds: patience over what hurts you, and patience against what you desire.", author: "Ali ibn Abi Talib (RA)" },
  { text: "Do not be a slave to others when Allah has created you free.", author: "Ali ibn Abi Talib (RA)" },
  { text: "The best of people are those most beneficial to others.", author: "Prophet Muhammad ﷺ (Daraqutni)" },
  { text: "If you find yourself ascending, know that the climb itself is a gift.", author: "Ibn al-Qayyim" },
  { text: "There is no joy for the one who does not endure hardship for the sake of knowledge.", author: "Imam al-Nawawi" },
  { text: "Whoever is patient will be given patience, and no one is given a gift better and more comprehensive than patience.", author: "Prophet Muhammad ﷺ (Bukhari)" },
  { text: "Make things easy and do not make them difficult; give glad tidings and do not repel.", author: "Prophet Muhammad ﷺ (Bukhari)" },
  { text: "Do not lose hope, nor be sad.", author: "Qur'an 3:139" },
];

interface UserQuote { id: string; text: string; author?: string }

function loadUserQuotes(): UserQuote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(q => q && typeof q.text === "string");
  } catch { return []; }
}

function saveUserQuotes(quotes: UserQuote[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(quotes)); } catch {}
}

function dailySeed(): number {
  const today = format(new Date(), "yyyy-MM-dd");
  let h = 0;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0;
  return h;
}

export function DailyQuote() {
  const [userQuotes, setUserQuotes] = useState<UserQuote[]>(() => loadUserQuotes());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"add" | "manage">("add");
  const [draftText, setDraftText] = useState("");
  const [draftAuthor, setDraftAuthor] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  const allQuotes = useMemo(
    () => [...DEFAULT_QUOTES, ...userQuotes.map(q => ({ text: q.text, author: q.author }))],
    [userQuotes],
  );

  const [pickIdx, setPickIdx] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(PICK_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const today = format(new Date(), "yyyy-MM-dd");
        if (parsed.date === today && typeof parsed.idx === "number") return parsed.idx;
      }
    } catch {}
    return dailySeed() % Math.max(1, DEFAULT_QUOTES.length + loadUserQuotes().length);
  });

  useEffect(() => {
    try {
      localStorage.setItem(PICK_KEY, JSON.stringify({
        date: format(new Date(), "yyyy-MM-dd"),
        idx: pickIdx,
      }));
    } catch {}
  }, [pickIdx]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const safeIdx = allQuotes.length === 0 ? 0 : ((pickIdx % allQuotes.length) + allQuotes.length) % allQuotes.length;
  const current = allQuotes[safeIdx];

  const shuffleNext = () => {
    if (allQuotes.length <= 1) return;
    let next = pickIdx;
    while (next === pickIdx) next = Math.floor(Math.random() * allQuotes.length);
    setPickIdx(next);
  };

  const addQuote = () => {
    const text = draftText.trim();
    if (!text) return;
    const author = draftAuthor.trim();
    const next: UserQuote[] = [
      ...userQuotes,
      { id: crypto.randomUUID(), text, author: author || undefined },
    ];
    setUserQuotes(next);
    saveUserQuotes(next);
    setDraftText("");
    setDraftAuthor("");
    setPickIdx(DEFAULT_QUOTES.length + next.length - 1);
  };

  const removeQuote = (id: string) => {
    const next = userQuotes.filter(q => q.id !== id);
    setUserQuotes(next);
    saveUserQuotes(next);
  };

  if (!current) return null;

  return (
    <div className="relative hidden md:flex items-center" data-testid="daily-quote">
      <button
        onClick={() => setOpen(o => !o)}
        title="Daily quote — click for options"
        className="flex items-center gap-2 max-w-[360px] lg:max-w-[480px] px-3 py-1.5 rounded-full bg-secondary/40 hover:bg-secondary/70 border border-border/50 transition-colors text-left"
      >
        <Quote className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-[11.5px] leading-tight truncate text-foreground/85">
          <span className="italic">"{current.text}"</span>
          {current.author && (
            <span className="text-muted-foreground"> — {current.author}</span>
          )}
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-2 w-[340px] bg-card rounded-2xl shadow-xl border border-border/70 z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Daily Quote</span>
            <div className="flex items-center gap-1">
              <button
                onClick={shuffleNext}
                title="Show another quote"
                className="p-1.5 rounded-md hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-quote-shuffle"
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border/50">
            <p className="text-[13px] italic leading-snug text-foreground/90">"{current.text}"</p>
            {current.author && (
              <p className="text-[11px] text-muted-foreground mt-1">— {current.author}</p>
            )}
          </div>

          <div className="flex border-b border-border/50">
            <button
              onClick={() => setTab("add")}
              className={`flex-1 text-[11px] font-semibold uppercase tracking-wider py-2 transition-colors ${tab === "add" ? "text-foreground bg-secondary/40" : "text-muted-foreground hover:text-foreground"}`}
            >
              Add
            </button>
            <button
              onClick={() => setTab("manage")}
              className={`flex-1 text-[11px] font-semibold uppercase tracking-wider py-2 transition-colors ${tab === "manage" ? "text-foreground bg-secondary/40" : "text-muted-foreground hover:text-foreground"}`}
            >
              My quotes ({userQuotes.length})
            </button>
          </div>

          {tab === "add" ? (
            <div className="px-4 py-3 space-y-2">
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                placeholder="Type a quote you want to live by…"
                rows={2}
                data-testid="input-new-quote-text"
                className="w-full text-[12.5px] bg-secondary/40 border border-border/50 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
              <input
                type="text"
                value={draftAuthor}
                onChange={e => setDraftAuthor(e.target.value)}
                placeholder="Author (optional)"
                data-testid="input-new-quote-author"
                className="w-full text-[12px] bg-secondary/40 border border-border/50 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={addQuote}
                disabled={!draftText.trim()}
                data-testid="button-add-quote"
                className="w-full flex items-center justify-center gap-1.5 text-[11.5px] font-semibold bg-primary text-primary-foreground rounded-full py-1.5 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Add to bank
              </button>
            </div>
          ) : (
            <div className="px-4 py-3 max-h-[200px] overflow-y-auto space-y-2">
              {userQuotes.length === 0 ? (
                <p className="text-[12px] text-muted-foreground italic">No custom quotes yet.</p>
              ) : (
                userQuotes.map(q => (
                  <div key={q.id} className="flex items-start gap-2 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] italic leading-snug text-foreground/90 break-words">"{q.text}"</p>
                      {q.author && (
                        <p className="text-[10.5px] text-muted-foreground">— {q.author}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeQuote(q.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                      title="Delete quote"
                      data-testid={`button-delete-quote-${q.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
