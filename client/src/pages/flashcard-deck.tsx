import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft, Plus, Upload, Play, Trash2, RotateCcw, Wand2, Edit3, X, FolderPlus,
  GripVertical, Search, FolderInput, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/lib/auth-context";
import { MarkdownEditor, MarkdownPreview } from "@/components/markdown-editor";
import { autoCloze, hasCloze, renderCloze } from "@/lib/cloze";
import { encodeForWaf } from "@/lib/b64-payload";

interface Deck {
  id: string;
  name: string;
  subject: string;
  color: string;
  description: string;
  parentId: string | null;
}
interface Card {
  id: string;
  deckId: string;
  type: "basic" | "cloze";
  front: string;
  back: string;
  tags: string;
  dueAt: string;
  reps: number;
  lapses: number;
  ease: number;
  interval: number;
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new HttpError(res.status);
  return res.json() as Promise<T>;
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\{\{c\d+::([^}]+?)(?:::[^}]+?)?\}\}/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function FlashcardDeckPage() {
  const params = useParams<{ id: string }>();
  const deckId = params.id!;
  const { user } = useAuthContext();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [subdecks, setSubdecks] = useState<Deck[]>([]);
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Card | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [subdeckName, setSubdeckName] = useState("");
  const [creatingSubdeck, setCreatingSubdeck] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchAllSubdecks, setSearchAllSubdecks] = useState(false);
  const [allSubdeckCards, setAllSubdeckCards] = useState<Card[]>([]);
  const [loadingSubdeckCards, setLoadingSubdeckCards] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Editor draft state.
  const [type, setType] = useState<"basic" | "cloze">("basic");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      jsonFetch<Deck>(`/api/flashcard-decks/${deckId}`),
      jsonFetch<{ cards: Card[] }>(`/api/flashcards?deckId=${deckId}`),
      jsonFetch<{ decks: Deck[] }>(`/api/flashcard-decks`),
    ])
      .then(([d, c, all]) => {
        setDeck(d);
        setCards(c.cards);
        const directSubs = all.decks.filter(x => x.parentId === deckId);
        setSubdecks(directSubs);
        setAllDecks(all.decks);
        // Auto-select the first card so the preview pane has something to show.
        if (c.cards.length > 0 && !selectedId) setSelectedId(c.cards[0]!.id);
      })
      .catch(() => toast({ title: "Could not load deck", variant: "destructive" }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, deckId, toast]);

  // Load all-subdeck cards when the toggle is turned on
  useEffect(() => {
    if (!user || !searchAllSubdecks) return;
    setLoadingSubdeckCards(true);
    jsonFetch<{ cards: Card[] }>(`/api/flashcards?deckId=${deckId}&includeSubdecks=1`)
      .then(c => setAllSubdeckCards(c.cards))
      .catch(() => toast({ title: "Could not load subdeck cards", variant: "destructive" }))
      .finally(() => setLoadingSubdeckCards(false));
  }, [user, deckId, searchAllSubdecks, toast]);

  async function createSubdeck() {
    if (!subdeckName.trim() || !deck) return;
    try {
      const created = await jsonFetch<Deck>("/api/flashcard-decks", {
        method: "POST",
        body: JSON.stringify({ name: subdeckName.trim(), subject: deck.subject, parentId: deck.id }),
      });
      setSubdecks(prev => [created, ...prev]);
      setSubdeckName("");
      setCreatingSubdeck(false);
      toast({ title: "Subdeck created" });
    } catch {
      toast({ title: "Could not create subdeck", variant: "destructive" });
    }
  }

  function startAdd() {
    setEditing(null); setType("basic"); setFront(""); setBack(""); setAdding(true);
  }
  function startEdit(c: Card) {
    setEditing(c); setType(c.type); setFront(c.front); setBack(c.back); setAdding(true);
  }

  async function saveCard() {
    if (!front.trim()) { toast({ title: "Front cannot be empty", variant: "destructive" }); return; }
    const finalType = hasCloze(front) ? "cloze" : type;
    try {
      if (editing) {
        const updated = await jsonFetch<Card>(`/api/flashcards/${editing.id}`, {
          method: "PUT", body: JSON.stringify({ type: finalType, front: encodeForWaf(front), back: encodeForWaf(back) }),
        });
        setCards(prev => prev.map(c => c.id === updated.id ? updated : c));
      } else {
        const created = await jsonFetch<Card>("/api/flashcards", {
          method: "POST", body: JSON.stringify({ deckId, type: finalType, front: encodeForWaf(front), back: encodeForWaf(back) }),
        });
        setCards(prev => [created, ...prev]);
        setSelectedId(created.id);
      }
      setAdding(false); setEditing(null);
      toast({ title: editing ? "Card updated" : "Card added" });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        toast({
          title: "Session expired",
          description: "Please log in again — your draft is still here.",
          variant: "destructive",
        });
      } else if (err instanceof HttpError) {
        toast({ title: `Could not save card (HTTP ${err.status})`, variant: "destructive" });
      } else {
        toast({ title: "Could not save card", variant: "destructive" });
      }
    }
  }

  async function deleteCard(id: string) {
    if (!confirm("Delete this card?")) return;
    try {
      await jsonFetch(`/api/flashcards/${id}`, { method: "DELETE" });
      setCards(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch {
      toast({ title: "Could not delete card", variant: "destructive" });
    }
  }

  async function moveCardToDeck(cardId: string, targetDeckId: string) {
    if (targetDeckId === deckId) return;
    const target = subdecks.find(s => s.id === targetDeckId);
    try {
      await jsonFetch(`/api/flashcards/${cardId}`, {
        method: "PUT", body: JSON.stringify({ deckId: targetDeckId }),
      });
      setCards(prev => prev.filter(c => c.id !== cardId));
      if (selectedId === cardId) setSelectedId(null);
      toast({
        title: `Moved to "${target?.name ?? "subdeck"}"`,
        description: "The card now lives in the subdeck.",
      });
    } catch {
      toast({ title: "Could not move card", variant: "destructive" });
    }
  }

  async function resetProgress() {
    if (!confirm("Reset spaced-repetition progress for all cards in this deck? Cards stay; only their schedules reset.")) return;
    try {
      await jsonFetch(`/api/flashcard-decks/${deckId}/reset`, { method: "POST" });
      const c = await jsonFetch<{ cards: Card[] }>(`/api/flashcards?deckId=${deckId}`);
      setCards(c.cards);
      toast({ title: "Progress reset" });
    } catch {
      toast({ title: "Could not reset", variant: "destructive" });
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/flashcard-decks/${deckId}/import`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json() as { created: number; truncatedTo?: number | null };
      const c = await jsonFetch<{ cards: Card[] }>(`/api/flashcards?deckId=${deckId}`);
      setCards(c.cards);
      toast({
        title: `Imported ${json.created} cards`,
        description: json.truncatedTo ? `(capped at ${json.truncatedTo})` : undefined,
      });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function applyAutoCloze() {
    const next = autoCloze(front, 3);
    setFront(next);
    setType("cloze");
  }

  // Build a map of deckId → deck name for all decks in the subtree
  const deckNameMap = useMemo(
    () => new Map(allDecks.map(d => [d.id, d.name])),
    [allDecks],
  );

  // All decks that are part of this deck's subtree (for move-to select)
  const subtreeDecks = useMemo(
    () => allDecks.filter(d => d.id !== deckId && (
      // Simple BFS-like: include anything that has deckId in its ancestor chain
      // For now we use allDecks and mark those whose parentId is in the subtree
      (() => {
        let cur: string | null = d.id;
        const visited = new Set<string>();
        while (cur && !visited.has(cur)) {
          visited.add(cur);
          const parent = allDecks.find(x => x.id === cur)?.parentId ?? null;
          if (parent === deckId) return true;
          cur = parent;
        }
        return false;
      })()
    )),
    [allDecks, deckId],
  );

  const activeCards = searchAllSubdecks ? allSubdeckCards : cards;

  const filteredCards = useMemo(() => {
    if (!search.trim()) return activeCards;
    const q = search.toLowerCase();
    return activeCards.filter(c =>
      stripMarkdown(c.front).toLowerCase().includes(q) ||
      stripMarkdown(c.back).toLowerCase().includes(q),
    );
  }, [activeCards, search]);

  const selectedCard = useMemo(
    () => filteredCards.find(c => c.id === selectedId) ?? null,
    [filteredCards, selectedId],
  );

  if (!user) return <div className="p-8 text-center text-muted-foreground">Sign in to use flashcards.</div>;
  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!deck) return <div className="p-8 text-center text-muted-foreground">Deck not found.</div>;

  const dueCount = cards.filter(c => new Date(c.dueAt) <= new Date()).length;

  return (
    <div className="max-w-7xl w-full mx-auto p-6 space-y-5">
      <Link href="/flashcards" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> All decks
      </Link>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{deck.name}</h1>
          {deck.description && <p className="text-sm text-muted-foreground mt-1">{deck.description}</p>}
          <p className="text-xs text-muted-foreground mt-2">
            {cards.length} card{cards.length === 1 ? "" : "s"} · {dueCount} due now
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate(`/flashcards/${deckId}/study`)}
            disabled={cards.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 hover:opacity-90"
            data-testid="button-study"
          >
            <Play className="w-4 h-4" /> Study {dueCount > 0 ? `(${dueCount})` : ""}
          </button>
          <button onClick={startAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/70" data-testid="button-add-card">
            <Plus className="w-4 h-4" /> Add card
          </button>
          <input
            ref={fileRef} type="file" accept=".apkg,.csv,.tsv,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
          />
          <button
            onClick={() => fileRef.current?.click()} disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/70 disabled:opacity-50"
            data-testid="button-import"
          >
            <Upload className="w-4 h-4" /> {importing ? "Importing…" : "Import"}
          </button>
          <button
            onClick={() => setCreatingSubdeck(s => !s)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/70"
            data-testid="button-add-subdeck" title="Create a nested subdeck under this one"
          >
            <FolderPlus className="w-4 h-4" /> Subdeck
          </button>
          <button
            onClick={resetProgress}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-muted-foreground hover:bg-secondary text-sm"
            title="Reset spaced-repetition state for all cards"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
        </div>
      </header>

      {creatingSubdeck && (
        <div className="bg-card border rounded-xl p-4 shadow-sm flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">
              Subdeck name
            </label>
            <input
              value={subdeckName}
              onChange={e => setSubdeckName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createSubdeck(); }}
              placeholder={`e.g. ${deck.name} · Topic 1`}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              autoFocus data-testid="input-subdeck-name"
            />
          </div>
          <button
            onClick={() => { setCreatingSubdeck(false); setSubdeckName(""); }}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={createSubdeck} disabled={!subdeckName.trim()}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
            data-testid="button-confirm-subdeck"
          >
            Create
          </button>
        </div>
      )}

      {subdecks.length > 0 && (
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
              Subdecks ({subdecks.length})
            </h3>
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <FolderInput className="w-3 h-3" /> Drag a card here to move it
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {subdecks.map(s => {
              const isOver = dragOverId === s.id;
              return (
                <div
                  key={s.id}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(s.id); }}
                  onDragLeave={() => setDragOverId(prev => prev === s.id ? null : prev)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverId(null);
                    const cardId = e.dataTransfer.getData("text/x-flashcard-id");
                    if (cardId) moveCardToDeck(cardId, s.id);
                  }}
                  className={`flex items-center gap-2 rounded-lg border transition-colors ${
                    isOver
                      ? "border-primary bg-primary/10 ring-2 ring-primary/40"
                      : "border-border/60 hover:bg-secondary/60"
                  }`}
                  data-testid={`subdeck-droptarget-${s.id}`}
                >
                  <Link href={`/flashcards/${s.id}`} className="flex items-center gap-2 p-2.5 flex-1 min-w-0">
                    <span className="text-sm font-medium truncate flex-1">{s.name}</span>
                    <span className="text-xs text-muted-foreground">→</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground -mt-2">
        Imports accept Anki <code>.apkg</code>, plain <code>.csv</code> / <code>.tsv</code>, or one card per line.
      </p>

      {adding && (
        <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3" data-testid="card-editor">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{editing ? "Edit card" : "Add card"}</h3>
            <button onClick={() => { setAdding(false); setEditing(null); }} className="p-1 rounded-full hover:bg-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2 text-xs">
            <button onClick={() => setType("basic")} className={`px-3 py-1 rounded-full font-semibold ${type === "basic" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
              Basic (Q + A)
            </button>
            <button onClick={() => setType("cloze")} className={`px-3 py-1 rounded-full font-semibold ${type === "cloze" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
              Cloze (fill-in-blank)
            </button>
            {type === "cloze" && (
              <button onClick={applyAutoCloze} className="ml-auto flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-300 hover:bg-amber-500/20" title="Pick up to 3 keywords automatically">
                <Wand2 className="w-3.5 h-3.5" /> Auto-blank keywords
              </button>
            )}
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">
              {type === "cloze" ? "Cloze text (use {{c1::word}})" : "Front (question)"}
            </label>
            <MarkdownEditor value={front} onChange={setFront} placeholder={type === "cloze" ? "The {{c1::mitochondria}} is the powerhouse of the cell." : "What is …?"} />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">
              {type === "cloze" ? "Optional explanation (shown after reveal)" : "Back (answer)"}
            </label>
            <MarkdownEditor value={back} onChange={setBack} placeholder="" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setEditing(null); }} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary">
              Cancel
            </button>
            <button onClick={saveCard} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90" data-testid="button-save-card">
              {editing ? "Save changes" : "Add card"}
            </button>
          </div>
        </div>
      )}

      {cards.length === 0 && !searchAllSubdecks ? (
        <div className="p-12 text-center bg-card border rounded-xl">
          <p className="text-sm text-muted-foreground">No cards yet — add one or import a file.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 items-start">
          {/* List */}
          <div className="bg-card border rounded-xl shadow-sm flex flex-col min-h-[320px] max-h-[calc(100vh-220px)]">
            <div className="p-3 border-b border-border/60 space-y-2">
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={searchAllSubdecks ? "Search all subdecks…" : "Search cards…"}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  data-testid="input-search-cards"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="p-1 rounded hover:bg-secondary">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {subdecks.length > 0 && (
                <button
                  onClick={() => {
                    setSearchAllSubdecks(s => !s);
                    setSelectedId(null);
                    setSearch("");
                  }}
                  className={`w-full flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
                    searchAllSubdecks
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                  title="Search cards across all subdecks and move them between subdecks"
                >
                  <Layers className="w-3 h-3" />
                  {searchAllSubdecks
                    ? `Searching all subdecks (${loadingSubdeckCards ? "…" : allSubdeckCards.length} cards)`
                    : "Search across all subdecks"}
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-border/60">
              {filteredCards.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center p-4">
                  {loadingSubdeckCards ? "Loading…" : "No matches."}
                </p>
              ) : filteredCards.map(c => {
                const isSelected = c.id === selectedId;
                const oneLine = stripMarkdown(c.type === "cloze" ? renderCloze(c.front).hidden : c.front);
                const cardDeckName = searchAllSubdecks && c.deckId !== deckId
                  ? deckNameMap.get(c.deckId)
                  : null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/x-flashcard-id", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={`w-full text-left p-3 flex items-start gap-2 transition-colors group ${
                      isSelected ? "bg-primary/10" : "hover:bg-secondary/50"
                    }`}
                    data-testid={`card-row-${c.id}`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 mt-1 shrink-0 cursor-grab active:cursor-grabbing" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
                          c.type === "cloze"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                            : "bg-blue-500/15 text-blue-600 dark:text-blue-300"
                        }`}>
                          {c.type}
                        </span>
                        {cardDeckName && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-300 truncate max-w-[120px]">
                            {cardDeckName}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground truncate">
                          {c.reps}r · {c.lapses}l · ease {c.ease.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2 leading-snug">{oneLine || <span className="italic text-muted-foreground">(empty)</span>}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="p-2 border-t border-border/60 text-[10px] text-muted-foreground flex items-center gap-1">
              <GripVertical className="w-3 h-3" /> Drag a card onto a subdeck above to move it.
            </div>
          </div>

          {/* Preview */}
          <div className="bg-card border rounded-xl shadow-sm p-5 sticky top-4 min-h-[320px]">
            {selectedCard ? (
              <CardPreview
                card={selectedCard}
                deckName={deckNameMap.get(selectedCard.deckId) ?? deck.name}
                subdecks={searchAllSubdecks ? subtreeDecks : subdecks}
                onEdit={() => startEdit(selectedCard)}
                onDelete={() => deleteCard(selectedCard.id)}
                onMove={(targetId) => moveCardToDeck(selectedCard.id, targetId)}
              />
            ) : (
              <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
                <Edit3 className="w-8 h-8 opacity-30" />
                <p className="text-sm">Select a card on the left to preview it.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CardPreview({
  card, deckName, subdecks, onEdit, onDelete, onMove,
}: {
  card: Card;
  deckName: string;
  subdecks: Deck[];
  onEdit: () => void;
  onDelete: () => void;
  onMove: (targetDeckId: string) => void;
}) {
  const [showAnswer, setShowAnswer] = useState(true);
  const due = new Date(card.dueAt);
  const dueLabel = due <= new Date()
    ? "Due now"
    : `Due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const front = card.type === "cloze"
    ? (showAnswer ? renderCloze(card.front).revealed : renderCloze(card.front).hidden)
    : card.front;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
            card.type === "cloze"
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
              : "bg-blue-500/15 text-blue-600 dark:text-blue-300"
          }`}>
            {card.type}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {deckName} · {dueLabel} · ease {card.ease.toFixed(2)} · {card.reps} rep{card.reps === 1 ? "" : "s"} · {card.lapses} lapse{card.lapses === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {subdecks.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { onMove(e.target.value); e.currentTarget.value = ""; } }}
              className="text-xs px-2 py-1 rounded-full bg-secondary border-0 hover:bg-secondary/70 cursor-pointer"
              title="Move to subdeck"
              data-testid="select-move-card"
            >
              <option value="">Move to…</option>
              {subdecks.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={onEdit} className="p-1.5 rounded-full text-muted-foreground hover:bg-secondary" title="Edit">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-full text-muted-foreground hover:bg-red-500/10 hover:text-red-600" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
          {card.type === "cloze" ? (showAnswer ? "Revealed" : "With blanks") : "Front"}
        </div>
        <div className="rounded-lg bg-background border p-4 study-card-prose">
          <MarkdownPreview value={front} />
        </div>
      </div>

      {card.back && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              {card.type === "cloze" ? "Notes" : "Back"}
            </div>
            <button
              onClick={() => setShowAnswer(s => !s)}
              className="text-[11px] text-primary hover:underline"
            >
              {showAnswer ? "Hide answer" : "Show answer"}
            </button>
          </div>
          {showAnswer && (
            <div className="rounded-lg bg-background border p-4 study-card-prose">
              <MarkdownPreview value={card.back} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
