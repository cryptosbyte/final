import { useState, useEffect, useRef } from "react";
import { Bookmark as BookmarkIcon, Plus, Pencil, Trash2, ExternalLink, X, Check, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { notifyBookmarksChanged, type BookmarkItem as Bookmark } from "@/hooks/use-bookmarks-sync";
import { TASK_SUBJECTS, TASK_SUBJECT_LABEL, type TaskSubject } from "@/hooks/use-todos";

const BOOKMARK_DRAG_TYPE = "application/x-rt-bookmark-id";

const STORAGE_KEY = "revision_tracker_bookmarks";
const CHANGE_EVENT = "revision-tracker-bookmarks-changed";

const PALETTE = [
  "var(--biology)",
  "var(--chemistry)",
  "var(--maths)",
  "var(--apple-orange)",
  "var(--apple-purple)",
  "var(--apple-teal)",
  "var(--apple-pink)",
];

// Display order for grouped sections (top → bottom).
const SUBJECT_ORDER: TaskSubject[] = ["biology", "chemistry", "maths", "miscellaneous"];

const SUBJECT_COLOR_VAR: Record<TaskSubject, string> = {
  biology: "var(--biology)",
  chemistry: "var(--chemistry)",
  maths: "var(--maths)",
  miscellaneous: "var(--apple-orange)",
};

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { id: "default-1", name: "Physics & Maths Tutor", url: "https://www.physicsandmathstutor.com/", color: "var(--maths)", subject: "maths" },
  { id: "default-2", name: "Save My Exams",         url: "https://www.savemyexams.com/",         color: "var(--biology)", subject: "biology" },
  { id: "default-3", name: "OCR Past Papers",       url: "https://www.ocr.org.uk/qualifications/past-paper-finder/", color: "var(--chemistry)", subject: "chemistry" },
  { id: "default-4", name: "Edexcel Past Papers",   url: "https://qualifications.pearson.com/en/support/support-topics/exams/past-papers.html", color: "var(--apple-orange)", subject: "miscellaneous" },
];

function withDefaults(list: Bookmark[]): Bookmark[] {
  // Existing rows in the DB have no `subject` field — default to miscellaneous
  // so the user can re-tag them themselves.
  return list.map(b => ({ ...b, subject: b.subject ?? "miscellaneous" }));
}

function loadBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return DEFAULT_BOOKMARKS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BOOKMARKS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_BOOKMARKS;
    return withDefaults(parsed as Bookmark[]);
  } catch {
    return DEFAULT_BOOKMARKS;
  }
}

function saveBookmarks(list: Bookmark[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    notifyBookmarksChanged();
  } catch {
    /* ignore */
  }
}

function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isValidUrl(input: string): boolean {
  try {
    const u = new URL(normaliseUrl(input));
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function effectiveSubject(b: Bookmark): TaskSubject {
  return b.subject ?? "miscellaneous";
}

export default function BookmarksPage() {
  const { toast } = useToast();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formColor, setFormColor] = useState(PALETTE[0]!);
  const [formSubject, setFormSubject] = useState<TaskSubject>("miscellaneous");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Skeleton state — show placeholder cards briefly while the cross-device
  // bookmark sync (in Layout) has a chance to pull from the server. We hide
  // the skeleton as soon as a bookmark-changed event fires, or after a short
  // timeout if nothing arrives.
  const [showSkeleton, setShowSkeleton] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!showSkeleton) return;
    const t = setTimeout(() => setShowSkeleton(false), 900);
    return () => clearTimeout(t);
  }, [showSkeleton]);

  // Drag-and-drop reorder state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const reorderBookmarks = (sourceId: string, targetId: string | null) => {
    if (sourceId === targetId) return;
    setBookmarks(prev => {
      const sourceIdx = prev.findIndex(b => b.id === sourceId);
      if (sourceIdx === -1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(sourceIdx, 1);
      if (!moved) return prev;
      let toInsert = moved;
      if (targetId === null) {
        next.push(toInsert);
      } else {
        const targetIdx = next.findIndex(b => b.id === targetId);
        if (targetIdx === -1) {
          next.push(toInsert);
        } else {
          // If dropped onto a card in a different subject section, adopt that
          // section so cross-section drag works as a re-tag affordance.
          const target = next[targetIdx]!;
          const targetSubject = effectiveSubject(target);
          if (effectiveSubject(toInsert) !== targetSubject) {
            toInsert = { ...toInsert, subject: targetSubject };
          }
          next.splice(targetIdx, 0, toInsert);
        }
      }
      return next;
    });
  };

  const handleBookmarkDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(BOOKMARK_DRAG_TYPE, id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };

  const handleBookmarkDragOver = (e: React.DragEvent, id: string) => {
    if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleBookmarkDrop = (e: React.DragEvent, targetId: string) => {
    if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return;
    e.preventDefault();
    const sourceId = e.dataTransfer.getData(BOOKMARK_DRAG_TYPE);
    setDragOverId(null);
    setDraggingId(null);
    if (!sourceId) return;
    reorderBookmarks(sourceId, targetId);
  };

  const handleBookmarkDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    const refresh = () => {
      const fresh = loadBookmarks();
      setBookmarks(prev => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
      setShowSkeleton(false);
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if ((adding || editingId) && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [adding, editingId]);

  const resetForm = () => {
    setFormName("");
    setFormUrl("");
    setFormColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]!);
    setFormSubject("miscellaneous");
  };

  const startAdd = () => {
    resetForm();
    setEditingId(null);
    setAdding(true);
  };

  const startEdit = (b: Bookmark) => {
    setAdding(false);
    setEditingId(b.id);
    setFormName(b.name);
    setFormUrl(b.url);
    setFormColor(b.color);
    setFormSubject(effectiveSubject(b));
  };

  const cancelForm = () => {
    setAdding(false);
    setEditingId(null);
    resetForm();
  };

  const submitForm = () => {
    const name = formName.trim();
    const url = normaliseUrl(formUrl);
    if (!name) {
      toast({ title: "Name required", description: "Give your bookmark a name." });
      return;
    }
    if (!isValidUrl(url)) {
      toast({ title: "Invalid link", description: "Enter a valid URL like example.com" });
      return;
    }
    if (editingId) {
      setBookmarks(prev => prev.map(b => b.id === editingId ? { ...b, name, url, color: formColor, subject: formSubject } : b));
      toast({ title: "Bookmark updated" });
    } else {
      const newBookmark: Bookmark = {
        id: crypto.randomUUID(),
        name,
        url,
        color: formColor,
        subject: formSubject,
      };
      setBookmarks(prev => [newBookmark, ...prev]);
      toast({ title: "Bookmark added" });
    }
    cancelForm();
  };

  const deleteBookmark = (id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
    toast({ title: "Bookmark removed" });
  };

  const isFormOpen = adding || editingId !== null;

  // Group bookmarks by subject while preserving the user's flat-array order
  // within each section.
  const grouped: Record<TaskSubject, Bookmark[]> = {
    biology: [],
    chemistry: [],
    maths: [],
    miscellaneous: [],
  };
  for (const b of bookmarks) grouped[effectiveSubject(b)].push(b);

  return (
    <div className="flex-1 px-5 py-5 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
              <BookmarkIcon className="w-6 h-6" strokeWidth={2.25} />
              Bookmarks
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Quick links to your revision sites. Click any card to open in a new tab.
            </p>
          </div>
          {!isFormOpen && (
            <button
              onClick={startAdd}
              data-testid="button-add-bookmark"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12.5px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={3} />
              Add bookmark
            </button>
          )}
        </div>

        {isFormOpen && (
          <div
            className="mb-5 p-4 rounded-2xl border border-border/60 bg-card shadow-sm"
            data-testid="bookmark-form"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                {editingId ? "Edit bookmark" : "New bookmark"}
              </h2>
              <button
                onClick={cancelForm}
                className="w-7 h-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Cancel"
                data-testid="button-cancel-bookmark"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && submitForm()}
                  placeholder="My revision site"
                  data-testid="input-bookmark-name"
                  className="mt-1 w-full text-[13.5px] bg-secondary/60 border border-transparent focus:border-primary/40 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Link
                </label>
                <input
                  type="text"
                  inputMode="url"
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && submitForm()}
                  placeholder="example.com"
                  data-testid="input-bookmark-url"
                  className="mt-1 w-full text-[13.5px] bg-secondary/60 border border-transparent focus:border-primary/40 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Subject
              </label>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {TASK_SUBJECTS.map(s => {
                  const active = formSubject === s;
                  const tint = SUBJECT_COLOR_VAR[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFormSubject(s)}
                      data-testid={`bookmark-subject-${s}`}
                      className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full transition-all"
                      style={
                        active
                          ? {
                              background: `hsl(${tint})`,
                              color: "white",
                              boxShadow: `0 1px 6px -1px hsl(${tint} / 0.55)`,
                            }
                          : {
                              background: `hsl(${tint} / 0.12)`,
                              color: `hsl(${tint})`,
                              border: `1px solid hsl(${tint} / 0.25)`,
                            }
                      }
                    >
                      {TASK_SUBJECT_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-3">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Colour
              </label>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {PALETTE.map(c => {
                  const active = formColor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      aria-label={`Colour ${c}`}
                      className={`w-7 h-7 rounded-full transition-transform ${active ? "ring-2 ring-foreground ring-offset-2 ring-offset-card scale-110" : "hover:scale-110"}`}
                      style={{ background: `hsl(${c})` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={cancelForm}
                className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitForm}
                data-testid="button-save-bookmark"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                {editingId ? "Save" : "Add"}
              </button>
            </div>
          </div>
        )}

        {showSkeleton ? (
          <div className="space-y-6" data-testid="bookmarks-skeleton">
            {[0, 1].map(section => (
              <div key={section}>
                <div className="h-4 w-28 mb-3 rounded bg-secondary/60 animate-pulse" />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border border-border/60 bg-card p-4">
                      <div className="w-10 h-10 rounded-xl bg-secondary/60 animate-pulse mb-3" />
                      <div className="h-3 w-4/5 rounded bg-secondary/60 animate-pulse mb-2" />
                      <div className="h-2.5 w-2/5 rounded bg-secondary/40 animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            <BookmarkIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No bookmarks yet. Add your first one above.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground mb-4 flex items-center gap-1.5">
              <GripVertical className="w-3 h-3" />
              Drag any card to reorder. Drop onto a card in another section to re-tag it.
            </p>
            <div className="space-y-7">
              {SUBJECT_ORDER.map(subject => {
                const items = grouped[subject];
                if (items.length === 0) return null;
                const tint = SUBJECT_COLOR_VAR[subject];
                return (
                  <section key={subject} data-testid={`bookmarks-section-${subject}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <h2
                        className="text-[12px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: `hsl(${tint})` }}
                      >
                        {TASK_SUBJECT_LABEL[subject]}
                      </h2>
                      <span
                        className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          background: `hsl(${tint} / 0.12)`,
                          color: `hsl(${tint})`,
                        }}
                      >
                        {items.length}
                      </span>
                      <div
                        className="flex-1 h-px"
                        style={{ background: `hsl(${tint} / 0.22)` }}
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {items.map(b => {
                        const isDragging = draggingId === b.id;
                        const isDropOver = dragOverId === b.id && draggingId !== b.id;
                        return (
                          <div
                            key={b.id}
                            draggable
                            onDragStart={(e) => handleBookmarkDragStart(e, b.id)}
                            onDragOver={(e) => handleBookmarkDragOver(e, b.id)}
                            onDragLeave={() => setDragOverId(prev => (prev === b.id ? null : prev))}
                            onDrop={(e) => handleBookmarkDrop(e, b.id)}
                            onDragEnd={handleBookmarkDragEnd}
                            className={`group relative transition-all ${
                              isDragging ? "opacity-40 scale-[0.98]" : "opacity-100"
                            } ${
                              isDropOver
                                ? "ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-background rounded-2xl"
                                : ""
                            }`}
                            data-testid={`bookmark-${b.id}`}
                          >
                            <a
                              href={b.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              className="block p-4 rounded-2xl border border-border/60 bg-card hover:shadow-lg hover:-translate-y-1 hover:scale-[1.02] hover:border-border transition-all duration-200 ease-out cursor-grab active:cursor-grabbing active:scale-[0.99]"
                              data-testid={`bookmark-link-${b.id}`}
                            >
                              <div
                                className="w-10 h-10 rounded-xl grid place-items-center text-white font-bold text-[14px] mb-3 shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:rotate-[-4deg]"
                                style={{
                                  background: `linear-gradient(135deg, hsl(${b.color}), color-mix(in srgb, hsl(${b.color}) 65%, white))`,
                                }}
                              >
                                {getInitials(b.name)}
                              </div>
                              <div className="text-[13px] font-semibold leading-tight line-clamp-2 mb-1">
                                {b.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                <span className="truncate">{hostnameOf(b.url)}</span>
                              </div>
                            </a>
                            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/70" />
                            </div>
                            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              <button
                                onClick={() => startEdit(b)}
                                title="Edit"
                                aria-label={`Edit ${b.name}`}
                                data-testid={`button-edit-bookmark-${b.id}`}
                                className="w-7 h-7 rounded-full grid place-items-center bg-secondary/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteBookmark(b.id)}
                                title="Delete"
                                aria-label={`Delete ${b.name}`}
                                data-testid={`button-delete-bookmark-${b.id}`}
                                className="w-7 h-7 rounded-full grid place-items-center bg-secondary/90 backdrop-blur-sm text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
