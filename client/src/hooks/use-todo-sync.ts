import { useEffect, useRef } from "react";
import { notifyTodosChanged, type TodoItem } from "./use-todos";
import { syncReadyPromise } from "@/lib/device-sync";

const STORAGE_KEY = "revision_tracker_todos";
const PUSH_DEBOUNCE_MS = 800;

interface AuthUserLike {
  id: string;
}

function readLocalTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function writeLocalTodos(todos: TodoItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  notifyTodosChanged();
}

async function fetchServerTodos(): Promise<TodoItem[] | null> {
  try {
    const res = await fetch("/api/todos", {
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.todos) ? (json.todos as TodoItem[]) : null;
  } catch {
    return null;
  }
}

async function pushServerTodos(todos: TodoItem[]): Promise<boolean> {
  try {
    const res = await fetch("/api/todos", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todos }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Bidirectional todo sync between localStorage and the server.
 *
 * On user login (or app refresh while logged in):
 *  - If localStorage is empty, pull server todos into localStorage.
 *  - If localStorage has data, push it up to the server (local is source of truth).
 *
 * While logged in, any change to localStorage is debounced and pushed to the server.
 */
export function useTodoSync(user: AuthUserLike | null | undefined) {
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
      // Wait for the dominance check to settle so the source-of-truth
      // device wins on this initial sync.
      await syncReadyPromise;
      if (cancelled) return;
      const localAtStart = readLocalTodos();
      if (localAtStart.length === 0) {
        const server = await fetchServerTodos();
        if (cancelled) return;
        if (server && server.length > 0) {
          // Re-check local: the user may have added a todo while we were fetching.
          const localNow = readLocalTodos();
          if (localNow.length === 0) {
            writeLocalTodos(server);
          } else {
            // Merge: union by id, with local taking precedence for duplicates.
            const localIds = new Set(localNow.map((t) => t.id));
            const merged = [
              ...localNow,
              ...server.filter((t) => !localIds.has(t.id)),
            ];
            writeLocalTodos(merged);
            await pushServerTodos(merged);
          }
        }
      } else {
        await pushServerTodos(localAtStart);
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
        const todos = readLocalTodos();
        void pushServerTodos(todos);
      }, PUSH_DEBOUNCE_MS);
    };

    window.addEventListener("revision-tracker-todos-changed", onChange);
    return () => {
      window.removeEventListener("revision-tracker-todos-changed", onChange);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [user?.id]);
}
