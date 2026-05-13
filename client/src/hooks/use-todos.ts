import { useEffect, useMemo, useState } from "react";

export type TaskSubject = "biology" | "chemistry" | "maths" | "miscellaneous";

export const TASK_SUBJECTS: TaskSubject[] = [
  "biology",
  "chemistry",
  "maths",
  "miscellaneous",
];

export const TASK_SUBJECT_LABEL: Record<TaskSubject, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  maths: "Maths",
  miscellaneous: "Misc",
};

export const MAX_PINNED_TASKS = 3;

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  deadline?: string;
  pinned?: boolean;
  subject?: TaskSubject;
}

const STORAGE_KEY = "revision_tracker_todos";
const TODOS_CHANGED_EVENT = "revision-tracker-todos-changed";

function readTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function notifyTodosChanged() {
  window.dispatchEvent(new Event(TODOS_CHANGED_EVENT));
}

export function completeTodoLocal(id: string) {
  const todos = readTodos();
  const next = todos.map(t =>
    t.id === id ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  notifyTodosChanged();
}

/** Create a todo and persist it. Used by the day timeline. */
export function addTodoLocal(
  init: { text: string; deadline?: string; subject?: TaskSubject; pinned?: boolean },
): TodoItem {
  const todos = readTodos();
  const newTodo: TodoItem = {
    id: crypto.randomUUID(),
    text: init.text,
    completed: false,
    createdAt: new Date().toISOString(),
    deadline: init.deadline,
    subject: init.subject,
    pinned: init.pinned ?? false,
  };
  const next = [newTodo, ...todos];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  notifyTodosChanged();
  return newTodo;
}

export function updateTodoLocal(id: string, patch: Partial<TodoItem>) {
  const todos = readTodos();
  const next = todos.map(t => (t.id === id ? { ...t, ...patch } : t));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  notifyTodosChanged();
}

export function deleteTodoLocal(id: string) {
  const todos = readTodos();
  const next = todos.filter(t => t.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  notifyTodosChanged();
}

export function useTodos(): TodoItem[] {
  const [todos, setTodos] = useState<TodoItem[]>(() => readTodos());

  useEffect(() => {
    const refresh = () => setTodos(readTodos());

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };

    window.addEventListener(TODOS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TODOS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return todos;
}

export function useTodoCountsByDeadline(): Record<string, number> {
  const todos = useTodos();
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const todo of todos) {
      if (todo.completed || !todo.deadline) continue;
      const dateKey = todo.deadline.includes("T")
        ? todo.deadline.split("T")[0]
        : todo.deadline;
      counts[dateKey] = (counts[dateKey] || 0) + 1;
    }
    return counts;
  }, [todos]);
}
