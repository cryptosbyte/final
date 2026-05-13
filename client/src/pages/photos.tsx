import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  FolderPlus,
  Folder as FolderIcon,
  Upload,
  ArrowLeft,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronRight as Slash,
  Maximize2,
  Undo2,
  Check,
  Image as ImageIcon,
  Home,
  Lock,
  Globe,
  Link as LinkIcon,
} from "lucide-react";
import { useAuthContext } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PhotosSidebar } from "@/components/photos-sidebar";
import { PrivacyToggle } from "@/components/privacy-toggle";

interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

interface Photo {
  id: string;
  folderId: string | null;
  name: string;
  objectPath: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  deletedAt: string | null;
  isPublic: boolean;
}

const UNDO_WINDOW_MS = 5 * 60 * 1000;

function objectUrl(objectPath: string): string {
  // Backend stores objectPath as "/objects/<entityId>". The serving route is
  // GET /api/storage/objects/<entityId>, so strip a leading "/objects/" if present.
  const entityId = objectPath.replace(/^\/+/, "").replace(/^objects\//, "");
  return `/api/storage/objects/${entityId}`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export default function PhotosPage() {
  const { user, isLoading, login } = useAuthContext();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [matchFolder, folderParams] = useRoute("/photos/folder/:id");
  const [matchTrash] = useRoute("/photos/recently-deleted");

  const currentFolderId = matchFolder ? folderParams?.id ?? null : null;
  const showingTrash = !!matchTrash;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [recentlyDeleted, setRecentlyDeleted] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [renamingPhotoId, setRenamingPhotoId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("revision_tracker_photos_sidebar_open");
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("revision_tracker_photos_sidebar_open", sidebarOpen ? "1" : "0");
    } catch {}
  }, [sidebarOpen]);

  const currentFolder = useMemo(
    () => folders.find(f => f.id === currentFolderId) ?? null,
    [folders, currentFolderId],
  );

  const refreshFolders = useCallback(async () => {
    try {
      const data = await jsonFetch<{ folders: Folder[] }>("/api/folders");
      setFolders(data.folders);
    } catch (e) {
      // ignore (likely unauthenticated)
    }
  }, []);

  const refreshAllPhotos = useCallback(async () => {
    try {
      const data = await jsonFetch<{ photos: Photo[] }>("/api/photos?all=1");
      setAllPhotos(data.photos);
    } catch {
      // ignore
    }
  }, []);

  const refreshPhotos = useCallback(async () => {
    if (showingTrash) return;
    setLoading(true);
    try {
      const url = currentFolderId
        ? `/api/photos?folderId=${encodeURIComponent(currentFolderId)}`
        : "/api/photos";
      const data = await jsonFetch<{ photos: Photo[] }>(url);
      setPhotos(data.photos);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, showingTrash]);

  const refreshTrash = useCallback(async () => {
    if (!showingTrash) return;
    setLoading(true);
    try {
      const data = await jsonFetch<{ photos: Photo[] }>("/api/photos/recently-deleted");
      setRecentlyDeleted(data.photos);
    } catch {
      setRecentlyDeleted([]);
    } finally {
      setLoading(false);
    }
  }, [showingTrash]);

  useEffect(() => {
    if (!user) return;
    refreshFolders();
    refreshPhotos();
    refreshAllPhotos();
    refreshTrash();
  }, [user, refreshFolders, refreshPhotos, refreshAllPhotos, refreshTrash]);

  // Auto-refresh trash list every 30s so expired entries disappear
  useEffect(() => {
    if (!showingTrash) return;
    const id = window.setInterval(refreshTrash, 30_000);
    return () => window.clearInterval(id);
  }, [showingTrash, refreshTrash]);

  // Tick "now" once per second only while the trash view is open AND has items,
  // so countdowns update without burning CPU on other pages.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!showingTrash || recentlyDeleted.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showingTrash, recentlyDeleted.length]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      return;
    }
    try {
      await jsonFetch<Folder>("/api/folders", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewFolderName("");
      setCreatingFolder(false);
      refreshFolders();
    } catch (e) {
      toast({ title: "Could not create folder", description: String(e), variant: "destructive" });
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingFolderId(null);
      return;
    }
    try {
      await jsonFetch<Folder>(`/api/folders/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      setRenamingFolderId(null);
      refreshFolders();
    } catch (e) {
      toast({ title: "Rename failed", description: String(e), variant: "destructive" });
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Delete this folder? Photos inside will be moved out, not deleted.")) return;
    try {
      await jsonFetch(`/api/folders/${id}`, { method: "DELETE" });
      if (currentFolderId === id) navigate("/photos");
      refreshFolders();
      refreshPhotos();
      refreshAllPhotos();
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  const uploadOne = async (file: File): Promise<Photo | null> => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch("/api/storage/uploads/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(text || `Upload failed: ${uploadRes.status}`);
      }
      const { objectPath } = await uploadRes.json() as { objectPath: string };

      return await jsonFetch<Photo>("/api/photos", {
        method: "POST",
        body: JSON.stringify({
          folderId: currentFolderId,
          name: file.name,
          objectPath,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
    } catch (e) {
      toast({ title: `Upload failed: ${file.name}`, description: String(e), variant: "destructive" });
      return null;
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setUploading({ done: 0, total: arr.length });
    let done = 0;
    for (const file of arr) {
      await uploadOne(file);
      done += 1;
      setUploading({ done, total: arr.length });
    }
    setUploading(null);
    refreshPhotos();
    refreshAllPhotos();
  };

  const handleRenamePhoto = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingPhotoId(null);
      return;
    }
    try {
      await jsonFetch<Photo>(`/api/photos/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      setRenamingPhotoId(null);
      refreshPhotos();
      refreshAllPhotos();
    } catch (e) {
      toast({ title: "Rename failed", description: String(e), variant: "destructive" });
    }
  };

  const handleDeletePhoto = async (photo: Photo) => {
    try {
      await jsonFetch(`/api/photos/${photo.id}`, { method: "DELETE" });
      // Optimistic local remove
      setPhotos(prev => prev.filter(p => p.id !== photo.id));
      // Close lightbox if showing this image
      if (lightboxIdx !== null && photos[lightboxIdx]?.id === photo.id) setLightboxIdx(null);

      toast({
        title: "Photo deleted",
        description: `"${photo.name}" — undo within 5 minutes`,
        action: (
          <button
            onClick={async () => {
              try {
                await jsonFetch<Photo>(`/api/photos/${photo.id}/restore`, { method: "POST" });
                refreshPhotos();
                refreshAllPhotos();
                toast({ title: "Restored" });
              } catch (e) {
                toast({ title: "Restore failed", description: String(e), variant: "destructive" });
              }
            }}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <Undo2 className="w-3 h-3" /> Undo
          </button>
        ),
      });
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await jsonFetch<Photo>(`/api/photos/${id}/restore`, { method: "POST" });
      refreshTrash();
      refreshPhotos();
      refreshAllPhotos();
      toast({ title: "Photo restored" });
    } catch (e) {
      toast({ title: "Restore failed", description: String(e), variant: "destructive" });
    }
  };

  // ---------- Sidebar pick ----------
  const handlePickFromTree = useCallback(
    (photoId: string, folderId: string | null) => {
      const targetPath = folderId ? `/photos/folder/${folderId}` : "/photos";
      const onTarget =
        (folderId && currentFolderId === folderId) || (!folderId && !currentFolderId && !showingTrash);
      if (onTarget) {
        const idx = photos.findIndex(p => p.id === photoId);
        if (idx >= 0) setLightboxIdx(idx);
      } else {
        navigate(targetPath);
        // After navigation + refresh, open the photo when it appears.
        pendingOpenPhotoId.current = photoId;
      }
    },
    [currentFolderId, navigate, photos, showingTrash],
  );

  const pendingOpenPhotoId = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingOpenPhotoId.current) return;
    const idx = photos.findIndex(p => p.id === pendingOpenPhotoId.current);
    if (idx >= 0) {
      setLightboxIdx(idx);
      pendingOpenPhotoId.current = null;
    }
  }, [photos]);

  // ---------- Lightbox ----------
  const visiblePhotos = showingTrash ? recentlyDeleted : photos;

  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIdx(null);
      else if (e.key === "ArrowLeft") setLightboxIdx(i => (i === null ? null : Math.max(0, i - 1)));
      else if (e.key === "ArrowRight") setLightboxIdx(i => (i === null ? null : Math.min(visiblePhotos.length - 1, i + 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, visiblePhotos.length]);

  // ---------- Auth gate ----------
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
    );
  }
  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <ImageIcon className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-bold">Sign in to use Photos</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Photos and folders are stored in your account so you can access them across devices.
        </p>
        <Button onClick={login}>Sign in</Button>
      </div>
    );
  }

  // ---------- UI ----------
  const breadcrumbItems: { label: string; href?: string }[] = [
    { label: "Photos", href: "/photos" },
    ...(showingTrash ? [{ label: "Recently deleted" }] : []),
    ...(currentFolder ? [{ label: currentFolder.name }] : []),
  ];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {sidebarOpen ? (
        <PhotosSidebar
          folders={folders}
          allPhotos={allPhotos}
          currentFolderId={currentFolderId}
          showingTrash={showingTrash}
          onPickPhoto={handlePickFromTree}
          onClose={() => setSidebarOpen(false)}
          className="hidden lg:flex w-[240px] shrink-0 border-r border-border/60"
        />
      ) : (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="hidden lg:flex shrink-0 w-8 items-start justify-center pt-4 border-r border-border/60 bg-card/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="Show library"
          data-testid="button-open-sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
      <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-6 py-5 border-b bg-card/50 flex flex-col gap-2">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-[12px] text-muted-foreground min-w-0"
          data-testid="photos-breadcrumb"
        >
          {breadcrumbItems.map((item, i) => {
            const isLast = i === breadcrumbItems.length - 1;
            return (
              <span key={`${item.label}-${i}`} className="flex items-center gap-1 min-w-0">
                {i > 0 && <Slash className="w-3 h-3 shrink-0 opacity-60" />}
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="hover:text-foreground transition-colors truncate flex items-center gap-1"
                    data-testid={`breadcrumb-link-${i}`}
                  >
                    {i === 0 && <Home className="w-3 h-3 shrink-0" />}
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={`truncate flex items-center gap-1 ${isLast ? "text-foreground font-semibold" : ""}`}
                    data-testid={`breadcrumb-current-${i}`}
                  >
                    {i === 0 && <Home className="w-3 h-3 shrink-0" />}
                    {item.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 mr-auto min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate">
            {showingTrash ? "Recently deleted" : currentFolder ? currentFolder.name : "All Photos"}
          </h1>
        </div>

        {!showingTrash && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
              data-testid="input-photo-upload"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreatingFolder(true)}
              data-testid="button-new-folder"
            >
              <FolderPlus className="w-4 h-4 mr-1.5" /> New folder
            </Button>
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading !== null}
              data-testid="button-upload-photo"
            >
              <Upload className="w-4 h-4 mr-1.5" />
              {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : "Upload"}
            </Button>
          </>
        )}
        <Link
          href="/photos/recently-deleted"
          className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
            showingTrash ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
          data-testid="link-recently-deleted"
        >
          Recently deleted
        </Link>
        </div>
      </div>

      <div className="flex-1 px-6 py-5 space-y-6">
        {/* Folders */}
        {!showingTrash && !currentFolderId && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Folders</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {creatingFolder && (
                <div className="border border-dashed rounded-lg p-3 bg-card flex flex-col gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    placeholder="Folder name"
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleCreateFolder();
                      else if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                    }}
                    className="w-full text-sm border rounded px-2 py-1 bg-background"
                    data-testid="input-new-folder-name"
                  />
                  <div className="flex items-center gap-1">
                    <button onClick={handleCreateFolder} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground" data-testid="button-confirm-folder">
                      <Check className="w-3 h-3 inline" /> Save
                    </button>
                    <button onClick={() => { setCreatingFolder(false); setNewFolderName(""); }} className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {folders.map(f => (
                <div
                  key={f.id}
                  className="group border rounded-lg p-3 bg-card hover:bg-secondary/40 transition-colors"
                  data-testid={`card-folder-${f.id}`}
                >
                  {renamingFolderId === f.id ? (
                    <div className="flex flex-col gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleRenameFolder(f.id);
                          else if (e.key === "Escape") setRenamingFolderId(null);
                        }}
                        className="w-full text-sm border rounded px-2 py-1 bg-background"
                      />
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleRenameFolder(f.id)} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground">Save</button>
                        <button onClick={() => setRenamingFolderId(null)} className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-foreground">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Link
                        href={`/photos/folder/${f.id}`}
                        className="flex flex-col items-center gap-1.5"
                      >
                        <FolderIcon className="w-10 h-10 text-amber-500/80" fill="currentColor" />
                        <span className="text-sm font-medium text-center break-words w-full" title={f.name}>{f.name}</span>
                      </Link>
                      <div className="flex items-center justify-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setRenamingFolderId(f.id); setRenameValue(f.name); }}
                          className="text-xs text-muted-foreground hover:text-foreground p-1"
                          title="Rename"
                          data-testid={`button-rename-folder-${f.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteFolder(f.id)}
                          className="text-xs text-muted-foreground hover:text-destructive p-1"
                          title="Delete folder"
                          data-testid={`button-delete-folder-${f.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {folders.length === 0 && !creatingFolder && (
                <p className="col-span-full text-sm text-muted-foreground italic">No folders yet. Use "New folder" to organize past papers by year.</p>
              )}
            </div>
          </section>
        )}

        {/* Photos grid */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {showingTrash ? "Deleted within 5 minutes" : currentFolder ? "Photos in folder" : "Unfiled photos"}
          </h2>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="photos-skeleton">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="border rounded-lg overflow-hidden bg-card">
                  <div className="w-full aspect-square bg-secondary/40 animate-pulse" />
                  <div className="px-2 py-1.5 space-y-1">
                    <div className="h-3 w-4/5 rounded bg-secondary/60 animate-pulse" />
                    <div className="h-2.5 w-2/5 rounded bg-secondary/40 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : visiblePhotos.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {showingTrash ? "Nothing here. Deleted photos appear here for 5 minutes before being permanently removed." : "No photos yet. Click \"Upload\" to add some."}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {visiblePhotos.map((photo, idx) => {
                const isImage = photo.contentType.startsWith("image/");
                const url = objectUrl(photo.objectPath);
                return (
                  <div
                    key={photo.id}
                    className="group relative border rounded-lg overflow-hidden bg-card"
                    data-testid={`card-photo-${photo.id}`}
                  >
                    <button
                      onClick={() => !showingTrash && setLightboxIdx(idx)}
                      className="block w-full aspect-square bg-secondary/40 flex items-center justify-center"
                    >
                      {isImage ? (
                        <img
                          src={url}
                          alt={photo.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-muted-foreground p-2 text-center">
                          <ImageIcon className="w-8 h-8" />
                          <span className="text-[10px] uppercase">{photo.contentType.split("/")[1] || "file"}</span>
                        </div>
                      )}
                    </button>
                    <div className="px-2 py-1.5 flex items-start gap-1.5">
                      <div className="flex-1 min-w-0">
                        {renamingPhotoId === photo.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => handleRenamePhoto(photo.id)}
                            onKeyDown={e => {
                              if (e.key === "Enter") handleRenamePhoto(photo.id);
                              else if (e.key === "Escape") setRenamingPhotoId(null);
                            }}
                            className="w-full text-xs border rounded px-1.5 py-0.5 bg-background"
                          />
                        ) : (
                          <p className="text-xs truncate" title={photo.name}>{photo.name}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {format(parseISO(photo.uploadedAt), "d MMM yyyy")}
                        </p>
                      </div>
                      {!showingTrash && (
                        <PrivacyToggle
                          isPublic={photo.isPublic}
                          onToggle={async () => {
                            const next = !photo.isPublic;
                            const updated = await jsonFetch<Photo>(`/api/photos/${photo.id}`, {
                              method: "PUT",
                              body: JSON.stringify({ isPublic: next }),
                            }).catch(() => null);
                            if (updated) {
                              setPhotos(prev => prev.map(x => x.id === photo.id ? updated : x));
                              setAllPhotos(prev => prev.map(x => x.id === photo.id ? updated : x));
                              toast({
                                title: next ? "Photo set to public" : "Photo set to private",
                                description: next ? "Anyone with the link can view it on the public CDN." : "Only you can view it.",
                              });
                            }
                          }}
                          onCopyLink={async () => {
                            const link = `${window.location.origin}/api/photos/public/${photo.id}`;
                            try {
                              await navigator.clipboard.writeText(link);
                              toast({ title: "Public link copied", description: link });
                            } catch {
                              toast({ title: "Could not copy", description: link, variant: "destructive" });
                            }
                          }}
                          testIdSuffix={photo.id}
                        />
                      )}
                    </div>
                    {!showingTrash ? (
                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setLightboxIdx(idx)}
                          className="bg-black/60 text-white rounded p-1 hover:bg-black/80"
                          title="View"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => { setRenamingPhotoId(photo.id); setRenameValue(photo.name); }}
                          className="bg-black/60 text-white rounded p-1 hover:bg-black/80"
                          title="Rename"
                          data-testid={`button-rename-photo-${photo.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeletePhoto(photo)}
                          className="bg-black/60 text-white rounded p-1 hover:bg-red-600"
                          title="Delete"
                          data-testid={`button-delete-photo-${photo.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="absolute top-1 right-1">
                          <button
                            onClick={() => handleRestore(photo.id)}
                            className="bg-emerald-600 text-white rounded px-2 py-1 text-[10px] flex items-center gap-1 hover:bg-emerald-700"
                            data-testid={`button-restore-photo-${photo.id}`}
                          >
                            <Undo2 className="w-3 h-3" /> Restore
                          </button>
                        </div>
                        {photo.deletedAt && (() => {
                          const expiresAt = parseISO(photo.deletedAt).getTime() + UNDO_WINDOW_MS;
                          const remainingMs = Math.max(0, expiresAt - now);
                          const totalSec = Math.ceil(remainingMs / 1000);
                          const m = Math.floor(totalSec / 60);
                          const s = totalSec % 60;
                          const urgent = remainingMs <= 60_000;
                          return (
                            <div
                              className={`absolute top-1 left-1 px-1.5 py-0.5 rounded-md text-white text-[10px] font-bold tabular-nums flex items-center gap-1 ${urgent ? "bg-red-600/90 animate-pulse" : "bg-black/70"}`}
                              title={`Permanently deleted in ${m}m ${s}s`}
                              data-testid={`countdown-photo-${photo.id}`}
                            >
                              ⏱ {m}:{s.toString().padStart(2, "0")}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && visiblePhotos[lightboxIdx] && (() => {
        const p = visiblePhotos[lightboxIdx];
        const url = objectUrl(p.objectPath);
        const isImage = p.contentType.startsWith("image/");
        return (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
            onClick={() => setLightboxIdx(null)}
            data-testid="lightbox-overlay"
          >
            <div className="absolute top-3 right-3 flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
                className="text-white bg-white/10 rounded-full p-2 hover:bg-white/20"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(i => i === null ? null : Math.max(0, i - 1)); }}
              disabled={lightboxIdx === 0}
              className="absolute left-3 text-white bg-white/10 rounded-full p-2 hover:bg-white/20 disabled:opacity-30"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(i => i === null ? null : Math.min(visiblePhotos.length - 1, i + 1)); }}
              disabled={lightboxIdx === visiblePhotos.length - 1}
              className="absolute right-3 text-white bg-white/10 rounded-full p-2 hover:bg-white/20 disabled:opacity-30"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <div className="max-w-[90vw] max-h-[85vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
              {isImage ? (
                <img src={url} alt={p.name} className="max-w-full max-h-[80vh] object-contain rounded" />
              ) : (
                <div className="bg-card rounded-lg p-8 text-center">
                  <ImageIcon className="w-16 h-16 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm mb-3">{p.name}</p>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="underline text-primary">Open file</a>
                </div>
              )}
              <p className="text-white/80 text-xs mt-3">
                {p.name} · {format(parseISO(p.uploadedAt), "d MMM yyyy")} · {(p.size / 1024).toFixed(0)} KB
              </p>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
