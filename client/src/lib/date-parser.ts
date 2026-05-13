import { format, isValid, parse, isBefore, addYears } from "date-fns";

/**
 * Smart date parser that accepts a variety of human-friendly inputs and returns
 * an ISO yyyy-MM-dd string (or null if it couldn't make sense of the input).
 *
 * Accepted formats:
 *   - "13/05"        → today's year (or next year if the date has already passed)
 *   - "13/5"
 *   - "13-05"
 *   - "13.05"
 *   - "13/05/26"     → 2026
 *   - "13/05/2026"
 *   - "2026-05-13"   (already ISO — pass-through)
 *   - "13 May" / "13 May 2026" / "13 May 26"
 */
export function parseFlexibleDate(input: string, today: Date = new Date()): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already ISO yyyy-MM-dd
  const iso = parse(trimmed, "yyyy-MM-dd", today);
  if (isValid(iso) && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return format(iso, "yyyy-MM-dd");
  }

  const currentYear = today.getFullYear();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // If the input contains a letter, try month-name formats first.
  // (We must do this BEFORE separator normalisation, otherwise
  // "13 May" turns into "13/May" and falls into the numeric branch.)
  if (/[a-zA-Z]/.test(trimmed)) {
    for (const fmt of ["d MMM yyyy", "d MMM yy", "d MMM", "d MMMM yyyy", "d MMMM yy", "d MMMM"]) {
      const parsed = parse(trimmed, fmt, today);
      if (isValid(parsed)) {
        let result = parsed;
        if (!fmt.includes("y")) {
          result = new Date(currentYear, parsed.getMonth(), parsed.getDate());
          if (isBefore(result, todayStart)) result = addYears(result, 1);
        }
        return format(result, "yyyy-MM-dd");
      }
    }
    return null;
  }

  // Normalise separators: "13.05", "13-05", "13 05" → "13/05"
  const normalised = trimmed.replace(/[.\-\s]+/g, "/");
  const parts = normalised.split("/").filter(Boolean);

  if (parts.length === 2) {
    const [dStr, mStr] = parts;
    const day = parseInt(dStr, 10);
    const month = parseInt(mStr, 10);
    if (!Number.isFinite(day) || !Number.isFinite(month)) return null;

    // Try this year first; if it's already passed, roll forward to next year.
    let candidate = new Date(currentYear, month - 1, day);
    if (!isValid(candidate) || candidate.getDate() !== day || candidate.getMonth() !== month - 1) {
      return null;
    }
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (isBefore(candidate, todayStart)) {
      candidate = addYears(candidate, 1);
    }
    return format(candidate, "yyyy-MM-dd");
  }

  if (parts.length === 3) {
    const [dStr, mStr, yStr] = parts;
    const day = parseInt(dStr, 10);
    const month = parseInt(mStr, 10);
    let year = parseInt(yStr, 10);
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
    if (year < 100) year += 2000;
    const candidate = new Date(year, month - 1, day);
    if (!isValid(candidate) || candidate.getDate() !== day || candidate.getMonth() !== month - 1) {
      return null;
    }
    return format(candidate, "yyyy-MM-dd");
  }

  return null;
}

/** Format an ISO yyyy-MM-dd string for display in the smart input. */
export function formatDateForInput(iso: string): string {
  if (!iso) return "";
  const d = parse(iso, "yyyy-MM-dd", new Date());
  if (!isValid(d)) return iso;
  return format(d, "dd/MM/yyyy");
}
