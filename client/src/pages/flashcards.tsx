import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Layers, Plus, Lock, Sparkles, Trash2, Pencil, Search, ChevronRight, ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/lib/auth-context";

interface Deck {
  id: string;
  name: string;
  subject: string;
  color: string;
  description: string;
  parentId: string | null;
  total: number;
  due: number;
  fresh: number;
  updatedAt: string;
}

interface DeckNode extends Deck {
  children: DeckNode[];
  /** Total cards including subdecks. */
  rollupTotal: number;
  /** Due cards including subdecks. */
  rollupDue: number;
}

const SUBJECTS = [
  { id: "biology", name: "Biology" },
  { id: "chemistry", name: "Chemistry" },
  { id: "maths", name: "Maths" },
  { id: "miscellaneous", name: "Other" },
] as const;

const COLOR_HSL: Record<string, string> = {
  blue: "210 80% 55%", green: "150 60% 45%", red: "0 75% 60%",
  amber: "40 95% 55%", purple: "270 70% 60%", pink: "330 80% 65%",
  teal: "180 60% 45%", slate: "215 16% 47%", orange: "25 95% 55%", indigo: "240 70% 60%",
};
const SUBJECT_COLOR_VAR: Record<string, string> = {
  biology: "--biology", chemistry: "--chemistry", maths: "--maths",
};

function deckColor(d: Deck): string {
  if (d.subject in SUBJECT_COLOR_VAR) return `hsl(var(${SUBJECT_COLOR_VAR[d.subject]}))`;
  return `hsl(${COLOR_HSL[d.color] ?? COLOR_HSL.blue})`;
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

/** Build a forest from the flat deck list, computing rollup counts via DFS. */
function buildForest(decks: Deck[]): DeckNode[] {
  const byId = new Map<string, DeckNode>();
  for (const d of decks) byId.set(d.id, { ...d, children: [], rollupTotal: 0, rollupDue: 0 });
  const roots: DeckNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  function walk(n: DeckNode): { total: number; due: number } {
    let total = n.total;
    let due = n.due;
    for (const c of n.children) {
      const r = walk(c);
      total += r.total;
      due += r.due;
    }
    n.rollupTotal = total;
    n.rollupDue = due;
    return { total, due };
  }
  for (const r of roots) walk(r);
  // Most recently updated subtree first.
  function sortRec(arr: DeckNode[]) {
    arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const c of arr) sortRec(c.children);
  }
  sortRec(roots);
  return roots;
}

export default function FlashcardsPage() {
  const { user, isLoading } = useAuthContext();
  const { toast } = useToast();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Create-deck form state.
  const [name, setName] = useState("");
  const [subject, setSubject] = useState<string>("biology");
  const [parentId, setParentId] = useState<string>("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    jsonFetch<{ decks: Deck[] }>("/api/flashcard-decks")
      .then(j => setDecks(j.decks))
      .catch(() => toast({ title: "Could not load decks", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [user, toast]);

  async function createDeck() {
    if (!name.trim()) return;
    try {
      const created = await jsonFetch<Deck>("/api/flashcard-decks", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          subject,
          description: description.trim(),
          parentId: parentId || null,
        }),
      });
      setDecks(prev => [{ ...created, total: 0, due: 0, fresh: 0 }, ...prev]);
      setName(""); setDescription(""); setParentId(""); setCreating(false);
      toast({ title: "Deck created" });
    } catch {
      toast({ title: "Could not create deck", variant: "destructive" });
    }
  }

  async function deleteDeck(id: string) {
    const target = decks.find(d => d.id === id);
    const subCount = decks.filter(d => d.parentId === id).length;
    const msg = subCount > 0
      ? `Delete "${target?.name}" and its ${subCount} subdeck${subCount === 1 ? "" : "s"} (and all their cards)? This cannot be undone.`
      : `Delete "${target?.name}" and all its cards? This cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      await jsonFetch(`/api/flashcard-decks/${id}`, { method: "DELETE" });
      // Cascade: remove descendants from local state too.
      const idsToRemove = new Set([id]);
      let added = true;
      while (added) {
        added = false;
        for (const d of decks) {
          if (d.parentId && idsToRemove.has(d.parentId) && !idsToRemove.has(d.id)) {
            idsToRemove.add(d.id); added = true;
          }
        }
      }
      setDecks(prev => prev.filter(d => !idsToRemove.has(d.id)));
      toast({ title: "Deck deleted" });
    } catch {
      toast({ title: "Could not delete deck", variant: "destructive" });
    }
  }

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const forest = useMemo(() => {
    const filtered = decks.filter(d => filter === "all" || d.subject === filter);
    // When searching, surface matches as a flat list (ignore tree).
    if (search) {
      const matched = filtered.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
      return buildForest(matched.map(d => ({ ...d, parentId: null })));
    }
    return buildForest(filtered);
  }, [decks, filter, search]);

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  }
  if (!user) {
    return (
      <div className="p-12 text-center max-w-md mx-auto">
        <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <h2 className="text-lg font-semibold mb-1">Sign in to use flashcards</h2>
        <p className="text-sm text-muted-foreground">
          Your decks and review history sync across devices.
        </p>
      </div>
    );
  }

  const totalDue = decks.reduce((acc, d) => acc + d.due, 0);
  const totalCards = decks.reduce((acc, d) => acc + d.total, 0);

  return (
    <div className="max-w-6xl w-full mx-auto p-6 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" /> Flashcards
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Spaced-repetition decks · {totalCards} card{totalCards === 1 ? "" : "s"} · {totalDue} due now
          </p>
        </div>
        <button
          onClick={() => setCreating(c => !c)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          data-testid="button-new-deck"
        >
          <Plus className="w-4 h-4" /> New deck
        </button>
      </header>

      {creating && (
        <div className="bg-card border rounded-xl p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Create a deck</h3>
          </div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Deck name (e.g. OCR A Bio · Module 5)"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            data-testid="input-deck-name"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">Subject</label>
              <div className="flex flex-wrap gap-1">
                {SUBJECTS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSubject(s.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      subject === s.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/70"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">Parent deck (optional)</label>
              <select
                value={parentId}
                onChange={e => setParentId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                data-testid="select-parent-deck"
              >
                <option value="">— Top level —</option>
                {decks.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary">
              Cancel
            </button>
            <button
              onClick={createDeck}
              disabled={!name.trim()}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
              data-testid="button-confirm-create-deck"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-full bg-secondary/60 border border-border/60">
          {(["all", ...SUBJECTS.map(s => s.id)] as const).map(id => {
            const label = id === "all" ? "All" : SUBJECTS.find(s => s.id === id)?.name;
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  filter === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search decks…"
            className="w-full pl-9 pr-3 py-2 rounded-full border border-border bg-background text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading decks…</div>
      ) : forest.length === 0 ? (
        <div className="p-12 text-center bg-card border rounded-xl">
          <Layers className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {decks.length === 0 ? "No decks yet — create one to get started." : "No decks match this filter."}
          </p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm divide-y divide-border/60">
          {forest.map(node => (
            <DeckTreeRow
              key={node.id}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              onDelete={deleteDeck}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckTreeRow({
  node, depth, collapsed, onToggle, onDelete,
}: {
  node: DeckNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const showRollup = hasChildren && (node.rollupTotal !== node.total || node.rollupDue !== node.due);
  return (
    <>
      <div
        className="flex items-center gap-2 px-3 py-3 hover:bg-secondary/40 group transition-colors"
        style={{ paddingLeft: 12 + depth * 22 }}
        data-testid={`deck-row-${node.id}`}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.id)}
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        ) : (
          <div className="w-5" />
        )}

        <div className="w-1 h-7 rounded-full shrink-0" style={{ background: deckColor(node) }} />

        <Link href={`/flashcards/${node.id}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{node.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {node.total} card{node.total === 1 ? "" : "s"}
              {showRollup && ` · ${node.rollupTotal} w/ subdecks`}
            </span>
            {node.due > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 dark:text-orange-300">
                {node.due} due
              </span>
            )}
            {showRollup && node.rollupDue > node.due && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/10 text-orange-600/80 dark:text-orange-300/80">
                +{node.rollupDue - node.due} in subdecks
              </span>
            )}
            {node.fresh > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-300">
                {node.fresh} new
              </span>
            )}
          </div>
          {node.description && (
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{node.description}</p>
          )}
        </Link>

        <div className="flex items-center gap-1 shrink-0">
          {node.rollupDue > 0 && (
            <Link
              href={`/flashcards/${node.id}/study`}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-primary text-primary-foreground hover:opacity-90"
              data-testid={`button-study-${node.id}`}
            >
              Study
            </Link>
          )}
          <Link
            href={`/flashcards/${node.id}`}
            className="p-1.5 rounded-full text-muted-foreground hover:bg-secondary opacity-0 group-hover:opacity-100 transition-opacity"
            title="Manage"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Link>
          <button
            onClick={() => onDelete(node.id)}
            className="p-1.5 rounded-full text-muted-foreground hover:bg-red-500/10 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete deck"
            data-testid={`button-delete-deck-${node.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {hasChildren && !isCollapsed && node.children.map(child => (
        <DeckTreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
