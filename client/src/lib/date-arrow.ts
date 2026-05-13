import { format, addDays, addMonths, addYears, parse, isValid } from "date-fns";
import { parseFlexibleDate, formatDateForInput } from "@/lib/date-parser";

type Part = "day" | "month" | "year";

function partAtCursor(text: string, cursor: number): Part {
  const firstSlash = text.indexOf("/");
  const secondSlash = text.indexOf("/", firstSlash + 1);
  if (firstSlash === -1) return "day";
  if (cursor <= firstSlash) return "day";
  if (secondSlash === -1 || cursor <= secondSlash) return "month";
  return "year";
}

/**
 * Handles ArrowUp/ArrowDown on a flexible-date text input. Returns true
 * if the event was handled (caller should preventDefault implicitly via this).
 */
export function handleDateArrowKey(
  e: React.KeyboardEvent<HTMLInputElement>,
  currentValue: string,
  setValue: (v: string) => void,
): boolean {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
  const delta = e.key === "ArrowUp" ? 1 : -1;
  const target = e.currentTarget;
  const cursor = target.selectionStart ?? currentValue.length;

  // Determine the base date.
  let base: Date | null = null;
  const iso = parseFlexibleDate(currentValue);
  if (iso) {
    const parsed = parse(iso, "yyyy-MM-dd", new Date());
    if (isValid(parsed)) base = parsed;
  }
  if (!base) base = new Date();

  const part = partAtCursor(currentValue || "", cursor);
  const next =
    part === "day" ? addDays(base, delta)
    : part === "month" ? addMonths(base, delta)
    : addYears(base, delta);

  const nextIso = format(next, "yyyy-MM-dd");
  const formatted = formatDateForInput(nextIso);
  setValue(formatted);
  e.preventDefault();

  // Restore cursor to the same logical part after React re-renders.
  requestAnimationFrame(() => {
    const el = target;
    if (!el) return;
    const firstSlash = formatted.indexOf("/");
    const secondSlash = formatted.indexOf("/", firstSlash + 1);
    let pos = formatted.length;
    if (part === "day") pos = firstSlash >= 0 ? firstSlash : formatted.length;
    else if (part === "month") pos = secondSlash >= 0 ? secondSlash : formatted.length;
    try { el.setSelectionRange(pos, pos); } catch {}
  });

  return true;
}
