import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Save, Check, BookOpen, Image as ImageIcon, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { MarkdownEditor } from "@/components/markdown-editor";
import { PrivacyToggle } from "@/components/privacy-toggle";

type Tag = "maths" | "biology" | "chemistry" | "miscellaneous";
type Color = "blue" | "green" | "red" | "amber" | "purple" | "pink" | "teal" | "slate" | "orange" | "indigo";

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

interface LibraryPhoto {
  id: string;
  name: string;
  objectPath: string;
  contentType: string;
  uploadedAt: string;
  isPublic: boolean;
}

const TAG_LABELS: Record<Tag, string> = { maths: "Maths", biology: "Biology", chemistry: "Chemistry", miscellaneous: "Misc" };
const TAG_DOT: Record<Tag, string> = {
  maths: "hsl(var(--maths))",
  biology: "hsl(var(--biology))",
  chemistry: "hsl(var(--chemistry))",
  miscellaneous: "hsl(var(--muted-foreground))",
};
const TAGS: Tag[] = ["maths", "biology", "chemistry", "miscellaneous"];
const COLORS: Color[] = ["blue", "green", "red", "amber", "purple", "pink", "teal", "slate", "orange", "indigo"];
const COLOR_BG: Record<Color, string> = {
  blue: "bg-blue-500", green: "bg-emerald-500", red: "bg-rose-500", amber: "bg-amber-500",
  purple: "bg-purple-500", pink: "bg-pink-500", teal: "bg-teal-500", slate: "bg-slate-500",
  orange: "bg-orange-500", indigo: "bg-indigo-500",
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function uploadImageAsPhoto(file: File, isPublic: boolean): Promise<{ id: string; url: string } | null> {
  const upload = await jsonFetch<{ uploadURL: string; objectPath: string }>(
    "/api/storage/uploads/request-url",
    {
      method: "POST",
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    },
  );
  const putRes = await fetch(upload.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) return null;
  const created = await jsonFetch<{ id: string }>("/api/photos", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      objectPath: upload.objectPath,
      contentType: file.type,
      size: file.size,
    }),
  });
  await jsonFetch(`/api/photos/${created.id}`, {
    method: "PUT",
    body: JSON.stringify({ isPublic }),
  });
  return { id: created.id, url: `${window.location.origin}/api/photos/public/${created.id}` };
}

export default function NotebookPage() {
  const [, params] = useRoute("/resources/:id");
  const [, navigate] = useLocation();
  const id = params?.id;
  const { user, isLoading } = useAuthContext();
  const { toast } = useToast();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState<Tag>("miscellaneous");
  const [color, setColor] = useState<Color>("blue");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const insertCallbackRef = useRef<((markdown: string) => void) | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    (async () => {
      setLoading(true);
      try {
        const n = await jsonFetch<Notebook>(`/api/notebooks/${id}`);
        setNotebook(n);
        setContent(n.content);
        setTitle(n.title);
        setTag(n.tag);
        setColor(n.color);
        setIsPublic(n.isPublic);
      } catch {
        toast({ title: "Notebook not found", variant: "destructive" });
        navigate("/resources");
      } finally {
        setLoading(false);
      }
    })();
  }, [user, id, navigate, toast]);

  const save = useCallback(async (overrides?: Partial<Pick<Notebook, "content" | "title" | "tag" | "color" | "isPublic">>) => {
    if (!id) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        content: overrides?.content ?? content,
        title: (overrides?.title ?? title).trim() || "Untitled",
        tag: overrides?.tag ?? tag,
        color: overrides?.color ?? color,
        isPublic: overrides?.isPublic ?? isPublic,
      };
      const updated = await jsonFetch<Notebook>(`/api/notebooks/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setNotebook(updated);
      setSavedAt(new Date());
    } catch {
      toast({ title: "Could not save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [id, content, title, tag, color, isPublic, toast]);

  // Debounced auto-save on changes.
  useEffect(() => {
    if (!notebook) return;
    if (
      content === notebook.content &&
      title === notebook.title &&
      tag === notebook.tag &&
      color === notebook.color &&
      isPublic === notebook.isPublic
    ) {
      return;
    }
    const t = setTimeout(() => { save(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, title, tag, color, isPublic]);

  const handleTogglePublic = async () => {
    const next = !isPublic;
    setIsPublic(next);
    // Save right away so embedded photos get synced server-side immediately.
    await save({ isPublic: next });
    toast({
      title: next ? "Notebook is now public" : "Notebook is now private",
      description: next
        ? "Embedded photos in this notebook were also made public so the share link renders fully."
        : "Embedded photos in this notebook were made private too.",
    });
  };

  const handleCopyShareLink = async () => {
    if (!id) return;
    const link = `${window.location.origin}${import.meta.env.BASE_URL}r/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Share link copied", description: link });
    } catch {
      toast({ title: "Could not copy", description: link, variant: "destructive" });
    }
  };

  if (isLoading) return null;

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Please sign in to view notebooks.</p>
      </div>
    );
  }

  if (loading || !notebook) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3 flex-wrap">
        <Link href="/resources" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-resources">
          <ArrowLeft className="w-3.5 h-3.5" /> Library
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => save()}
          className="flex-1 min-w-[200px] text-lg font-bold tracking-tight bg-transparent focus:outline-none focus:ring-2 focus:ring-ring/30 rounded px-1"
          data-testid="input-notebook-title"
        />
        <PrivacyToggle
          isPublic={isPublic}
          onToggle={handleTogglePublic}
          onCopyLink={handleCopyShareLink}
          variant="full"
          testIdSuffix={`notebook-${notebook.id}`}
        />
        <div className="flex items-center gap-1">
          {TAGS.map(t => (
            <button
              key={t}
              onClick={() => setTag(t)}
              className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full transition-colors flex items-center gap-1 ${
                tag === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
              data-testid={`select-tag-${t}`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: TAG_DOT[t] }} />
              {TAG_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full ${COLOR_BG[c]} ring-2 transition-all ${color === c ? "ring-foreground/60 scale-110" : "ring-transparent hover:scale-110"}`}
              title={c}
              aria-label={c}
              data-testid={`select-color-${c}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground min-w-[120px] justify-end">
          {saving ? (
            <><div className="w-3 h-3 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin" /> Saving…</>
          ) : savedAt ? (
            <><Check className="w-3.5 h-3.5 text-emerald-500" /> Saved {format(savedAt, "HH:mm:ss")}</>
          ) : (
            <span>Auto-saves as you type</span>
          )}
          <Button size="sm" variant="outline" onClick={() => save()} className="h-7" data-testid="button-save-notebook">
            <Save className="w-3 h-3 mr-1" /> Save
          </Button>
        </div>
      </div>

      <div className="flex-1 px-6 py-6 max-w-5xl mx-auto w-full">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary hover:bg-secondary/80 text-foreground font-semibold transition-colors"
            data-testid="button-insert-from-library"
          >
            <ImageIcon className="w-3.5 h-3.5" /> Insert from photo library
          </button>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Imported photos inherit this notebook's privacy{isPublic ? " (currently public)" : " (currently private)"}.
          </span>
        </div>

        <MarkdownEditor
          value={content}
          onChange={setContent}
          defaultMode="preview"
          placeholder="Start writing… use the toolbar to add headings, images, links and embedded videos. Markdown and inline HTML supported."
          minRows={20}
          testId="notebook-editor"
          onImageUpload={async (file) => {
            try {
              const result = await uploadImageAsPhoto(file, isPublic);
              if (!result) {
                toast({ title: "Upload failed", variant: "destructive" });
                return null;
              }
              return result.url;
            } catch {
              toast({ title: "Upload failed", variant: "destructive" });
              return null;
            }
          }}
          registerInsert={(fn) => { insertCallbackRef.current = fn; }}
        />
        <p className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1">
          <BookOpen className="w-3 h-3" /> Tip: paste a YouTube or Vimeo URL via the embed button to drop a player into your notes.
        </p>
      </div>

      {pickerOpen && (
        <PhotoLibraryPicker
          notebookIsPublic={isPublic}
          onClose={() => setPickerOpen(false)}
          onPick={async (photo) => {
            // Inherit notebook privacy.
            try {
              await jsonFetch(`/api/photos/${photo.id}`, {
                method: "PUT",
                body: JSON.stringify({ isPublic }),
              });
            } catch {
              /* non-fatal: server-side notebook save will sync next time */
            }
            const url = `${window.location.origin}/api/photos/public/${photo.id}`;
            const safeName = photo.name.replace(/"/g, "");
            const md = `\n<img src="${url}" alt="${safeName}" width="100%" />\n`;
            if (insertCallbackRef.current) insertCallbackRef.current(md);
            else setContent(c => c + md);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PhotoLibraryPicker({
  notebookIsPublic,
  onClose,
  onPick,
}: {
  notebookIsPublic: boolean;
  onClose: () => void;
  onPick: (photo: LibraryPhoto) => void;
}) {
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await jsonFetch<{ photos: LibraryPhoto[] }>("/api/photos?all=1");
        setPhotos(data.photos.filter(p => p.contentType.startsWith("image/")));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = photos.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="photo-picker-overlay"
    >
      <div
        className="bg-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border/60 flex items-center gap-3">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-bold flex-1">Insert from photo library</h2>
          <span
            className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
              notebookIsPublic ? "bg-emerald-500/15 text-emerald-600" : "bg-secondary text-muted-foreground"
            }`}
          >
            Will be inserted as {notebookIsPublic ? "Public" : "Private"}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-border/60">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search photos by name…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
              data-testid="photo-picker-search"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square bg-secondary/40 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              {photos.length === 0 ? "No photos in your library yet — upload some on the Photos page first." : "No photos match your search."}
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3" data-testid="photo-picker-grid">
              {filtered.map(photo => {
                const entityId = photo.objectPath.replace(/^\/+/, "").replace(/^objects\//, "");
                const url = `/api/storage/objects/${entityId}`;
                return (
                  <button
                    key={photo.id}
                    onClick={() => onPick(photo)}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border/60 hover:ring-2 hover:ring-ring/40 transition-all hover:-translate-y-0.5"
                    data-testid={`picker-photo-${photo.id}`}
                    title={photo.name}
                  >
                    <img src={url} alt={photo.name} loading="lazy" className="w-full h-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                      <p className="text-[10px] text-white truncate">{photo.name}</p>
                    </div>
                    {photo.isPublic && (
                      <div className="absolute top-1 right-1 bg-emerald-500/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">PUBLIC</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
