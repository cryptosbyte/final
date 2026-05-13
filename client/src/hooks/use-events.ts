import { useEffect, useState } from "react";

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;      // yyyy-MM-dd
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  color: EventColorId;
  notes?: string;
}

export const EVENT_COLOR_OPTIONS = [
  { id: "indigo",    label: "General",   bg: "hsl(240 60% 58%)",            text: "#fff" },
  { id: "biology",   label: "Biology",   bg: "hsl(var(--biology))",          text: "#fff" },
  { id: "chemistry", label: "Chemistry", bg: "hsl(var(--chemistry))",        text: "#fff" },
  { id: "maths",     label: "Maths",     bg: "hsl(var(--maths))",            text: "#fff" },
  { id: "rose",      label: "Personal",  bg: "hsl(350 75% 58%)",             text: "#fff" },
  { id: "amber",     label: "Other",     bg: "hsl(40 92% 52%)",              text: "rgba(0,0,0,0.8)" },
] as const;

export type EventColorId = typeof EVENT_COLOR_OPTIONS[number]["id"];

const STORAGE_KEY = "revision_tracker_events";
const CHANGED_EVENT = "revision-tracker-events-changed";

function readEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function notifyEventsChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function addEventLocal(init: Omit<CalendarEvent, "id">): CalendarEvent {
  const events = readEvents();
  const ev: CalendarEvent = { ...init, id: crypto.randomUUID() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([ev, ...events])); } catch {}
  notifyEventsChanged();
  return ev;
}

export function updateEventLocal(id: string, patch: Partial<CalendarEvent>): void {
  const events = readEvents();
  const next = events.map(e => e.id === id ? { ...e, ...patch } : e);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  notifyEventsChanged();
}

export function deleteEventLocal(id: string): void {
  const events = readEvents();
  const next = events.filter(e => e.id !== id);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  notifyEventsChanged();
}

export function useEvents(): CalendarEvent[] {
  const [events, setEvents] = useState<CalendarEvent[]>(() => readEvents());

  useEffect(() => {
    const refresh = () => setEvents(readEvents());
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh(); };
    window.addEventListener(CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return events;
}
