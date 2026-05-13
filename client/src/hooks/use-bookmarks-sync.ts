import { useEffect, useRef } from "react";
import type { TaskSubject } from "./use-todos";
import { syncReadyPromise } from "@/lib/device-sync";
import { encodeForWaf } from "@/lib/b64-payload";

const STORAGE_KEY = "revision_tracker_bookmarks";
const CHANGE_EVENT = "revision-tracker-bookmarks-changed";
const PUSH_DEBOUNCE_MS = 800;

export interface BookmarkItem {
  id: string;
  name: string;
  url: string;
  color: string;
  subject?: TaskSubject;
}

interface AuthUserLike {
  id: string;
}

export function notifyBookmarksChanged() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function readLocal(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as BookmarkItem[];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeLocal(items: BookmarkItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  notifyBookmarksChanged();
}

async function fetchServer(): Promise<BookmarkItem[] | null> {
  try {
    const res = await fetch("/api/bookmarks", {
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.bookmarks) ? (json.bookmarks as BookmarkItem[]) : null;
  } catch {
    return null;
  }
}

async function pushServer(items: BookmarkItem[]): Promise<boolean> {
  try {
    const res = await fetch("/api/bookmarks", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: items.map(b => ({ ...b, name: encodeForWaf(b.name), url: encodeForWaf(b.url) })) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Bidirectional bookmark sync between localStorage and the server.
 * Mirrors the todo sync pattern.
 */
export function useBookmarksSync(user: AuthUserLike | null | undefined) {
  const userIdRef = useRef<string | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSyncDoneRef = useRef(false);

  useEffect(() => {
    const currentUserId = user?.id ?? null;

    if (currentUserId !== userIdRef.current) {
      initialSyncDoneRef.current = false;
      userIdRef.current = currentUserId;
    }

    if (!currentUserId) return;
    if (initialSyncDoneRef.current) return;

    initialSyncDoneRef.current = true;

    let cancelled = false;
    (async () => {
      await syncReadyPromise;
      if (cancelled) return;
      const localAtStart = readLocal();
      if (localAtStart.length === 0) {
        const server = await fetchServer();
        if (cancelled) return;
        if (server && server.length > 0) {
          const localNow = readLocal();
          if (localNow.length === 0) {
            writeLocal(server);
          } else {
            const localIds = new Set(localNow.map(b => b.id));
            const merged = [
              ...localNow,
              ...server.filter(b => !localIds.has(b.id)),
            ];
            writeLocal(merged);
            await pushServer(merged);
          }
        }
      } else {
        await pushServer(localAtStart);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const onChange = () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(() => {
        const items = readLocal();
        void pushServer(items);
      }, PUSH_DEBOUNCE_MS);
    };

    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [user?.id]);
}
