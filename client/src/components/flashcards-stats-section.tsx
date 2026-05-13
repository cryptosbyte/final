import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { format, parseISO, subDays } from "date-fns";
import { Layers, AlertCircle, TrendingUp, Brain, Clock, Target } from "lucide-react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell,
} from "recharts";
import type { AuthUser } from "@/lib/api-client";
import { useFlashcardDailyStats } from "@/hooks/use-flashcard-stats";

interface WeakCard {
  id: string;
  deckId: string;
  deckName: string;
  front: string;
  reps: number;
  lapses: number;
  ease: number;
  lapseRate: number;
}

interface Analytics {
  totalCards: number;
  totalReviews: number;
  retentionRate: number;
  avgEase: number;
  totalDurationMs: number;
  reviewsByRating: { again: number; hard: number; good: number; easy: number };
  weakCards: WeakCard[];
  decks: Array<{
    id: string; name: string; subject: string;
    total: number; lapseRate: number; avgEase: number; reviews: number;
  }>;
}

const SUBJECT_COLOR: Record<string, string> = {
  biology: "hsl(var(--biology))",
  chemistry: "hsl(var(--chemistry))",
  maths: "hsl(var(--maths))",
};

export function FlashcardsStatsSection({ user }: { user: AuthUser | null }) {
  const { stats: daily } = useFlashcardDailyStats(user);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/flashcards/analytics", { credentials: "include" });
        if (!res.ok) throw new Error();
        const j = (await res.json()) as Analytics;
        if (!cancelled) setAnalytics(j);
      } catch {
        if (!cancelled) setAnalytics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    function refresh() { load(); }
    window.addEventListener("revision-tracker-flashcards-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("revision-tracker-flashcards-changed", refresh);
    };
  }, [user]);

  const last30 = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, i) => {
      const d = subDays(today, 29 - i);
      const key = format(d, "yyyy-MM-dd");
      const stat = daily[key];
      return {
        name: format(d, "d MMM"),
        reviews: stat?.reviews ?? 0,
        minutes: stat ? Math.round(stat.durationMs / 60000) : 0,
      };
    });
  }, [daily]);

  if (!user || loading) return null;
  if (!analytics || analytics.totalCards === 0) {
    return (
      <section className="max-w-6xl mx-auto bg-card border rounded-xl p-6 shadow-sm">
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Flashcards</h2>
          </div>
          <Link href="/flashcards" className="text-xs font-semibold text-primary hover:underline">Open →</Link>
        </header>
        <p className="text-sm text-muted-foreground">
          No flashcard activity yet. Create a deck and start studying — your review minutes will fold into your daily stats automatically.
        </p>
      </section>
    );
  }

  const { again, hard, good, easy } = analytics.reviewsByRating;
  const reviewMix = [
    { name: "Again", count: again, fill: "hsl(0 75% 60%)" },
    { name: "Hard",  count: hard,  fill: "hsl(25 95% 55%)" },
    { name: "Good",  count: good,  fill: "hsl(150 60% 45%)" },
    { name: "Easy",  count: easy,  fill: "hsl(210 80% 55%)" },
  ];
  const totalMinutes = Math.round(analytics.totalDurationMs / 60000);

  return (
    <section className="max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" /> Flashcards
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Spaced-repetition recall and weakness analysis (last 90 days).
          </p>
        </div>
        <Link href="/flashcards" className="text-xs font-semibold text-primary hover:underline">All decks →</Link>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Target className="w-4 h-4" />} label="Retention" value={`${Math.round(analytics.retentionRate * 100)}%`} hint={`${analytics.totalReviews} reviews`} />
        <Stat icon={<Brain className="w-4 h-4" />} label="Avg ease"   value={analytics.avgEase.toFixed(2)} hint="lower = harder" />
        <Stat icon={<Clock className="w-4 h-4" />} label="Time spent" value={totalMinutes >= 60 ? `${(totalMinutes / 60).toFixed(1)} h` : `${totalMinutes}m`} hint="all sessions" />
        <Stat icon={<TrendingUp className="w-4 h-4" />} label="Cards" value={String(analytics.totalCards)} hint={`${analytics.decks.length} deck${analytics.decks.length === 1 ? "" : "s"}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-card border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Review minutes — last 30 days</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last30} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={4} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", fontSize: 12 }}
                />
                <Bar dataKey="minutes" name="Minutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Answer mix</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reviewMix} layout="vertical" margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", fontSize: 12 }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {reviewMix.map((r, i) => <Cell key={i} fill={r.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {analytics.decks.length > 0 && (
        <div className="bg-card border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Decks</h3>
          <div className="space-y-2">
            {analytics.decks.map(d => {
              const tone = d.lapseRate >= 0.4 ? "text-red-600 dark:text-red-400" : d.lapseRate >= 0.2 ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400";
              return (
                <Link
                  key={d.id}
                  href={`/flashcards/${d.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-secondary/60 transition-colors"
                >
                  <div className="w-1.5 h-8 rounded-full" style={{ background: SUBJECT_COLOR[d.subject] ?? "hsl(var(--primary))" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.total} cards · {d.reviews} reviews · ease {d.avgEase.toFixed(2)}
                    </p>
                  </div>
                  <div className={`text-xs font-semibold ${tone}`}>
                    {Math.round(d.lapseRate * 100)}% lapse
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {analytics.weakCards.length > 0 && (
        <div className="bg-card border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-500" /> Weakest cards
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            Cards with the highest lapse rate after at least 3 reviews. Tap to jump to the deck.
          </p>
          <div className="space-y-2">
            {analytics.weakCards.slice(0, 8).map(c => (
              <Link
                key={c.id}
                href={`/flashcards/${c.deckId}`}
                className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-secondary/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-2">{stripMarkdown(c.front)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {c.deckName} · ease {c.ease.toFixed(2)} · {c.lapses}/{c.reps} lapses
                  </p>
                </div>
                <span className="text-xs font-semibold text-red-600 dark:text-red-400 shrink-0">
                  {Math.round(c.lapseRate * 100)}%
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\{\{c\d+::([^}]+?)(?:::[^}]+?)?\}\}/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Avoid unused-import lint when build env strips parseISO.
void parseISO;
