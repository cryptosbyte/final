import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  claimDominance,
  clearLocalCachesForFreshPull,
  emitSyncState,
  fetchSyncState,
  getDeviceId,
  getDeviceLabel,
  getLastPullAt,
  isOlder,
  markSyncReady,
  setLastPullAt,
  type SyncState,
} from "@/lib/device-sync";

interface AuthUserLike { id: string }

/**
 * Coordinates cross-device sync. Run once at the app shell.
 *
 *  - On user login, asks the server who the dominant device is.
 *      • If no one is dominant or this device is dominant → ready immediately.
 *      • Otherwise, if the dominant device's syncedAt is newer than our
 *        local lastPullAt → wipe local caches, record the new lastPullAt,
 *        then unblock the rest of the syncs (which will pull from server
 *        because their localStorage is now empty).
 *  - Listens for Cmd/Ctrl+E to claim dominance from the active device.
 *
 * Returns the latest sync state for the UI badge.
 */
export function useDeviceSync(user: AuthUserLike | null | undefined) {
  const { toast } = useToast();
  const [state, setState] = useState<SyncState | null>(null);
  const [claiming, setClaiming] = useState(false);
  const lastUserRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  // Initial sync state check on login. For signed-out users, we still
  // unblock the gate so local-only flows work.
  useEffect(() => {
    const userId = user?.id ?? null;
    if (userId === lastUserRef.current) return;
    lastUserRef.current = userId;

    if (!userId) {
      if (!readyRef.current) { readyRef.current = true; markSyncReady(); }
      return;
    }

    let cancelled = false;
    (async () => {
      const remote = await fetchSyncState();
      if (cancelled) return;
      if (!remote) {
        // Fall back to local-only mode; never block the app forever.
        if (!readyRef.current) { readyRef.current = true; markSyncReady(); }
        return;
      }
      setState(remote);

      const myId = getDeviceId();
      const someoneElseDominant =
        !!remote.dominantDeviceId && remote.dominantDeviceId !== myId;
      const localPullAt = getLastPullAt();

      if (someoneElseDominant && isOlder(localPullAt, remote.dominantSyncedAt)) {
        // Server-wins: blow away local caches so the per-collection sync
        // hooks pull fresh data on their first effect.
        clearLocalCachesForFreshPull();
        if (remote.dominantSyncedAt) setLastPullAt(remote.dominantSyncedAt);
        toast({
          title: `Synced from ${remote.dominantDeviceLabel ?? "another device"}`,
          description: "This device just pulled the latest data from the cloud.",
        });
      }

      if (!readyRef.current) { readyRef.current = true; markSyncReady(); }
    })();
    return () => { cancelled = true; };
  }, [user?.id, toast]);

  // Cmd/Ctrl+E → claim dominance from this device.
  useEffect(() => {
    if (!user?.id) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Ignore if the user is editing text.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      if (claiming) return;
      setClaiming(true);
      try {
        const next = await claimDominance();
        if (next) {
          setState(next);
          emitSyncState(next);
          toast({
            title: `${getDeviceLabel()} is now your main device`,
            description: "Other devices will pull this device's data on their next load.",
          });
          // Trigger immediate push-up of currently-cached data so the
          // server snapshot reflects what's on screen right now.
          window.dispatchEvent(new Event("revision-tracker-todos-changed"));
          window.dispatchEvent(new CustomEvent("revision-tracker-bookmarks-changed"));
        } else {
          toast({ title: "Could not set dominant device", variant: "destructive" });
        }
      } finally {
        setClaiming(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user?.id, claiming, toast]);

  return { state, claiming };
}
