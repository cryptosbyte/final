/**
 * Cloze-deletion helpers shared between the editor preview and the study UI.
 *
 * Card text uses Anki cloze syntax: `{{c1::answer}}` (optionally
 * `{{c1::answer::hint}}`). The `c1` group lets a single text host multiple
 * blanks that are revealed together; we don't try to schedule per-cloze
 * cards independently — keeping it simple is much faster than Anki's full
 * cloze model and works well for keyword fill-ins.
 */

const CLOZE_RX = /\{\{c\d+::([^}]+?)(?:::([^}]+?))?\}\}/g;

export interface ClozeBlank {
  group: number;
  answer: string;
  hint?: string;
}

export interface ClozeRender {
  /** Markdown with each `{{cN::ans}}` replaced by a blank placeholder. */
  hidden: string;
  /** Markdown with each blank replaced by the literal answer (revealed). */
  revealed: string;
  /** Ordered list of blanks for the answer key. */
  blanks: ClozeBlank[];
}

/**
 * Render a cloze-template string into both hidden and revealed forms. The
 * hidden form uses a styled span so KaTeX-aware sanitization doesn't strip
 * it; the revealed form simply substitutes the answer text inline.
 */
export function renderCloze(text: string): ClozeRender {
  const blanks: ClozeBlank[] = [];
  let hidden = "";
  let revealed = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  CLOZE_RX.lastIndex = 0;
  while ((m = CLOZE_RX.exec(text)) !== null) {
    const before = text.slice(cursor, m.index);
    hidden += before;
    revealed += before;
    const groupMatch = /^\{\{c(\d+)::/.exec(m[0]);
    const group = groupMatch ? Number(groupMatch[1]) : 1;
    const answer = m[1];
    const hint = m[2];
    blanks.push({ group, answer, hint });
    const placeholder = hint
      ? `[${"_".repeat(Math.max(3, Math.min(12, answer.length)))} (${hint})]`
      : `[${"_".repeat(Math.max(3, Math.min(12, answer.length)))}]`;
    hidden += placeholder;
    revealed += `**${answer}**`;
    cursor = m.index + m[0].length;
  }
  hidden += text.slice(cursor);
  revealed += text.slice(cursor);
  return { hidden, revealed, blanks };
}

export function hasCloze(text: string): boolean {
  CLOZE_RX.lastIndex = 0;
  return CLOZE_RX.test(text);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "should", "could", "may", "might", "can", "of", "to", "in", "on", "at",
  "by", "for", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "from", "up", "down", "out",
  "over", "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "this", "that", "these", "those", "i", "you", "he",
  "she", "it", "we", "they", "them", "his", "her", "its", "our", "their",
  "as", "if", "while", "because", "until", "also", "just",
]);

/**
 * Auto-suggest cloze blanks: pick up to 3 keyword tokens (length > 3, not
 * stopwords) and wrap each in `{{c1::word}}`. Picks randomly so users can
 * regenerate to get fresh blanks.
 */
export function autoCloze(text: string, max = 3): string {
  const tokens: { word: string; start: number; end: number }[] = [];
  const re = /[A-Za-z][A-Za-z\-']{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = m[0];
    if (w.length <= 3) continue;
    if (STOPWORDS.has(w.toLowerCase())) continue;
    // Don't double-cloze something already inside a marker.
    const before = text.slice(Math.max(0, m.index - 5), m.index);
    if (before.endsWith("::")) continue;
    tokens.push({ word: w, start: m.index, end: m.index + w.length });
  }
  if (tokens.length === 0) return text;
  const pool = [...tokens];
  const picks: typeof tokens = [];
  while (picks.length < max && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  picks.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  picks.forEach((p, i) => {
    out += text.slice(cursor, p.start);
    out += `{{c${i + 1}::${p.word}}}`;
    cursor = p.end;
  });
  out += text.slice(cursor);
  return out;
}
