import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { BookOpen, Plus, Trash2, Pencil, Search, X, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";

type Tag = "maths" | "biology" | "chemistry" | "miscellaneous";
type Color =
  | "blue"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "pink"
  | "teal"
  | "slate"
  | "orange"
  | "indigo";

interface Notebook {
  id: string;
  title: string;
  tag: Tag;
  color: Color;
  content: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

const TAG_LABELS: Record<Tag, string> = {
  maths: "Maths",
  biology: "Biology",
  chemistry: "Chemistry",
  miscellaneous: "Misc",
};

const TAG_DOT: Record<Tag, string> = {
  maths: "hsl(var(--maths))",
  biology: "hsl(var(--biology))",
  chemistry: "hsl(var(--chemistry))",
  miscellaneous: "hsl(var(--muted-foreground))",
};

const COLOR_CLASSES: Record<Color, { bg: string; ring: string; text: string; spineGrad: string }> = {
  blue:    { bg: "from-blue-400/90 to-blue-600",       ring: "ring-blue-500/30",    text: "text-white", spineGrad: "from-blue-700 to-blue-500" },
  green:   { bg: "from-emerald-400/90 to-emerald-600", ring: "ring-emerald-500/30", text: "text-white", spineGrad: "from-emerald-700 to-emerald-500" },
  red:     { bg: "from-rose-400/90 to-rose-600",       ring: "ring-rose-500/30",    text: "text-white", spineGrad: "from-rose-700 to-rose-500" },
  amber:   { bg: "from-amber-300/90 to-amber-500",     ring: "ring-amber-500/30",   text: "text-amber-950", spineGrad: "from-amber-700 to-amber-500" },
  purple:  { bg: "from-purple-400/90 to-purple-600",   ring: "ring-purple-500/30",  text: "text-white", spineGrad: "from-purple-700 to-purple-500" },
  pink:    { bg: "from-pink-400/90 to-pink-600",       ring: "ring-pink-500/30",    text: "text-white", spineGrad: "from-pink-700 to-pink-500" },
  teal:    { bg: "from-teal-400/90 to-teal-600",       ring: "ring-teal-500/30",    text: "text-white", spineGrad: "from-teal-700 to-teal-500" },
  slate:   { bg: "from-slate-400/90 to-slate-600",     ring: "ring-slate-500/30",   text: "text-white", spineGrad: "from-slate-700 to-slate-500" },
  orange:  { bg: "from-orange-400/90 to-orange-600",   ring: "ring-orange-500/30",  text: "text-white", spineGrad: "from-orange-700 to-orange-500" },
  indigo:  { bg: "from-indigo-400/90 to-indigo-600",   ring: "ring-indigo-500/30",  text: "text-white", spineGrad: "from-indigo-700 to-indigo-500" },
};

const COLORS: Color[] = ["blue", "green", "red", "amber", "purple", "pink", "teal", "slate", "orange", "indigo"];
const TAGS: Tag[] = ["maths", "biology", "chemistry", "miscellaneous"];

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function ResourcesPage() {
  const { user, isLoading, login } = useAuthContext();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Tag | "all">("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTag, setDraftTag] = useState<Tag>("miscellaneous");
  const [draftColor, setDraftColor] = useState<Color>("blue");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const data = await jsonFetch<{ notebooks: Notebook[] }>("/api/notebooks");
        setNotebooks(data.notebooks);
      } catch {
        setNotebooks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const filtered = useMemo(() => {
    return notebooks.filter(n => {
      if (filter !== "all" && n.tag !== filter) return false;
      if (search && !n.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [notebooks, filter, search]);

  const handleCreate = async () => {
    const title = draftTitle.trim();
    if (!title) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    try {
      const created = await jsonFetch<Notebook>("/api/notebooks", {
        method: "POST",
        body: JSON.stringify({ title, tag: draftTag, color: draftColor }),
      });
      setNotebooks(prev => [created, ...prev]);
      setCreating(false);
      setDraftTitle("");
      navigate(`/resources/${created.id}`);
    } catch {
      toast({ title: "Could not create notebook", variant: "destructive" });
    }
  };

  const handleDelete = async (n: Notebook) => {
    if (!confirm(`Delete "${n.title}"? This can't be undone.`)) return;
    try {
      await jsonFetch(`/api/notebooks/${n.id}`, { method: "DELETE" });
      setNotebooks(prev => prev.filter(x => x.id !== n.id));
    } catch {
      toast({ title: "Could not delete", variant: "destructive" });
    }
  };

  const handleRename = async (n: Notebook) => {
    const title = editTitle.trim();
    if (!title || title === n.title) {
      setEditingId(null);
      return;
    }
    try {
      const updated = await jsonFetch<Notebook>(`/api/notebooks/${n.id}`, {
        method: "PUT",
        body: JSON.stringify({ title }),
      });
      setNotebooks(prev => prev.map(x => x.id === n.id ? updated : x));
    } finally {
      setEditingId(null);
    }
  };

  if (isLoading) return null;

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <BookOpen className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h1 className="text-xl font-bold mb-2">Resources Library</h1>
          <p className="text-sm text-muted-foreground mb-4">Sign in to create notebooks and store rich revision notes with images and embedded videos.</p>
          <Button onClick={() => login()}>Sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/60 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          <h1 className="text-lg font-bold tracking-tight">Resources</h1>
          <span className="text-xs text-muted-foreground">· {notebooks.length} notebook{notebooks.length === 1 ? "" : "s"}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-7 pr-2 py-1.5 text-xs rounded-full border border-border/60 bg-background w-44 focus:w-56 transition-all focus:outline-none focus:ring-2 focus:ring-ring/30"
              data-testid="input-search-notebooks"
            />
          </div>
          <Button onClick={() => setCreating(true)} size="sm" className="rounded-full" data-testid="button-new-notebook">
            <Plus className="w-3.5 h-3.5 mr-1" /> New notebook
          </Button>
        </div>
        <div className="basis-full flex items-center gap-1.5 -mb-1">
          {(["all", ...TAGS] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors ${
                filter === t
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
              data-testid={`filter-tag-${t}`}
            >
              {t === "all" ? "All" : TAG_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* New notebook modal */}
      {creating && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreating(false)}>
          <div className="bg-card border border-border/60 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">New notebook</h2>
              <button onClick={() => setCreating(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Title</label>
                <input
                  autoFocus
                  type="text"
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
                  placeholder="e.g. Organic chemistry — mechanisms"
                  className="mt-1 w-full text-sm border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
                  data-testid="input-notebook-title"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subject tag</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {TAGS.map(t => (
                    <button
                      key={t}
                      onClick={() => setDraftTag(t)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                        draftTag === t ? "bg-secondary border-foreground/20" : "border-border/60 text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`tag-option-${t}`}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: TAG_DOT[t] }} />
                      {TAG_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Color</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setDraftColor(c)}
                      className={`w-7 h-7 rounded-full bg-gradient-to-br ${COLOR_CLASSES[c].bg} ring-2 transition-all ${draftColor === c ? "ring-foreground/60 scale-110" : "ring-transparent hover:scale-105"}`}
                      title={c}
                      aria-label={c}
                      data-testid={`color-option-${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={handleCreate} data-testid="button-create-notebook">Create & open</Button>
            </div>
          </div>
        </div>
      )}

      {/* Library grid */}
      <div className="flex-1 px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-xl bg-secondary/40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/60 mb-3" />
            <p className="text-sm text-muted-foreground">
              {notebooks.length === 0
                ? "No notebooks yet — create your first one to start building a revision library."
                : "No notebooks match your filters."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" data-testid="notebooks-grid">
            {filtered.map(n => {
              const cls = COLOR_CLASSES[n.color] ?? COLOR_CLASSES.blue;
              return (
                <div key={n.id} className="group relative" data-testid={`notebook-card-${n.id}`}>
                  <Link href={`/resources/${n.id}`}>
                    <div className={`relative aspect-[3/4] rounded-r-xl rounded-l-md overflow-hidden bg-gradient-to-br ${cls.bg} ring-1 ${cls.ring} shadow-lg hover:shadow-xl hover:-translate-y-1 hover:rotate-[-1deg] transition-all cursor-pointer`}>
                      {/* Spine */}
                      <div className={`absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-b ${cls.spineGrad} shadow-[inset_-2px_0_4px_rgba(0,0,0,0.3)]`} />
                      {/* Page edges */}
                      <div className="absolute right-0 top-1.5 bottom-1.5 w-1 bg-white/40 rounded-r-sm" />
                      {/* Tag dot */}
                      <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/25 backdrop-blur-sm rounded-full px-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: TAG_DOT[n.tag] }} />
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${cls.text}`}>{TAG_LABELS[n.tag]}</span>
                      </div>
                      {n.isPublic && (
                        <div
                          className="absolute top-3 left-4 flex items-center gap-1 bg-emerald-500/90 text-white rounded-full px-1.5 py-0.5 shadow-md animate-in fade-in"
                          title="Public — anyone with the link can view"
                          data-testid={`badge-public-${n.id}`}
                        >
                          <Globe className="w-2.5 h-2.5" />
                          <span className="text-[9px] font-bold uppercase tracking-wider">Public</span>
                        </div>
                      )}
                      {/* Icon */}
                      <BookOpen className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-12 h-12 opacity-25 ${cls.text}`} />
                      {/* Title */}
                      <div className="absolute inset-x-3 bottom-3 pl-2">
                        {editingId === n.id ? (
                          <input
                            autoFocus
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            onClick={e => e.preventDefault()}
                            onBlur={() => handleRename(n)}
                            onKeyDown={e => {
                              if (e.key === "Enter") handleRename(n);
                              else if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-full text-sm font-bold bg-black/30 text-white border border-white/40 rounded px-1.5 py-0.5"
                          />
                        ) : (
                          <p className={`text-sm font-bold leading-tight line-clamp-3 ${cls.text} drop-shadow-sm`}>{n.title}</p>
                        )}
                        <p className={`text-[10px] mt-1 opacity-80 ${cls.text}`}>{format(parseISO(n.updatedAt), "d MMM yyyy")}</p>
                      </div>
                    </div>
                  </Link>
                  <div className="absolute top-2 left-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingId(n.id); setEditTitle(n.title); }}
                      className="bg-black/40 hover:bg-black/60 text-white rounded p-1"
                      title="Rename"
                      data-testid={`button-rename-notebook-${n.id}`}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(n)}
                      className="bg-black/40 hover:bg-red-600 text-white rounded p-1"
                      title="Delete"
                      data-testid={`button-delete-notebook-${n.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
