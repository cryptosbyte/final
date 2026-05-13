export type ExamSubject = "biology" | "chemistry" | "maths";

export interface ExamDate {
  date: string;
  subject: ExamSubject;
  paper: string;
  label: string;
  shortLabel: string;
}

export const EXAM_DATES: ExamDate[] = [
  { date: "2026-06-02", subject: "chemistry", paper: "Paper 1", label: "A Level Chemistry Paper 1", shortLabel: "Chem P1" },
  { date: "2026-06-03", subject: "maths",     paper: "Paper 1", label: "A Level Maths Paper 1",     shortLabel: "Maths P1" },
  { date: "2026-06-04", subject: "biology",   paper: "Paper 1", label: "A Level Biology Paper 1",   shortLabel: "Bio P1" },
  { date: "2026-06-09", subject: "chemistry", paper: "Paper 2", label: "A Level Chemistry Paper 2", shortLabel: "Chem P2" },
  { date: "2026-06-11", subject: "maths",     paper: "Paper 2", label: "A Level Maths Paper 2",     shortLabel: "Maths P2" },
  { date: "2026-06-12", subject: "biology",   paper: "Paper 2", label: "A Level Biology Paper 2",   shortLabel: "Bio P2" },
  { date: "2026-06-15", subject: "chemistry", paper: "Paper 3", label: "A Level Chemistry Paper 3", shortLabel: "Chem P3" },
  { date: "2026-06-16", subject: "biology",   paper: "Paper 3", label: "A Level Biology Paper 3",   shortLabel: "Bio P3" },
  { date: "2026-06-18", subject: "maths",     paper: "Paper 3", label: "A Level Maths Paper 3: Statistics & Mechanics", shortLabel: "Maths P3" },
];

export function getExamsOnDate(dateStr: string): ExamDate[] {
  return EXAM_DATES.filter(e => e.date === dateStr);
}

export function getNextExamForSubject(subject: ExamSubject): ExamDate | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = EXAM_DATES
    .filter(e => e.subject === subject)
    .filter(e => new Date(e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? null;
}
