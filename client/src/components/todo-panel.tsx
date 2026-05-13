import { useState, useEffect, useRef, useMemo } from "react";
import { format, isPast, parseISO, isToday } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, Trash2, AlertTriangle, Calendar, Check, X, Pin,
  ChevronDown, ChevronRight,
} from "lucide-react";
import {
  notifyTodosChanged,
  type TodoItem,
  type TaskSubject,
  TASK_SUBJECTS,
  TASK_SUBJECT_LABEL,
  MAX_PINNED_TASKS,
} from "@/hooks/use-todos";
import { parseFlexibleDate, formatDateForInput } from "@/lib/date-parser";
import { handleDateArrowKey } from "@/lib/date-arrow";
import { useToast } from "@/hooks/use-toast";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";

const STORAGE_KEY = "revision_tracker_todos";

function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { }
  return [];
}

function saveTodos(todos: TodoItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  notifyTodosChanged();
}

function isOverdue(todo: TodoItem): boolean {
  if (!todo.deadline || todo.completed) return false;
  if (todo.deadline.includes("T")) {
    return isPast(new Date(todo.deadline));
  }
  const d = parseISO(todo.deadline);
  return isPast(d) && !isToday(d);
}

function isDueToday(todo: TodoItem): boolean {
  if (!todo.deadline || todo.completed || isOverdue(todo)) return false;
  const d = todo.deadline.includes("T") ? new Date(todo.deadline) : parseISO(todo.deadline);
  return isToday(d);
}

function formatDeadline(deadline: string): string {
  if (deadline.includes("T")) {
    return format(new Date(deadline), "d MMM yyyy, h:mm a");
  }
  return format(parseISO(deadline), "d MMM yyyy");
}

function buildDeadline(date: string, time: string): string | undefined {
  if (!date) return undefined;
  if (time) return `${date}T${time}`;
  return date;
}

function splitDeadline(deadline?: string): { date: string; time: string } {
  if (!deadline) return { date: "", time: "" };
  if (deadline.includes("T")) {
    const [d, t] = deadline.split("T");
    return { date: d, time: t.slice(0, 5) };
  }
  return { date: deadline, time: "" };
}

function effectiveSubject(t: TodoItem): TaskSubject {
  return t.subject ?? "miscellaneous";
}

interface TaskTone {
  dotStyle: React.CSSProperties;
  chipStyle: React.CSSProperties;
  chipActiveStyle: React.CSSProperties;
}

const SUBJECT_TONE: Record<TaskSubject, TaskTone> = {
  biology: {
    dotStyle:        { background: "hsl(var(--biology))" },
    chipStyle:       { color: "hsl(var(--biology))", background: "hsl(var(--biology) / 0.12)" },
    chipActiveStyle: { color: "white", background: "hsl(var(--biology))" },
  },
  chemistry: {
    dotStyle:        { background: "hsl(var(--chemistry))" },
    chipStyle:       { color: "hsl(var(--chemistry))", background: "hsl(var(--chemistry) / 0.12)" },
    chipActiveStyle: { color: "white", background: "hsl(var(--chemistry))" },
  },
  maths: {
    dotStyle:        { background: "hsl(var(--maths))" },
    chipStyle:       { color: "hsl(var(--maths))", background: "hsl(var(--maths) / 0.12)" },
    chipActiveStyle: { color: "white", background: "hsl(var(--maths))" },
  },
  miscellaneous: {
    dotStyle:        { background: "hsl(var(--muted-foreground))" },
    chipStyle:       { color: "hsl(var(--muted-foreground))", background: "hsl(var(--secondary))" },
    chipActiveStyle: { color: "hsl(var(--background))", background: "hsl(var(--foreground))" },
  },
};

interface TodoPanelProps {
  className?: string;
}

type FilterValue = "all" | TaskSubject;

export function TodoPanel({ className }: TodoPanelProps) {
  const { toast } = useToast();
  const [todos, setTodos] = useState<TodoItem[]>(() => loadTodos());

  const [inputValue, setInputValue] = useState("");
  const [newDateText, setNewDateText] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newSubject, setNewSubject] = useState<TaskSubject>("miscellaneous");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDateText, setEditDateText] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editSubject, setEditSubject] = useState<TaskSubject>("miscellaneous");

  const [filter, setFilter] = useState<FilterValue>("all");
  const [completedOpen, setCompletedOpenState] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("revision_tracker_completed_open");
      if (raw === "0") return false;
      if (raw === "1") return true;
    } catch {}
    return true;
  });
  const setCompletedOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    setCompletedOpenState(prev => {
      const value = typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
      try { localStorage.setItem("revision_tracker_completed_open", value ? "1" : "0"); } catch {}
      return value;
    });
  };

  const newDateIso = parseFlexibleDate(newDateText) ?? "";
  const editDateIso = parseFlexibleDate(editDateText) ?? "";
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Undo history — keeps the last 3 PRE-change snapshots so Cmd/Ctrl+Z can
  // walk backwards. We push the OLD list before applying every mutation, and
  // skip pushing if the previous snapshot is identical (so background syncs
  // from the server don't pollute the stack).
  const UNDO_LIMIT = 3;
  const undoStackRef = useRef<TodoItem[][]>([]);
  // Suppress the next refresh-from-storage in undo's own setTodos call so
  // the storage-sync useEffect doesn't immediately overwrite us.
  const updateTodos = (updater: (prev: TodoItem[]) => TodoItem[]) => {
    setTodos(prev => {
      const next = updater(prev);
      // Only record an undo entry if the data actually changed.
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        undoStackRef.current = [...undoStackRef.current, prev].slice(-UNDO_LIMIT);
      }
      saveTodos(next);
      return next;
    });
  };

  const undoLastAction = () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) {
      toast({ title: "Nothing to undo" });
      return;
    }
    const previous = stack[stack.length - 1]!;
    undoStackRef.current = stack.slice(0, -1);
    setTodos(previous);
    saveTodos(previous);
    setEditingId(null);
    toast({ title: "Undid last action" });
  };

  // Cmd/Ctrl + Z anywhere on the page (except when typing inside another
  // editable field that has its own undo, e.g. plain text inputs / textareas
  // in the day-entry modal). We still allow the shortcut from inside the
  // todo-panel's own inputs since the user expects it to undo a task action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isUndo =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === "z" || e.key === "Z");
      if (!isUndo) return;
      const target = e.target as HTMLElement | null;
      // Allow shortcut from within the todo panel itself, otherwise leave
      // native text-editing undo alone.
      if (target && !target.closest('[data-testid="todo-panel"]')) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      undoLastAction();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const refresh = () => {
      const fresh = loadTodos();
      setTodos(prev => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
    };
    window.addEventListener("revision-tracker-todos-changed", refresh);
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("revision-tracker-todos-changed", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const addTodo = () => {
    const text = inputValue.trim();
    if (!text) return;
    if (newDateText.trim() && !newDateIso) return;
    const deadline = buildDeadline(newDateIso, newTime);
    const newTodo: TodoItem = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      createdAt: new Date().toISOString(),
      deadline,
      subject: newSubject,
      pinned: false,
    };
    updateTodos(prev => [newTodo, ...prev]);
    setInputValue("");
    setNewDateText("");
    setNewTime("");
    // Keep newSubject as-is so the next task defaults to the same tag.
    // On full page refresh, useState resets it to "miscellaneous".
    inputRef.current?.focus();
  };

  const completeTodo = (id: string) => {
    updateTodos(prev => prev.map(t =>
      t.id === id
        ? { ...t, completed: true, completedAt: new Date().toISOString(), pinned: false }
        : t
    ));
    if (editingId === id) setEditingId(null);
  };

  const uncompleteTodo = (id: string) => {
    updateTodos(prev => prev.map(t =>
      t.id === id ? { ...t, completed: false, completedAt: undefined } : t
    ));
  };

  const deleteTodo = (id: string) => {
    updateTodos(prev => prev.filter(t => t.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const togglePin = (id: string) => {
    let limitHit = false;
    updateTodos(prev => {
      const target = prev.find(t => t.id === id);
      if (!target) return prev;
      if (!target.pinned) {
        const pinnedCount = prev.filter(t => t.pinned && !t.completed).length;
        if (pinnedCount >= MAX_PINNED_TASKS) {
          limitHit = true;
          return prev;
        }
      }
      return prev.map(t => t.id === id ? { ...t, pinned: !t.pinned } : t);
    });
    if (limitHit) {
      toast({
        title: "Pin limit reached",
        description: `You can pin up to ${MAX_PINNED_TASKS} tasks at a time. Unpin one first.`,
      });
    }
  };

  const openEditor = (todo: TodoItem) => {
    if (editingId === todo.id) {
      setEditingId(null);
      return;
    }
    const { date, time } = splitDeadline(todo.deadline);
    setEditText(todo.text);
    setEditDateText(date ? formatDateForInput(date) : "");
    setEditTime(time);
    setEditSubject(effectiveSubject(todo));
    setEditingId(todo.id);
  };

  const saveEdit = (id: string) => {
    if (editDateText.trim() && !editDateIso) return;
    const text = editText.trim();
    if (!text) return;
    const deadline = buildDeadline(editDateIso, editTime);
    updateTodos(prev => prev.map(t =>
      t.id === id ? { ...t, text, deadline, subject: editSubject } : t
    ));
    setEditingId(null);
  };

  const clearDeadline = (id: string) => {
    updateTodos(prev => prev.map(t => t.id === id ? { ...t, deadline: undefined } : t));
    setEditingId(null);
  };

  // ---- Derived data ----
  const pendingAll = todos.filter(t => !t.completed);
  const subjectCounts = useMemo(() => {
    const counts: Record<TaskSubject, number> = {
      biology: 0, chemistry: 0, maths: 0, miscellaneous: 0,
    };
    for (const t of pendingAll) counts[effectiveSubject(t)]++;
    return counts;
  }, [pendingAll]);

  const matchesFilter = (t: TodoItem) =>
    filter === "all" ? true : effectiveSubject(t) === filter;

  const pinnedPending = pendingAll
    .filter(t => t.pinned && matchesFilter(t))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const unpinnedPending = pendingAll.filter(t => !t.pinned && matchesFilter(t));

  const completed = todos
    .filter(t => t.completed && matchesFilter(t))
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());

  const overdueCount = pendingAll.filter(isOverdue).length;
  const pinnedCountTotal = pendingAll.filter(t => t.pinned).length;

  return (
    <aside
      className={`w-[340px] shrink-0 flex flex-col bg-card rounded-3xl shadow-sm border border-border/60 overflow-hidden ${className ?? ""}`}
      data-testid="todo-panel"
    >
        <div className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[20px] font-bold tracking-tight" style={{ letterSpacing: "-0.01em" }}>To-Do</h2>
            <span className="text-[11px] font-medium text-muted-foreground">
              {pendingAll.length} open · {pinnedCountTotal}/{MAX_PINNED_TASKS} pinned
            </span>
          </div>
        </div>

        {/* Add input — meta row (date / time / tags) only appears once user types */}
        <div className="px-5 pb-3 shrink-0">
          <div className="flex flex-col gap-2 px-3 py-2 rounded-2xl bg-secondary/60 focus-within:ring-2 focus-within:ring-primary/40 focus-within:bg-secondary/80 transition-all">
            <div className="flex items-center gap-2">
              <button
                onClick={addTodo}
                disabled={!inputValue.trim() || (!!newDateText.trim() && !newDateIso)}
                data-testid="button-add-todo"
                className="w-6 h-6 rounded-full grid place-items-center bg-primary text-primary-foreground disabled:opacity-40 transition-all duration-150 hover:opacity-90 hover:scale-110 active:scale-95 shrink-0"
                title="Add task"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={3} />
              </button>
              <AutoResizeTextarea
                ref={inputRef}
                minRows={1}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addTodo();
                  }
                }}
                placeholder="Add a task…"
                data-testid="input-todo"
                className="flex-1 block bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground min-w-0 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-0 py-0 leading-6 whitespace-pre-wrap break-words !min-h-0"
              />
            </div>
            <AnimatePresence initial={false}>
              {(inputValue.length > 0 || newDateText.length > 0 || newTime.length > 0) && (
                <motion.div
                  key="todo-meta"
                  initial={{ height: 0, opacity: 0, marginTop: -8 }}
                  animate={{ height: "auto", opacity: 1, marginTop: 0 }}
                  exit={{ height: 0, opacity: 0, marginTop: -8 }}
                  transition={{ duration: 0.18, ease: [0.18, 0.7, 0.4, 1] }}
                  className="overflow-hidden pl-8 -mx-1 px-1 motion-reduce:!transition-none motion-reduce:!duration-0"
                >
                  <div className="flex flex-col gap-1.5 py-0.5">
                    {/* Row 1: date + time(s) */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="dd/mm"
                        value={newDateText}
                        onChange={e => setNewDateText(e.target.value)}
                        onFocus={() => {
                          if (!newDateText) {
                            setNewDateText(formatDateForInput(format(new Date(), "yyyy-MM-dd")));
                          }
                        }}
                        onBlur={() => { if (newDateIso) setNewDateText(formatDateForInput(newDateIso)); }}
                        onKeyDown={e => {
                          if (handleDateArrowKey(e, newDateText, setNewDateText)) return;
                          if (e.key === "Enter") addTodo();
                        }}
                        data-testid="input-todo-date"
                        className={`w-[68px] text-[11px] bg-card/60 border rounded-full px-2.5 py-1 outline-none focus:ring-2 focus:ring-primary/30 text-foreground transition-all hover:bg-card focus:bg-card ${newDateText && !newDateIso ? "border-destructive/60" : "border-transparent"}`}
                      />
                      <input
                        type="time"
                        value={newTime}
                        onChange={e => setNewTime(e.target.value)}
                        onFocus={() => {
                          if (!newDateText) {
                            setNewDateText(formatDateForInput(format(new Date(), "yyyy-MM-dd")));
                          }
                          if (!newTime) {
                            setNewTime(format(new Date(), "HH:mm"));
                          }
                        }}
                        disabled={!newDateIso && !!newDateText}
                        data-testid="input-todo-time"
                        className="text-[11px] bg-card/60 border border-transparent rounded-full px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 text-foreground disabled:opacity-40 transition-all hover:bg-card focus:bg-card"
                      />
                      {(newDateText || newTime) && (
                        <button
                          onClick={() => { setNewDateText(""); setNewTime(""); }}
                          className="text-muted-foreground hover:text-foreground text-[11px] underline transition-colors"
                        >
                          clear
                        </button>
                      )}
                    </div>
                    {/* Divider between date/time row and tags row */}
                    <span className="block h-px w-full bg-border/60" aria-hidden />
                    {/* Row 2: TAGS: + chips */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold tracking-[0.10em] uppercase text-muted-foreground select-none">
                        Tags:
                      </span>
                      {TASK_SUBJECTS.map(s => {
                        const tone = SUBJECT_TONE[s];
                        const active = newSubject === s;
                        return (
                          <button
                            key={s}
                            onClick={() => setNewSubject(s)}
                            data-testid={`new-subject-${s}`}
                            className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full transition-all duration-150 hover:scale-105 active:scale-95"
                            style={active ? tone.chipActiveStyle : tone.chipStyle}
                            title={`Tag as ${TASK_SUBJECT_LABEL[s]}`}
                          >
                            {TASK_SUBJECT_LABEL[s]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Overdue banner */}
        {overdueCount > 0 && (
          <div
            className="mx-5 mb-3 px-3.5 py-2 rounded-xl flex items-center gap-2.5 shrink-0"
            style={{
              background: "hsl(var(--destructive) / 0.12)",
              color: "hsl(var(--destructive))",
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[12px] font-semibold">
              {overdueCount === 1 ? "1 task is overdue" : `${overdueCount} tasks are overdue`}
            </span>
          </div>
        )}

        {/* Subject filter chips — width matches the add-task bar (px-5 wrapper),
            with a thin inset horizontal scrollbar so chips keep their natural
            length and the user scrolls sideways instead of squashing them. */}
        <div className="px-5 pb-2 shrink-0">
          <div
            className="flex items-center gap-1 flex-nowrap overflow-x-auto overflow-y-hidden pb-1
              [scrollbar-gutter:stable]
              [&::-webkit-scrollbar]:h-1.5
              [&::-webkit-scrollbar-track]:bg-transparent
              [&::-webkit-scrollbar-thumb]:bg-border
              [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb]:bg-clip-padding
              [&::-webkit-scrollbar-thumb]:border-[2px]
              [&::-webkit-scrollbar-thumb]:border-solid
              [&::-webkit-scrollbar-thumb]:border-transparent
              hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40
              [scrollbar-width:thin]
              [scrollbar-color:hsl(var(--border))_transparent]"
          >
            <FilterChip
              label="All"
              count={pendingAll.length}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            {TASK_SUBJECTS.map(s => (
              <FilterChip
                key={s}
                label={TASK_SUBJECT_LABEL[s]}
                count={subjectCounts[s]}
                active={filter === s}
                tone={SUBJECT_TONE[s]}
                onClick={() => setFilter(s)}
                testId={`filter-${s}`}
              />
            ))}
          </div>
        </div>

        {/* Task list */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 py-3 space-y-1
            [scrollbar-gutter:stable]
            [&::-webkit-scrollbar]:w-2.5
            [&::-webkit-scrollbar-track]:bg-transparent
            [&::-webkit-scrollbar-thumb]:bg-border
            [&::-webkit-scrollbar-thumb]:rounded-full
            [&::-webkit-scrollbar-thumb]:bg-clip-padding
            [&::-webkit-scrollbar-thumb]:border-[3px]
            [&::-webkit-scrollbar-thumb]:border-solid
            [&::-webkit-scrollbar-thumb]:border-transparent
            hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40
            [scrollbar-width:thin]
            [scrollbar-color:hsl(var(--border))_transparent]"
        >
          {todos.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <span className="text-3xl opacity-30">&#10003;</span>
              <p>No tasks yet. Add one above.</p>
            </div>
          )}

          {todos.length > 0 && pinnedPending.length === 0 && unpinnedPending.length === 0 && completed.length === 0 && (
            <div className="text-center text-[12.5px] text-muted-foreground py-10">
              No tasks match this filter.
            </div>
          )}

          {/* Pinned section */}
          {pinnedPending.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-1 pt-1 pb-1.5">
                <Pin className="w-3 h-3" style={{ color: "hsl(var(--apple-orange))" }} />
                <span className="text-[10.5px] font-bold tracking-[0.10em] uppercase text-muted-foreground">
                  Pinned
                </span>
              </div>
              {pinnedPending.map(todo => (
                <TaskRow
                  key={todo.id}
                  todo={todo}
                  pinned
                  isEditing={editingId === todo.id}
                  editText={editText}
                  editDateText={editDateText}
                  editDateIso={editDateIso}
                  editTime={editTime}
                  editSubject={editSubject}
                  setEditText={setEditText}
                  setEditDateText={setEditDateText}
                  setEditTime={setEditTime}
                  setEditSubject={setEditSubject}
                  saveEdit={saveEdit}
                  clearDeadline={clearDeadline}
                  setEditingId={setEditingId}
                  completeTodo={completeTodo}
                  deleteTodo={deleteTodo}
                  togglePin={togglePin}
                  openEditor={openEditor}
                />
              ))}
              <div className="h-2" />
            </>
          )}

          {/* Pending section */}
          {unpinnedPending.map(todo => (
            <TaskRow
              key={todo.id}
              todo={todo}
              isEditing={editingId === todo.id}
              editText={editText}
              editDateText={editDateText}
              editDateIso={editDateIso}
              editTime={editTime}
              editSubject={editSubject}
              setEditText={setEditText}
              setEditDateText={setEditDateText}
              setEditTime={setEditTime}
              setEditSubject={setEditSubject}
              saveEdit={saveEdit}
              clearDeadline={clearDeadline}
              setEditingId={setEditingId}
              completeTodo={completeTodo}
              deleteTodo={deleteTodo}
              togglePin={togglePin}
              openEditor={openEditor}
            />
          ))}

          {/* Completed (collapsible) */}
          {completed.length > 0 && (
            <div className="pt-3">
              <button
                onClick={() => setCompletedOpen(o => !o)}
                data-testid="button-toggle-completed"
                className="w-full flex items-center gap-1.5 px-1 py-1.5 rounded-md hover:bg-secondary/40 transition-colors"
              >
                {completedOpen
                  ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                <span className="text-[10.5px] font-bold tracking-[0.10em] uppercase text-muted-foreground">
                  Completed ({completed.length})
                </span>
              </button>

              {completedOpen && (
                <div className="mt-1 space-y-1">
                  {completed.map(todo => {
                    const tone = SUBJECT_TONE[effectiveSubject(todo)];
                    return (
                      <div
                        key={todo.id}
                        className="flex items-start gap-3 py-2 px-2 rounded-xl group hover:bg-secondary/30 transition-colors"
                        data-testid={`todo-item-${todo.id}`}
                      >
                        <button
                          onClick={() => uncompleteTodo(todo.id)}
                          data-testid={`todo-uncheck-${todo.id}`}
                          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full grid place-items-center transition-colors"
                          style={{ background: "hsl(var(--biology))" }}
                          title="Mark as not done"
                        >
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                            <polyline points="1.5,6 4.5,9 10.5,3" />
                          </svg>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={tone.dotStyle} />
                            <span className="text-[12.5px] leading-tight text-muted-foreground line-through break-words">
                              {todo.text}
                            </span>
                          </div>
                          {todo.completedAt && (
                            <span className="text-[10.5px] text-muted-foreground/60 mt-0.5 block ml-3">
                              Done {format(new Date(todo.completedAt), "d MMM yyyy, h:mm a")}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => deleteTodo(todo.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0 mt-0.5"
                          data-testid={`todo-delete-${todo.id}`}
                          title="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
    </aside>
  );
}

function FilterChip({
  label, count, active, tone, onClick, testId,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: TaskTone;
  onClick: () => void;
  testId?: string;
}) {
  const baseStyle: React.CSSProperties = active
    ? (tone?.chipActiveStyle ?? { background: "hsl(var(--foreground))", color: "hsl(var(--background))" })
    : { background: "hsl(var(--secondary))", color: "hsl(var(--muted-foreground))" };
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 transition-all duration-150 hover:scale-105 active:scale-95 flex items-center gap-1.5"
      style={baseStyle}
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{count}</span>
    </button>
  );
}

interface TaskRowProps {
  todo: TodoItem;
  pinned?: boolean;
  isEditing: boolean;
  editText: string;
  editDateText: string;
  editDateIso: string;
  editTime: string;
  editSubject: TaskSubject;
  setEditText: (v: string) => void;
  setEditDateText: (v: string) => void;
  setEditTime: (v: string) => void;
  setEditSubject: (v: TaskSubject) => void;
  saveEdit: (id: string) => void;
  clearDeadline: (id: string) => void;
  setEditingId: (id: string | null) => void;
  completeTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  togglePin: (id: string) => void;
  openEditor: (t: TodoItem) => void;
}

function TaskRow(p: TaskRowProps) {
  const { todo, pinned, isEditing } = p;
  const overdue = isOverdue(todo);
  const dueToday = isDueToday(todo);
  const subject = effectiveSubject(todo);
  const tone = SUBJECT_TONE[subject];

  const containerStyle: React.CSSProperties = pinned
    ? {
        background: "hsl(var(--apple-orange) / 0.07)",
        border: "1px solid hsl(var(--apple-orange) / 0.20)",
      }
    : overdue
    ? {
        background: "hsl(var(--destructive) / 0.06)",
        border: "1px solid hsl(var(--destructive) / 0.20)",
      }
    : isEditing
    ? {
        background: "hsl(var(--secondary) / 0.6)",
        border: "1px solid hsl(var(--border))",
      }
    : {
        background: "transparent",
        border: "1px solid transparent",
      };

  return (
    <div
      className="rounded-2xl group transition-all duration-150 hover:bg-secondary/40 hover:translate-x-0.5 hover:shadow-sm"
      style={containerStyle}
      data-testid={`todo-item-${todo.id}`}
    >
      <div className="flex items-start gap-2.5 py-2.5 px-3">
        <button
          onClick={() => p.completeTodo(todo.id)}
          data-testid={`todo-check-${todo.id}`}
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full grid place-items-center transition-all group/check"
          style={{
            background: "hsl(var(--card))",
            border: "1.5px solid hsl(var(--border))",
          }}
          title="Mark as done"
        >
          <span
            className="w-2 h-2 rounded-full opacity-0 group-hover/check:opacity-100 transition-opacity"
            style={{ background: "hsl(var(--primary))" }}
          />
        </button>

        {/* Body */}
        <div
          className={`flex-1 min-w-0 ${isEditing ? "" : "cursor-pointer"}`}
          onClick={isEditing ? undefined : () => p.openEditor(todo)}
          title={isEditing ? undefined : "Click to edit"}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            {isEditing ? (
              <AutoResizeTextarea
                minRows={1}
                value={p.editText}
                onChange={e => p.setEditText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    p.saveEdit(todo.id);
                  } else if (e.key === "Escape") {
                    p.setEditingId(null);
                  }
                }}
                autoFocus
                onFocus={e => e.currentTarget.select()}
                placeholder="Task description"
                data-testid={`edit-text-${todo.id}`}
                className={`w-full block text-[13px] leading-5 bg-transparent border-0 border-b rounded-none outline-none text-foreground py-0.5 px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors whitespace-pre-wrap break-words !min-h-0 ${
                  !p.editText.trim() ? "border-b-destructive/60" : "border-b-primary/40 focus:border-b-primary"
                }`}
              />
            ) : (
              <span className="text-[13px] leading-snug text-foreground break-words">
                {todo.text}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            {todo.deadline && !isEditing && (
              <span
                className="text-[10.5px] font-medium"
                style={{
                  color: overdue
                    ? "hsl(var(--destructive))"
                    : dueToday
                    ? "hsl(var(--apple-orange))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {overdue ? "⚠ Overdue · " : dueToday ? "Due today · " : "Due "}
                {formatDeadline(todo.deadline)}
              </span>
            )}
            {!todo.deadline && !isEditing && (
              <span className="text-[10.5px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                <Calendar className="w-3 h-3" />Set deadline
              </span>
            )}
          </div>
        </div>

        {/* Pin */}
        <button
          onClick={() => p.togglePin(todo.id)}
          data-testid={`todo-pin-${todo.id}`}
          title={todo.pinned ? "Unpin task" : "Pin task"}
          className={`shrink-0 mt-0.5 transition-all ${
            todo.pinned
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
          }`}
          style={todo.pinned ? { color: "hsl(var(--apple-orange))" } : undefined}
        >
          <Pin
            className="w-3.5 h-3.5"
            fill={todo.pinned ? "currentColor" : "none"}
          />
        </button>

        {/* Delete */}
        <button
          onClick={() => p.deleteTodo(todo.id)}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0 mt-0.5"
          data-testid={`todo-delete-${todo.id}`}
          title="Delete task"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Inline editor */}
      {isEditing && (
        <div className="px-3 pb-3 space-y-2.5">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.10em] mb-1.5">Subject</p>
            <div className="flex items-center gap-1 flex-wrap">
              {TASK_SUBJECTS.map(s => {
                const t = SUBJECT_TONE[s];
                const active = p.editSubject === s;
                return (
                  <button
                    key={s}
                    onClick={() => p.setEditSubject(s)}
                    data-testid={`edit-subject-${todo.id}-${s}`}
                    className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full transition-all"
                    style={active ? t.chipActiveStyle : t.chipStyle}
                  >
                    {TASK_SUBJECT_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.10em] mb-1.5">Deadline</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                inputMode="numeric"
                placeholder="dd/mm or dd/mm/yy"
                value={p.editDateText}
                onChange={e => p.setEditDateText(e.target.value)}
                onBlur={() => { if (p.editDateIso) p.setEditDateText(formatDateForInput(p.editDateIso)); }}
                onKeyDown={e => {
                  if (handleDateArrowKey(e, p.editDateText, p.setEditDateText)) return;
                  if (e.key === "Enter") p.saveEdit(todo.id);
                }}
                className={`w-32 text-xs bg-card border rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 text-foreground ${p.editDateText && !p.editDateIso ? "border-destructive/60" : "border-border"}`}
              />
              <input
                type="time"
                value={p.editTime}
                onChange={e => p.setEditTime(e.target.value)}
                disabled={!p.editDateIso}
                className="text-xs bg-card border border-border rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 text-foreground disabled:opacity-40"
              />
              {p.editDateIso && (
                <span className="text-[10.5px] text-muted-foreground">→ {format(parseISO(p.editDateIso), "d MMM yyyy")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => p.saveEdit(todo.id)}
              disabled={!p.editText.trim()}
              className="flex items-center gap-1 text-xs font-semibold bg-primary text-primary-foreground rounded-full px-3 py-1 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3 h-3" /> Save
            </button>
            {todo.deadline && (
              <button
                onClick={() => p.clearDeadline(todo.id)}
                className="text-xs text-muted-foreground hover:text-destructive underline transition-colors"
              >
                Remove deadline
              </button>
            )}
            <button
              onClick={() => p.setEditingId(null)}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
