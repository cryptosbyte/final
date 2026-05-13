import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { X, Plus, Trash2, Check, Clock, GripVertical, CalendarDays } from "lucide-react";
import {
  useTodos,
  addTodoLocal,
  updateTodoLocal,
  deleteTodoLocal,
  completeTodoLocal,
  type TodoItem,
  type TaskSubject,
  TASK_SUBJECTS,
  TASK_SUBJECT_LABEL,
} from "@/hooks/use-todos";
import {
  useEvents,
  addEventLocal,
  updateEventLocal,
  deleteEventLocal,
  EVENT_COLOR_OPTIONS,
  type CalendarEvent,
  type EventColorId,
} from "@/hooks/use-events";

export const RT_TODO_DRAG_TYPE = "application/x-rt-todo-id";

interface DayTimelineModalProps {
  date: string | null;
  onClose: () => void;
  anchorRect?: DOMRect | null;
}

const POPOVER_WIDTH = 400;
const POPOVER_MAX_HEIGHT_VH = 72;
const POPOVER_GAP = 8;

function computePopoverPosition(rect: DOMRect | null | undefined): { top: number; left: number } {
  if (!rect || typeof window === "undefined") return { top: 80, left: 80 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popHeight = Math.min(vh * (POPOVER_MAX_HEIGHT_VH / 100), 580);
  let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
  left = Math.max(12, Math.min(left, vw - POPOVER_WIDTH - 12));
  let top = rect.bottom + POPOVER_GAP;
  if (top + popHeight > vh - 12) {
    top = Math.max(12, rect.top - popHeight - POPOVER_GAP);
  }
  return { top, left };
}

const SUBJECT_COLOR: Record<TaskSubject, string> = {
  biology:       "hsl(var(--biology))",
  chemistry:     "hsl(var(--chemistry))",
  maths:         "hsl(var(--maths))",
  miscellaneous: "hsl(var(--muted-foreground))",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function pad(n: number) { return n.toString().padStart(2, "0"); }

function todoHour(todo: TodoItem): number | "all-day" {
  if (!todo.deadline) return "all-day";
  if (!todo.deadline.includes("T")) return "all-day";
  const h = parseInt((todo.deadline.split("T")[1] ?? "00:00").slice(0, 2), 10);
  return Number.isFinite(h) ? h : "all-day";
}

function eventHour(ev: CalendarEvent): number {
  const h = parseInt(ev.startTime.slice(0, 2), 10);
  return Number.isFinite(h) ? h : 0;
}

// What type picker is currently open (null = none)
type TypePickerHour = number | "all-day" | null;

const EVENT_DRAFT_ID = "__rt_timeline_event_draft__";

export function DayTimelineModal({ date, onClose, anchorRect }: DayTimelineModalProps) {
  const allTodos = useTodos();
  const allEvents = useEvents();
  const isPopover = !!anchorRect;

  // Task editing state
  const DRAFT_ID = "__rt_timeline_draft__";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editTime, setEditTime] = useState("09:00");
  const [editSubject, setEditSubject] = useState<TaskSubject>("miscellaneous");
  const [draftHour, setDraftHour] = useState<number | "all-day" | null>(null);
  const [dragOverHour, setDragOverHour] = useState<number | "all-day" | null>(null);

  // Type picker: which hour is showing the "Task | Event" choice
  const [typePickerHour, setTypePickerHour] = useState<TypePickerHour>(null);

  // Event editing/creation state
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDraftHour, setEventDraftHour] = useState<number | null>(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventStartTime, setEventStartTime] = useState("09:00");
  const [eventEndTime, setEventEndTime] = useState("10:00");
  const [eventColor, setEventColor] = useState<EventColorId>("indigo");

  const editInputRef = useRef<HTMLInputElement>(null);
  const eventTitleRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hourRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState(() => computePopoverPosition(anchorRect ?? null));

  useLayoutEffect(() => {
    if (!isPopover || !date) return;
    setPopoverPos(computePopoverPosition(anchorRect ?? null));
  }, [isPopover, date, anchorRect]);

  useEffect(() => {
    if (!date) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (editingId !== null || editingEventId !== null || typePickerHour !== null) {
        cancelEdit();
        cancelEventEdit();
        setTypePickerHour(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [date, editingId, editingEventId, typePickerHour, onClose]);

  useEffect(() => {
    if (!isPopover || !date) return;
    const onDown = (e: MouseEvent) => {
      if (editingId !== null || editingEventId !== null) return;
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isPopover, date, editingId, editingEventId, onClose]);

  useEffect(() => {
    if (!date) {
      setDraftHour(null);
      setTypePickerHour(null);
      setEditingEventId(null);
      if (editingId === DRAFT_ID) setEditingId(null);
    }
  }, [date, editingId]);

  useEffect(() => {
    if (!date || isPopover) return;
    const now = new Date();
    const focusHour = date === format(now, "yyyy-MM-dd") ? Math.max(0, now.getHours() - 1) : 8;
    setTimeout(() => {
      hourRefs.current[focusHour]?.scrollIntoView({ block: "start", behavior: "auto" });
    }, 30);
  }, [date, isPopover]);

  useEffect(() => {
    if (!isPopover || !date) return;
    setTimeout(() => {
      const target = hourRefs.current[8];
      if (target && scrollRef.current) {
        scrollRef.current.scrollTop = target.offsetTop - scrollRef.current.offsetTop;
      }
    }, 30);
  }, [isPopover, date]);

  const todosForDay = useMemo(() => {
    if (!date) return [];
    return allTodos.filter(t => {
      if (!t.deadline) return false;
      const d = t.deadline.includes("T") ? t.deadline.split("T")[0] : t.deadline;
      return d === date;
    });
  }, [allTodos, date]);

  const eventsForDay = useMemo(() => {
    if (!date) return [];
    return allEvents.filter(e => e.date === date);
  }, [allEvents, date]);

  const groupedByHour = useMemo(() => {
    const out: Record<number, TodoItem[]> = {};
    const allDay: TodoItem[] = [];
    for (const t of todosForDay) {
      const h = todoHour(t);
      if (h === "all-day") { allDay.push(t); continue; }
      (out[h] = out[h] ?? []).push(t);
    }
    return { byHour: out, allDay };
  }, [todosForDay]);

  const eventsByHour = useMemo(() => {
    const out: Record<number, CalendarEvent[]> = {};
    for (const ev of eventsForDay) {
      const h = eventHour(ev);
      (out[h] = out[h] ?? []).push(ev);
    }
    return out;
  }, [eventsForDay]);

  if (!date) return null;

  const dateLabel = format(parseISO(date), "EEEE, do MMMM yyyy");

  // ── Task editing ──────────────────────────────────────────────────────────

  const startEdit = (todo: TodoItem) => {
    setEditingId(todo.id);
    setEditText(todo.text);
    const time = todo.deadline?.includes("T") ? (todo.deadline.split("T")[1] ?? "").slice(0, 5) : "";
    setEditTime(time || "09:00");
    setEditSubject(todo.subject ?? "miscellaneous");
    setTimeout(() => { editInputRef.current?.focus(); editInputRef.current?.select(); }, 30);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const text = editText.trim();
    if (editingId === DRAFT_ID) {
      if (!text) { setDraftHour(null); setEditingId(null); return; }
      const deadline = draftHour === "all-day" ? (date ?? "") : `${date}T${editTime}`;
      addTodoLocal({ text, deadline, subject: editSubject });
      setDraftHour(null);
      setEditingId(null);
      return;
    }
    if (!text) { setEditingId(null); return; }
    updateTodoLocal(editingId, { text, deadline: `${date}T${editTime}`, subject: editSubject });
    setEditingId(null);
  };

  const cancelEdit = () => {
    if (editingId === DRAFT_ID) setDraftHour(null);
    setEditingId(null);
  };

  // ── Event editing ─────────────────────────────────────────────────────────

  const startEventEdit = (ev: CalendarEvent) => {
    setEditingEventId(ev.id);
    setEventTitle(ev.title);
    setEventStartTime(ev.startTime);
    setEventEndTime(ev.endTime);
    setEventColor(ev.color);
    setTimeout(() => { eventTitleRef.current?.focus(); eventTitleRef.current?.select(); }, 30);
  };

  const commitEventEdit = () => {
    const title = eventTitle.trim();
    if (!title) { cancelEventEdit(); return; }
    if (editingEventId === EVENT_DRAFT_ID) {
      addEventLocal({
        title,
        date: date ?? "",
        startTime: eventStartTime,
        endTime: eventEndTime,
        color: eventColor,
      });
    } else if (editingEventId) {
      updateEventLocal(editingEventId, {
        title,
        startTime: eventStartTime,
        endTime: eventEndTime,
        color: eventColor,
      });
    }
    cancelEventEdit();
  };

  const cancelEventEdit = () => {
    setEditingEventId(null);
    setEventDraftHour(null);
    setEventTitle("");
    setEventStartTime("09:00");
    setEventEndTime("10:00");
    setEventColor("indigo");
  };

  // ── Type picker (choose Task or Event when clicking "+") ──────────────────

  const openTypePicker = (h: number | "all-day") => {
    if (editingId) commitEdit();
    if (editingEventId) cancelEventEdit();
    setTypePickerHour(prev => (prev === h ? null : h));
  };

  const pickTask = (h: number | "all-day") => {
    setTypePickerHour(null);
    setDraftHour(h);
    setEditingId(DRAFT_ID);
    setEditText("");
    setEditTime(h === "all-day" ? "09:00" : `${pad(h as number)}:00`);
    setEditSubject("miscellaneous");
    setTimeout(() => { editInputRef.current?.focus(); }, 30);
  };

  const pickEvent = (h: number | "all-day") => {
    setTypePickerHour(null);
    const defaultHour = h === "all-day" ? 9 : (h as number);
    const endHour = Math.min(defaultHour + 1, 23);
    setEventDraftHour(defaultHour);
    setEventTitle("");
    setEventStartTime(`${pad(defaultHour)}:00`);
    setEventEndTime(`${pad(endHour)}:00`);
    setEventColor("indigo");
    setEditingEventId(EVENT_DRAFT_ID);
    setTimeout(() => { eventTitleRef.current?.focus(); }, 30);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderTaskEditRow = (key: string, testId: string) => (
    <div
      key={key}
      className="rounded-lg border border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.05)] p-2 space-y-2"
      data-testid={testId}
    >
      <input
        ref={editInputRef}
        value={editText}
        onChange={e => setEditText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.stopPropagation(); commitEdit(); }
          if (e.key === "Escape") { e.stopPropagation(); cancelEdit(); }
        }}
        placeholder="Task description…"
        className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.4)]"
        data-testid={`${testId}-text`}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="time"
          value={editTime}
          onChange={e => setEditTime(e.target.value)}
          className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none"
          data-testid={`${testId}-time`}
        />
        <select
          value={editSubject}
          onChange={e => setEditSubject(e.target.value as TaskSubject)}
          className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none"
          data-testid={`${testId}-subject`}
        >
          {TASK_SUBJECTS.map(s => (
            <option key={s} value={s}>{TASK_SUBJECT_LABEL[s]}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={cancelEdit}
            className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-secondary"
            data-testid={`${testId}-cancel`}
          >
            Cancel
          </button>
          <button
            onClick={commitEdit}
            disabled={editingId === DRAFT_ID && !editText.trim()}
            className="text-xs px-2 py-1 rounded-md font-semibold bg-[hsl(var(--primary))] text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`${testId}-save`}
          >
            {editingId === DRAFT_ID ? "Done" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderEventEditRow = (key: string) => (
    <div
      key={key}
      className="rounded-lg border border-[hsl(240_60%_58%/0.5)] bg-[hsl(240_60%_58%/0.05)] p-2 space-y-2"
      data-testid="timeline-event-edit-form"
    >
      <input
        ref={eventTitleRef}
        value={eventTitle}
        onChange={e => setEventTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.stopPropagation(); commitEventEdit(); }
          if (e.key === "Escape") { e.stopPropagation(); cancelEventEdit(); }
        }}
        placeholder="Event title…"
        className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-[hsl(240_60%_58%/0.4)]"
        data-testid="timeline-event-title"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="time"
          value={eventStartTime}
          onChange={e => setEventStartTime(e.target.value)}
          className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none"
          data-testid="timeline-event-start"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="time"
          value={eventEndTime}
          onChange={e => setEventEndTime(e.target.value)}
          className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none"
          data-testid="timeline-event-end"
        />
        <div className="flex items-center gap-1 ml-1">
          {EVENT_COLOR_OPTIONS.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setEventColor(c.id as EventColorId)}
              title={c.label}
              className={`w-4 h-4 rounded-full border-2 transition-transform ${
                eventColor === c.id ? "scale-125 border-foreground" : "border-transparent"
              }`}
              style={{ background: c.bg }}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={cancelEventEdit}
            className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={commitEventEdit}
            disabled={!eventTitle.trim()}
            className="text-xs px-2 py-1 rounded-md font-semibold bg-[hsl(240_60%_58%)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="timeline-event-save"
          >
            {editingEventId === EVENT_DRAFT_ID ? "Add event" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderEventRow = (ev: CalendarEvent) => {
    const colorOpt = EVENT_COLOR_OPTIONS.find(c => c.id === ev.color) ?? EVENT_COLOR_OPTIONS[0]!;
    if (editingEventId === ev.id) return renderEventEditRow(ev.id);
    return (
      <div
        key={ev.id}
        className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 border"
        style={{
          background: colorOpt.bg + "22",
          borderColor: colorOpt.bg + "66",
        }}
        data-testid={`timeline-event-${ev.id}`}
      >
        <CalendarDays className="w-3 h-3 shrink-0" style={{ color: colorOpt.bg }} />
        <button
          type="button"
          onClick={() => startEventEdit(ev)}
          className="flex-1 text-left min-w-0"
        >
          <p className="text-sm font-semibold truncate" style={{ color: colorOpt.bg }}>
            {ev.title}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {ev.startTime}–{ev.endTime}
          </p>
        </button>
        <button
          type="button"
          onClick={() => deleteEventLocal(ev.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded"
          aria-label="Delete event"
          data-testid={`timeline-event-delete-${ev.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  const renderTodoRow = (todo: TodoItem) => {
    const isEditing = editingId === todo.id;
    const color = SUBJECT_COLOR[todo.subject ?? "miscellaneous"];
    const time = todo.deadline?.includes("T") ? (todo.deadline.split("T")[1] ?? "").slice(0, 5) : "";

    if (isEditing) return renderTaskEditRow(todo.id, `timeline-edit-${todo.id}`);

    return (
      <div
        key={todo.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(RT_TODO_DRAG_TYPE, todo.id);
          e.dataTransfer.setData("text/plain", todo.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card hover:bg-secondary/40 px-2.5 py-1.5 transition-colors cursor-grab active:cursor-grabbing"
        data-testid={`timeline-task-${todo.id}`}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/50 mt-1 shrink-0" />
        <button
          type="button"
          onClick={() => {
            if (todo.completed) {
              updateTodoLocal(todo.id, { completed: false, completedAt: undefined });
            } else {
              completeTodoLocal(todo.id);
            }
          }}
          className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            todo.completed ? "border-emerald-500 bg-emerald-500" : "border-border hover:border-foreground"
          }`}
          aria-label={todo.completed ? "Mark incomplete" : "Mark complete"}
          data-testid={`timeline-toggle-${todo.id}`}
        >
          {todo.completed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
        <button
          type="button"
          onClick={() => startEdit(todo)}
          className="flex-1 text-left min-w-0"
          data-testid={`timeline-open-${todo.id}`}
        >
          <p className={`text-sm truncate ${todo.completed ? "line-through text-muted-foreground" : "text-foreground font-medium"}`}>
            {todo.text || <span className="italic text-muted-foreground">Untitled task</span>}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
            {time && <span className="tabular-nums">{time}</span>}
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            <span>{TASK_SUBJECT_LABEL[todo.subject ?? "miscellaneous"]}</span>
            {todo.completed && todo.completedAt && (
              <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                · done {format(new Date(todo.completedAt), "h:mm a")}
              </span>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => deleteTodoLocal(todo.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded"
          aria-label="Delete task"
          data-testid={`timeline-delete-${todo.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  const renderTypePicker = (h: number | "all-day") => (
    <div
      key="type-picker"
      className="flex items-center gap-1.5 py-1"
      data-testid={`timeline-type-picker-${h}`}
    >
      <button
        type="button"
        onClick={() => pickTask(h)}
        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.2)] transition-colors"
        data-testid={`timeline-pick-task-${h}`}
      >
        <Check className="w-3 h-3" /> Task
      </button>
      <button
        type="button"
        onClick={() => pickEvent(h)}
        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-[hsl(240_60%_58%/0.12)] text-[hsl(240_60%_58%)] hover:bg-[hsl(240_60%_58%/0.22)] transition-colors"
        data-testid={`timeline-pick-event-${h}`}
      >
        <CalendarDays className="w-3 h-3" /> Event
      </button>
      <button
        type="button"
        onClick={() => setTypePickerHour(null)}
        className="text-xs text-muted-foreground hover:text-foreground px-1 py-1"
        aria-label="Cancel"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const handleHourDragOver = (e: React.DragEvent, h: number | "all-day") => {
    if (!e.dataTransfer.types.includes(RT_TODO_DRAG_TYPE) && !e.dataTransfer.types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverHour !== h) setDragOverHour(h);
  };

  const handleHourDragLeave = (h: number | "all-day") => {
    setDragOverHour(prev => (prev === h ? null : prev));
  };

  const handleHourDrop = (e: React.DragEvent, h: number | "all-day") => {
    const id = e.dataTransfer.getData(RT_TODO_DRAG_TYPE) || e.dataTransfer.getData("text/plain");
    setDragOverHour(null);
    if (!id) return;
    e.preventDefault();
    const newDeadline = h === "all-day" ? date : `${date}T${pad(h as number)}:00`;
    updateTodoLocal(id, { deadline: newDeadline });
  };

  // ── Counts for footer ─────────────────────────────────────────────────────
  const taskCount = todosForDay.length;
  const eventCount = eventsForDay.length;

  const inner = (
    <div
      ref={popoverRef}
      className={
        isPopover
          ? "bg-card border border-border/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in-0"
          : "bg-card border border-border/60 rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95"
      }
      style={isPopover ? { width: POPOVER_WIDTH, maxWidth: "calc(100vw - 1.5rem)", maxHeight: `${POPOVER_MAX_HEIGHT_VH}vh` } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`flex items-start justify-between gap-3 ${isPopover ? "px-4 pt-3.5 pb-2.5" : "px-6 pt-5 pb-3"} border-b border-border/60 shrink-0`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            Day Timeline
          </div>
          <h2 className={`${isPopover ? "text-base" : "text-xl"} font-bold tracking-tight text-foreground mt-0.5`}>{dateLabel}</h2>
          <p className={`${isPopover ? "text-[11px]" : "text-xs"} text-muted-foreground mt-0.5`}>
            Click any hour · choose a <strong>Task</strong> or <strong>Event</strong>
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          data-testid="timeline-close"
          className="shrink-0 w-7 h-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div ref={scrollRef} className={`flex-1 overflow-y-auto ${isPopover ? "px-3 py-2" : "px-4 py-3"}`}>
        {/* All-day tasks section */}
        <div
          className={`mb-3 pb-3 border-b border-border/60 rounded-md transition-colors ${
            dragOverHour === "all-day" ? "bg-[hsl(var(--primary)/0.10)] outline outline-2 outline-[hsl(var(--primary)/0.45)]" : ""
          }`}
          onDragOver={(e) => handleHourDragOver(e, "all-day")}
          onDragLeave={() => handleHourDragLeave("all-day")}
          onDrop={(e) => handleHourDrop(e, "all-day")}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-2">
            All-day · {groupedByHour.allDay.length}
          </p>
          <div className="space-y-1.5 px-2">
            {groupedByHour.allDay.map(t => renderTodoRow(t))}
            {editingId === DRAFT_ID && draftHour === "all-day" && renderTaskEditRow(DRAFT_ID, "timeline-edit-draft")}
            {editingEventId === EVENT_DRAFT_ID && eventDraftHour === null && renderEventEditRow(EVENT_DRAFT_ID)}
            {groupedByHour.allDay.length === 0 && !(editingId === DRAFT_ID && draftHour === "all-day") && (
              <p className="text-[11px] text-muted-foreground/70 italic px-1 py-1">
                {dragOverHour === "all-day" ? "Drop to make all-day" : "Drag a task here to make it all-day"}
              </p>
            )}
            {typePickerHour === "all-day"
              ? renderTypePicker("all-day")
              : (
                <button
                  type="button"
                  onClick={() => openTypePicker("all-day")}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-1 opacity-60 hover:opacity-100 transition-opacity"
                  data-testid="timeline-add-all-day"
                >
                  <Plus className="w-3 h-3" /> Add all-day task
                </button>
              )}
          </div>
        </div>

        {HOURS.map(h => {
          const tasks = groupedByHour.byHour[h] ?? [];
          const events = eventsByHour[h] ?? [];
          const label = `${pad(h)}:00`;
          const isDropOver = dragOverHour === h;
          const hasContent = tasks.length > 0 || events.length > 0
            || (editingId === DRAFT_ID && draftHour === h)
            || (editingEventId === EVENT_DRAFT_ID && eventDraftHour === h)
            || (editingEventId !== null && editingEventId !== EVENT_DRAFT_ID && eventsByHour[h]?.some(e => e.id === editingEventId));
          return (
            <div
              key={h}
              ref={el => { hourRefs.current[h] = el; }}
              className="flex gap-3 py-1.5 group"
              data-testid={`timeline-hour-${h}`}
              onDragOver={(e) => handleHourDragOver(e, h)}
              onDragLeave={() => handleHourDragLeave(h)}
              onDrop={(e) => handleHourDrop(e, h)}
            >
              <div className="shrink-0 w-12 text-right pt-1">
                <span className={`text-[11px] font-semibold tabular-nums ${isDropOver ? "text-[hsl(var(--primary))]" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </div>
              <div
                className={`flex-1 min-w-0 border-l pl-3 min-h-[36px] rounded-md transition-colors ${
                  isDropOver
                    ? "border-[hsl(var(--primary)/0.6)] bg-[hsl(var(--primary)/0.08)]"
                    : "border-border/60"
                }`}
              >
                {!hasContent ? (
                  typePickerHour === h ? (
                    renderTypePicker(h)
                  ) : (
                    <button
                      type="button"
                      onClick={() => openTypePicker(h)}
                      className={`w-full text-left text-[11px] rounded-lg px-2 py-1.5 flex items-center gap-1.5 transition-opacity ${
                        isDropOver
                          ? "text-[hsl(var(--primary))] opacity-100"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 opacity-0 group-hover:opacity-100"
                      }`}
                      data-testid={`timeline-add-${h}`}
                    >
                      <Plus className="w-3 h-3" />
                      {isDropOver ? `Drop task at ${label}` : `Add at ${label}`}
                    </button>
                  )
                ) : (
                  <div className="space-y-1.5">
                    {events.map(renderEventRow)}
                    {tasks.map(renderTodoRow)}
                    {editingId === DRAFT_ID && draftHour === h && renderTaskEditRow(DRAFT_ID, "timeline-edit-draft")}
                    {editingEventId === EVENT_DRAFT_ID && eventDraftHour === h && renderEventEditRow(EVENT_DRAFT_ID)}
                    {typePickerHour === h
                      ? renderTypePicker(h)
                      : (
                        <button
                          type="button"
                          onClick={() => openTypePicker(h)}
                          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          data-testid={`timeline-add-more-${h}`}
                        >
                          <Plus className="w-3 h-3" /> Add another
                        </button>
                      )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`flex items-center justify-between gap-2 ${isPopover ? "px-4 py-2.5" : "px-5 py-3"} border-t border-border/60 shrink-0`}>
        <p className="text-[11px] text-muted-foreground">
          {taskCount} task{taskCount === 1 ? "" : "s"}
          {eventCount > 0 && ` · ${eventCount} event${eventCount === 1 ? "" : "s"}`}
        </p>
        <button
          onClick={onClose}
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary hover:bg-secondary/80"
          data-testid="timeline-done"
        >
          Done
        </button>
      </div>
    </div>
  );

  const wrapper = isPopover ? (
    <div
      className="fixed z-[60] animate-in fade-in-0"
      role="dialog"
      aria-label={`Timeline for ${dateLabel}`}
      data-testid="day-timeline-popover"
      style={{ top: popoverPos.top, left: popoverPos.left }}
    >
      {inner}
    </div>
  ) : (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Timeline for ${dateLabel}`}
      data-testid="day-timeline-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !editingId && !editingEventId) onClose();
      }}
    >
      {inner}
    </div>
  );

  return createPortal(wrapper, document.body);
}
