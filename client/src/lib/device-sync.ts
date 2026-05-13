/**
 * Cross-device sync coordination.
 *
 * One device per user can be marked "dominant" (via Cmd/Ctrl+E). The
 * dominant device's local data is the source of truth: when any other
 * device loads, it pulls everything from the server before letting its
 * own local cache touch the wire.
 *
 * Mechanism:
 *  - Each browser persists a stable `deviceId` in localStorage.
 *  - The server tracks `{dominantDeviceId, dominantSyncedAt}` per user.
 *  - On app load, `useDeviceSync` blocks the other sync hooks (todos,
 *    bookmarks) via `syncReadyPromise` until it has either:
 *       a) confirmed this device is dominant (or no one is), or
 *       b) wiped local caches and recorded a new lastPullAt.
 *  - The other hooks await `syncReadyPromise` before deciding push-vs-pull.
 */

const DEVICE_ID_KEY = "revision_tracker_device_id";
const DEVICE_LABEL_KEY = "revision_tracker_device_label";
const LAST_PULL_KEY = "revision_tracker_last_pull_at";

export const TODOS_STORAGE_KEY = "revision_tracker_todos";
export const BOOKMARKS_STORAGE_KEY = "revision_tracker_bookmarks";
export const REVISION_STORAGE_KEY = "revision_tracker_data";

const SYNC_STATE_EVENT = "revision-tracker-sync-state";

export interface SyncState {
  dominantDeviceId: string | null;
  dominantDeviceLabel: string | null;
  dominantSyncedAt: string | null;
}

let resolveReady: () => void = () => {};
export const syncReadyPromise: Promise<void> = new Promise((r) => {
  resolveReady = r;
});
export function markSyncReady(): void {
  resolveReady();
}

export function getDeviceId(): string {
  let id = "";
  try { id = localStorage.getItem(DEVICE_ID_KEY) ?? ""; } catch {}
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch {}
  }
  return id;
}

export function getDeviceLabel(): string {
  try {
    const saved = localStorage.getItem(DEVICE_LABEL_KEY);
    if (saved) return saved;
  } catch {}
  return guessDeviceLabel();
}

export function setDeviceLabel(label: string): void {
  try { localStorage.setItem(DEVICE_LABEL_KEY, label); } catch {}
}

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua) && /Mobile/.test(ua)) return "Android phone";
  if (/Android/.test(ua)) return "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "This device";
}

export function getLastPullAt(): string | null {
  try { return localStorage.getItem(LAST_PULL_KEY); } catch { return null; }
}

export function setLastPullAt(iso: string): void {
  try { localStorage.setItem(LAST_PULL_KEY, iso); } catch {}
}

export async function fetchSyncState(): Promise<SyncState | null> {
  try {
    const res = await fetch("/api/sync/state", {
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    return (await res.json()) as SyncState;
  } catch {
    return null;
  }
}

export async function claimDominance(): Promise<SyncState | null> {
  try {
    const res = await fetch("/api/sync/claim", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), label: getDeviceLabel() }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as SyncState;
    if (json.dominantSyncedAt) setLastPullAt(json.dominantSyncedAt);
    window.dispatchEvent(new CustomEvent(SYNC_STATE_EVENT, { detail: json }));
    return json;
  } catch {
    return null;
  }
}

export function clearLocalCachesForFreshPull(): void {
  try {
    localStorage.removeItem(TODOS_STORAGE_KEY);
    localStorage.removeItem(BOOKMARKS_STORAGE_KEY);
    localStorage.removeItem(REVISION_STORAGE_KEY);
  } catch {}
}

export function isOlder(a: string | null, b: string | null): boolean {
  // Returns true if a is strictly older than b (a < b). Nulls treated as -Infinity.
  if (!b) return false;
  if (!a) return true;
  return new Date(a).getTime() < new Date(b).getTime();
}

export function onSyncStateChange(cb: (state: SyncState) => void): () => void {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<SyncState>;
    if (ce.detail) cb(ce.detail);
  };
  window.addEventListener(SYNC_STATE_EVENT, handler);
  return () => window.removeEventListener(SYNC_STATE_EVENT, handler);
}

export function emitSyncState(state: SyncState): void {
  window.dispatchEvent(new CustomEvent(SYNC_STATE_EVENT, { detail: state }));
}
