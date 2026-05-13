import { useState, useEffect, useCallback, useRef } from "react";
import type { AuthUser } from "@/lib/api-client";
import { syncReadyPromise } from "@/lib/device-sync";

export type RevisionType = "module_content" | "exam_practice" | "past_paper" | "mixed_exercises" | "anki_flashcards";
export type Subject = "biology" | "chemistry" | "maths";

export interface ExamPaperRecord {
  id: string;
  year?: number;
  paper: string;
  marksObtained?: number;
  totalMarks?: number;
  completed: boolean;
  isCustom: boolean;
  customLabel?: string;
}

export interface AnkiSessionRecord {
  id: string;
  topicId: string;
  hours: number;
}

export interface SubjectEntry {
  types: RevisionType[];
  productivity: number;
  moduleContent?: string[];
  examPaperRecords?: ExamPaperRecord[];
  ankiSessions?: AnkiSessionRecord[];
  notes?: string;
}

export interface DayEntry {
  date: string;
  subjects: Partial<Record<Subject, SubjectEntry>>;
  notes?: string;
}

export type RevisionData = Record<string, DayEntry>;

const STORAGE_KEY = "revision_tracker_data";

function loadFromStorage(): RevisionData {
  try {
    const item = localStorage.getItem(STORAGE_KEY);
    if (item) return JSON.parse(item);
  } catch {
    // ignore
  }
  return {};
}

function saveToStorage(data: RevisionData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

async function fetchRevisionData(): Promise<RevisionData> {
  const res = await fetch("/api/revision", { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data: Record<string, unknown> };
  return json.data as RevisionData;
}

async function upsertRevisionDay(date: string, entry: DayEntry): Promise<void> {
  await fetch(`/api/revision/${date}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
}

async function deleteRevisionDay(date: string): Promise<void> {
  await fetch(`/api/revision/${date}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export function useRevisionData(user: AuthUser | null) {
  const [data, setData] = useState<RevisionData>(loadFromStorage);
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (currentUserId === prevUserIdRef.current) return;
    prevUserIdRef.current = currentUserId;

    if (!currentUserId) {
      setSynced(false);
      setSyncing(false);
      return;
    }

    setSynced(false);
    setSyncing(true);

    let cancelled = false;
    (async () => {
      // Defer until cross-device dominance has been resolved so we don't
      // re-upload local-only days that the dominant device has deleted.
      await syncReadyPromise;
      if (cancelled) return;
      const localData = loadFromStorage();
      try {
        const apiData = await fetchRevisionData();
        if (cancelled) return;
        // Dates that exist locally but not on the server → upload them
        const localOnlyDates = Object.keys(localData).filter(
          (date) => !apiData[date],
        );

        let uploaded = 0;
        if (localOnlyDates.length > 0) {
          const results = await Promise.allSettled(
            localOnlyDates.map((date) =>
              upsertRevisionDay(date, localData[date]),
            ),
          );
          uploaded = results.filter((r) => r.status === "fulfilled").length;
        }

        // Merge: local data as base, API data takes precedence for any
        // dates that already existed on the server
        const merged = { ...localData, ...apiData };
        saveToStorage(merged);
        setData(merged);
        setUploadedCount(uploaded);
        setSynced(true);
        setSyncing(false);
      } catch {
        setSynced(true);
        setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) {
      saveToStorage(data);
    }
  }, [data, user]);

  const getDay = useCallback(
    (date: string): DayEntry | undefined => data[date],
    [data],
  );

  const updateDay = useCallback(
    (date: string, entry: DayEntry) => {
      setData((prev) => {
        const next = { ...prev, [date]: entry };
        saveToStorage(next);
        return next;
      });
      if (user) {
        upsertRevisionDay(date, entry).catch(() => {});
      }
    },
    [user],
  );

  const clearDay = useCallback(
    (date: string) => {
      setData((prev) => {
        const next = { ...prev };
        delete next[date];
        saveToStorage(next);
        return next;
      });
      if (user) {
        deleteRevisionDay(date).catch(() => {});
      }
    },
    [user],
  );

  return { data, getDay, updateDay, clearDay, synced, syncing, uploadedCount };
}
