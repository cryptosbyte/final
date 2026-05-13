import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronRight,
  ChevronLeft,
  Folder as FolderIcon,
  FolderOpen,
  Image as ImageIcon,
  FileText,
  Trash2,
  Home,
} from "lucide-react";

interface FolderLite {
  id: string;
  name: string;
}
interface PhotoLite {
  id: string;
  folderId: string | null;
  name: string;
  contentType: string;
}

interface PhotosSidebarProps {
  folders: FolderLite[];
  allPhotos: PhotoLite[];
  currentFolderId: string | null;
  showingTrash: boolean;
  onPickPhoto: (photoId: string, folderId: string | null) => void;
  onClose?: () => void;
  className?: string;
}

const TREE_ROOT_KEY = "revision_tracker_photos_tree_open";

function readOpenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(TREE_ROOT_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set(["__unfiled__"]);
}

function writeOpenSet(s: Set<string>) {
  try {
    localStorage.setItem(TREE_ROOT_KEY, JSON.stringify([...s]));
  } catch {}
}

export function PhotosSidebar({
  folders,
  allPhotos,
  currentFolderId,
  showingTrash,
  onPickPhoto,
  onClose,
  className = "",
}: PhotosSidebarProps) {
  const [, navigate] = useLocation();
  const [openIds, setOpenIds] = useState<Set<string>>(() => readOpenSet());

  // Auto-expand the active folder.
  useEffect(() => {
    if (!currentFolderId) return;
    setOpenIds(prev => {
      if (prev.has(currentFolderId)) return prev;
      const next = new Set(prev);
      next.add(currentFolderId);
      writeOpenSet(next);
      return next;
    });
  }, [currentFolderId]);

  const toggle = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeOpenSet(next);
      return next;
    });
  };

  const photosByFolder = useMemo(() => {
    const map: Record<string, PhotoLite[]> = { __unfiled__: [] };
    for (const f of folders) map[f.id] = [];
    for (const p of allPhotos) {
      const key = p.folderId ?? "__unfiled__";
      (map[key] = map[key] ?? []).push(p);
    }
    return map;
  }, [folders, allPhotos]);

  const totalCount = allPhotos.length;
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  const renderPhotoItem = (p: PhotoLite, folderId: string | null) => {
    const isImage = p.contentType.startsWith("image/");
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => onPickPhoto(p.id, folderId)}
        className="group flex items-center gap-1.5 w-full pl-7 pr-2 py-1 text-left rounded-md hover:bg-secondary/60 transition-colors"
        title={p.name}
        data-testid={`tree-photo-${p.id}`}
      >
        {isImage
          ? <ImageIcon className="w-3 h-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
          : <FileText className="w-3 h-3 shrink-0 text-muted-foreground group-hover:text-foreground" />}
        <span className="truncate text-[11.5px] text-muted-foreground group-hover:text-foreground">
          {p.name}
        </span>
      </button>
    );
  };

  const renderFolderRow = (
    id: string,
    label: string,
    href: string | null,
    photos: PhotoLite[],
    isActive: boolean,
  ) => {
    const isOpen = openIds.has(id);
    const Icon = isOpen ? FolderOpen : FolderIcon;
    return (
      <li key={id}>
        <div
          className={`flex items-center gap-1 rounded-md transition-colors ${
            isActive ? "bg-[hsl(var(--primary)/0.12)]" : "hover:bg-secondary/40"
          }`}
        >
          <button
            type="button"
            onClick={() => toggle(id)}
            className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? "Collapse" : "Expand"}
            data-testid={`tree-toggle-${id}`}
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          </button>
          {href ? (
            <Link
              href={href}
              className={`flex items-center gap-1.5 flex-1 min-w-0 py-1 pr-2 text-[12px] ${
                isActive ? "text-[hsl(var(--primary))] font-semibold" : "text-foreground/90 hover:text-foreground"
              }`}
              data-testid={`tree-link-${id}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-amber-500/80" fill="currentColor" />
              <span className="truncate">{label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {photos.length}
              </span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => toggle(id)}
              className="flex items-center gap-1.5 flex-1 min-w-0 py-1 pr-2 text-[12px] text-foreground/90 hover:text-foreground"
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {photos.length}
              </span>
            </button>
          )}
        </div>
        {isOpen && (
          <ul className="mt-0.5 mb-1 space-y-px">
            {photos.length === 0 ? (
              <li className="pl-7 pr-2 py-0.5 text-[10.5px] italic text-muted-foreground/70">
                Empty
              </li>
            ) : (
              photos.map(p => <li key={p.id}>{renderPhotoItem(p, p.folderId)}</li>)
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      className={`flex flex-col bg-card/40 overflow-hidden ${className}`}
      data-testid="photos-sidebar"
    >
      <div className="px-3 pt-4 pb-2 shrink-0 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground/90">
            Library
          </h2>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            {totalCount} item{totalCount === 1 ? "" : "s"} · {sortedFolders.length} folder
            {sortedFolders.length === 1 ? "" : "s"}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 -mt-1 -mr-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            title="Hide library"
            data-testid="button-close-sidebar"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        <button
          type="button"
          onClick={() => navigate("/photos")}
          className={`flex items-center gap-1.5 w-full px-2 py-1.5 mb-0.5 rounded-md text-[12px] transition-colors ${
            !currentFolderId && !showingTrash
              ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-semibold"
              : "text-foreground/90 hover:bg-secondary/40"
          }`}
          data-testid="tree-link-all-photos"
        >
          <Home className="w-3.5 h-3.5 shrink-0" />
          <span>All Photos</span>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {totalCount}
          </span>
        </button>

        <ul className="space-y-px">
          {renderFolderRow(
            "__unfiled__",
            "Unfiled",
            null,
            photosByFolder["__unfiled__"] ?? [],
            false,
          )}
          {sortedFolders.map(f =>
            renderFolderRow(
              f.id,
              f.name,
              `/photos/folder/${f.id}`,
              photosByFolder[f.id] ?? [],
              currentFolderId === f.id,
            ),
          )}
        </ul>
      </div>
      <div className="px-1.5 pb-2 shrink-0 pt-1.5 mt-auto">
        <button
          type="button"
          onClick={() => navigate("/photos/recently-deleted")}
          className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-[12px] transition-colors ${
            showingTrash
              ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-semibold"
              : "text-foreground/80 hover:bg-secondary/40"
          }`}
          data-testid="tree-link-trash"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          <span>Recently deleted</span>
        </button>
      </div>
    </aside>
  );
}
