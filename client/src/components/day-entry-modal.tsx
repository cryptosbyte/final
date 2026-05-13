import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { MarkdownEditor } from "@/components/markdown-editor";
import { ConfettiOverlay } from "@/components/confetti-overlay";
import { notifyProductivityRecord } from "@/components/achievement-overlay";
import { Subject, RevisionType, DayEntry, SubjectEntry, RevisionData, ExamPaperRecord, AnkiSessionRecord } from "@/hooks/use-revision-data";
import { useTodos, completeTodoLocal, type TodoItem } from "@/hooks/use-todos";
import { CheckCircle2, Circle, X, Clock, ChevronRight } from "lucide-react";
import { DayTimelineModal } from "@/components/day-timeline-modal";

interface DayEntryModalProps {
  date: string | null;
  anchorRect?: DOMRect | null;
  existingEntry?: DayEntry;
  allData: RevisionData;
  onClose: () => void;
  onSave: (date: string, entry: DayEntry) => void;
}

const POPOVER_W = 520;
const POPOVER_MAX_H = 560;
const GAP = 8;
const VIEWPORT_PAD = 12;

function computePosition(anchor: DOMRect | null | undefined): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 80, left: 80 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!anchor) {
    return {
      top: Math.max(VIEWPORT_PAD, (vh - POPOVER_MAX_H) / 2),
      left: Math.max(VIEWPORT_PAD, (vw - POPOVER_W) / 2),
    };
  }
  // Prefer right of the cell, then left, then below/above with horizontal centering.
  let left = anchor.right + GAP;
  if (left + POPOVER_W + VIEWPORT_PAD > vw) {
    left = anchor.left - POPOVER_W - GAP;
    if (left < VIEWPORT_PAD) {
      left = anchor.left + anchor.width / 2 - POPOVER_W / 2;
    }
  }
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - POPOVER_W - VIEWPORT_PAD));

  let top = anchor.top;
  if (top + POPOVER_MAX_H + VIEWPORT_PAD > vh) {
    top = vh - POPOVER_MAX_H - VIEWPORT_PAD;
  }
  top = Math.max(VIEWPORT_PAD, top);
  return { top, left };
}

const SUBJECT_CONFIG: Record<Subject, {
  name: string;
  colorClass: string;
  activeClass: string;
  types: RevisionType[];
}> = {
  biology: {
    name: "Biology (OCR A)",
    colorClass: "text-[hsl(var(--biology))] border-[hsl(var(--biology))]",
    activeClass: "bg-[hsl(var(--biology))] text-white border-[hsl(var(--biology))]",
    types: ["module_content", "exam_practice", "past_paper", "anki_flashcards"]
  },
  chemistry: {
    name: "Chemistry (OCR B)",
    colorClass: "text-[hsl(var(--chemistry))] border-[hsl(var(--chemistry))]",
    activeClass: "bg-[hsl(var(--chemistry))] text-white border-[hsl(var(--chemistry))]",
    types: ["module_content", "exam_practice", "past_paper"]
  },
  maths: {
    name: "Maths (Edexcel)",
    colorClass: "text-[hsl(var(--maths))] border-[hsl(var(--maths))]",
    activeClass: "bg-[hsl(var(--maths))] text-white border-[hsl(var(--maths))]",
    types: ["module_content", "exam_practice", "past_paper", "mixed_exercises"]
  }
};

const TYPE_LABELS: Record<RevisionType, string> = {
  module_content: "Module Content",
  exam_practice: "Exam Paper Practice",
  past_paper: "Past Paper Questions",
  mixed_exercises: "Mixed Exercises",
  anki_flashcards: "Anki Flashcard Revision"
};

const ALL_BIOLOGY_TOPICS: { id: string; label: string }[] = [];
// Filled below after BIOLOGY_MODULES is declared.

interface BioModule {
  title: string;
  submodules: { id: string; label: string }[];
}

const BIOLOGY_MODULES: BioModule[] = [
  {
    title: "Module 3: Exchange and Transport",
    submodules: [
      { id: "3.1.1", label: "3.1.1 Exchange surfaces" },
      { id: "3.1.2", label: "3.1.2 Transport in animals" },
      { id: "3.1.3", label: "3.1.3 Transport in plants" }
    ]
  },
  {
    title: "Module 4: Biodiversity",
    submodules: [
      { id: "4.1.1", label: "4.1.1 Communicable diseases, disease prevention, immune system" },
      { id: "4.2.1", label: "4.2.1 Biodiversity" },
      { id: "4.2.2", label: "4.2.2 Classification and evolution" }
    ]
  },
  {
    title: "Module 5: Communication and Homeostasis",
    submodules: [
      { id: "5.1.1", label: "5.1.1 Communication and homeostasis" },
      { id: "5.1.2", label: "5.1.2 Excretion" },
      { id: "5.1.3", label: "5.1.3 Neuronal communication" },
      { id: "5.1.4", label: "5.1.4 Hormonal communication" },
      { id: "5.1.5", label: "5.1.5 Plant and animal responses" },
      { id: "5.2.1", label: "5.2.1 Photosynthesis" },
      { id: "5.2.2", label: "5.2.2 Respiration" }
    ]
  },
  {
    title: "Module 6: Genetics, Evolution and Ecosystems",
    submodules: [
      { id: "6.1.1", label: "6.1.1 Cellular control" },
      { id: "6.1.2", label: "6.1.2 Patterns of inheritance" },
      { id: "6.1.3", label: "6.1.3 Manipulating genomes" },
      { id: "6.2.1", label: "6.2.1 Cloning and biotechnology" },
      { id: "6.3.1", label: "6.3.1 Ecosystems" },
      { id: "6.3.2", label: "6.3.2 Populations and sustainability" }
    ]
  }
];

// Flatten biology submodules for Anki topic dropdown.
BIOLOGY_MODULES.forEach(mod => mod.submodules.forEach(s => ALL_BIOLOGY_TOPICS.push(s)));

function AnkiFlashcardsContent({
  sessions,
  onChange,
}: {
  sessions: AnkiSessionRecord[];
  onChange: (next: AnkiSessionRecord[]) => void;
}) {
  const addSession = () => {
    const next: AnkiSessionRecord = {
      id: `anki:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      topicId: ALL_BIOLOGY_TOPICS[0]!.id,
      hours: 0.5,
    };
    onChange([...sessions, next]);
  };

  const updateSession = (id: string, patch: Partial<AnkiSessionRecord>) => {
    onChange(sessions.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const removeSession = (id: string) => onChange(sessions.filter(s => s.id !== id));

  const totalHours = sessions.reduce((acc, s) => acc + (Number.isFinite(s.hours) ? s.hours : 0), 0);

  return (
    <div className="space-y-2 mt-3" data-testid="anki-sessions">
      {sessions.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No Anki sessions yet. Add one for each topic you reviewed today.
        </p>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-2" data-testid={`anki-row-${s.id}`}>
          <select
            value={s.topicId}
            onChange={e => updateSession(s.id, { topicId: e.target.value })}
            className="flex-1 min-w-0 text-xs bg-background border border-border rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-[hsl(var(--biology)/0.4)]"
            data-testid={`anki-topic-${s.id}`}
          >
            {ALL_BIOLOGY_TOPICS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step={0.25}
            value={Number.isFinite(s.hours) ? s.hours : 0}
            onChange={e => updateSession(s.id, { hours: e.target.value === "" ? 0 : parseFloat(e.target.value) })}
            className="w-16 text-xs bg-background border border-border rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-[hsl(var(--biology)/0.4)]"
            data-testid={`anki-hours-${s.id}`}
            aria-label="Hours"
          />
          <span className="text-[11px] text-muted-foreground">h</span>
          <button
            type="button"
            onClick={() => removeSession(s.id)}
            aria-label="Remove session"
            data-testid={`anki-remove-${s.id}`}
            className="w-7 h-7 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={addSession}
          data-testid="anki-add-session"
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-[hsl(var(--biology)/0.12)] text-[hsl(var(--biology))] hover:bg-[hsl(var(--biology)/0.2)] transition-colors"
        >
          + Add topic session
        </button>
        {sessions.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            Total: <strong className="text-foreground">{totalHours.toFixed(2)}h</strong> across {sessions.length} topic{sessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

const CHEMISTRY_MODULES = ["EL", "DF", "ES", "OZ", "WM", "O", "CI", "PL", "DM", "CD"];

const MATHS_MODULES = ["Pure", "Mechanics", "Statistics"];

const MECHANICS_SUBTOPICS = [
  "Quantities & Units in Mechanics",
  "Kinematics 1 (Constant Acc)",
  "Forces & Newton's Laws",
  "Kinematics 2 (Variable Acc)",
  "Forces at any angle and applications",
  "Moments",
  "Projectiles",
  "Further kinematics",
];

const STATISTICS_SUBTOPICS = [
  "Statistical Sampling & Dataset",
  "Data presentation & interpretation",
  "Conditional Probability",
  "Statistical distributions",
  "Statistical Hypothesis Testing",
  "Regression & correlation",
  "The normal distribution",
];

const PURE_SUBTOPICS = [
  "Exponentials and Logs Modelling",
  "Exponentials and Logs",
  "Coordinate Geometry",
  "Proof",
  "Vectors",
  "Integration Parametric Equations",
  "Integration Differential Equations",
  "Integration Trapezium Rule",
  "Integration",
  "Numerical Methods",
  "Parametrics",
  "Sectors and Segments",
  "Differentiation Optimisation",
  "Implicit Differentiation",
  "Differentiation",
  "Trigonometry Modelling",
  "Trigonometry",
  "Binomial Expansion",
  "Sequences and Series Modelling",
  "Sequences and Series",
  "Modulus Function",
  "Functions"
];

const EXAM_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017];

const EXAM_PAPERS: Record<"biology" | "chemistry" | "maths", string[]> = {
  biology:   ["Paper 1", "Paper 2", "Paper 3"],
  chemistry: ["Paper 1", "Paper 2", "Paper 3"],
  maths:     ["Paper 1", "Paper 2", "Paper 3 Statistics", "Paper 3 Mechanics"]
};

function ExamPracticeContent({
  subject,
  records,
  onChange,
  dayAlreadyLogged = false,
}: {
  subject: "biology" | "chemistry" | "maths";
  records: ExamPaperRecord[];
  onChange: (records: ExamPaperRecord[]) => void;
  dayAlreadyLogged?: boolean;
}) {
  const papers = EXAM_PAPERS[subject];
  const colorVar = subject === "biology" ? "--biology" : subject === "chemistry" ? "--chemistry" : "--maths";

  const nonCustomCount = records.filter(r => !r.isCustom).length;
  const [tableCollapsed, setTableCollapsed] = useState<boolean>(
    () => dayAlreadyLogged && nonCustomCount === 0,
  );

  const getRecord = (year: number, paper: string) =>
    records.find(r => !r.isCustom && r.year === year && r.paper === paper);

  const toggleYearPaper = (year: number, paper: string) => {
    const existing = getRecord(year, paper);
    if (existing) {
      onChange(records.filter(r => r.id !== existing.id));
    } else {
      const rec: ExamPaperRecord = { id: `${year}:${paper}`, year, paper, completed: true, isCustom: false };
      onChange([...records, rec]);
    }
  };

  const updateRecord = (id: string, updates: Partial<ExamPaperRecord>) =>
    onChange(records.map(r => r.id === id ? { ...r, ...updates } : r));

  const removeRecord = (id: string) => onChange(records.filter(r => r.id !== id));

  const addCustom = () => {
    const rec: ExamPaperRecord = {
      id: `custom:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      paper: papers[0],
      completed: false,
      isCustom: true,
      customLabel: ""
    };
    onChange([...records, rec]);
  };

  const boxCls = (checked: boolean) =>
    `flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors cursor-pointer select-none ${
      checked
        ? `bg-[hsl(var(${colorVar}))] border-[hsl(var(${colorVar}))]`
        : "border-border bg-background hover:border-muted-foreground"
    }`;

  const Tick = () => (
    <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
      <polyline points="1.5,6 4.5,9 10.5,3" />
    </svg>
  );

  const MarksInput = ({ id, field, value }: { id: string; field: "marksObtained" | "totalMarks"; value?: number }) => (
    <input
      type="number" min={0} placeholder="—"
      value={value ?? ""}
      onChange={e => updateRecord(id, { [field]: e.target.value ? +e.target.value : undefined })}
      className="w-10 h-6 text-xs border border-border rounded px-1 bg-background text-center"
    />
  );

  const customRecords = records.filter(r => r.isCustom);

  return (
    <div className="mt-3 space-y-5">
      {/* Year-based table (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setTableCollapsed(c => !c)}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
          data-testid={`toggle-exam-table-${subject}`}
          aria-expanded={!tableCollapsed}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${tableCollapsed ? "" : "rotate-90"}`}
          />
          <span>
            Exam papers by year
            {nonCustomCount > 0 && (
              <span className="ml-1.5 text-[10px] font-medium text-foreground/70">
                · {nonCustomCount} done
              </span>
            )}
          </span>
        </button>
        {!tableCollapsed && (
        <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-4 w-14">Year</th>
              {papers.map(p => (
                <th key={p} className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-5 whitespace-nowrap">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXAM_YEARS.map(year => (
              <tr key={year} className="border-t border-border/30">
                <td className="pr-4 text-xs font-medium text-foreground align-top pt-2.5">{year}</td>
                {papers.map(paper => {
                  const rec = getRecord(year, paper);
                  return (
                    <td key={paper} className="py-1.5 pr-5 align-top">
                      <div className="flex flex-col gap-1.5">
                        <span onClick={() => toggleYearPaper(year, paper)} className={boxCls(!!rec)}>
                          {rec && <Tick />}
                        </span>
                        {rec && (
                          <div className="flex items-center gap-0.5">
                            <MarksInput id={rec.id} field="marksObtained" value={rec.marksObtained} />
                            <span className="text-muted-foreground text-xs">/</span>
                            <MarksInput id={rec.id} field="totalMarks" value={rec.totalMarks} />
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        )}
      </div>

      {/* Custom papers */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom Papers</p>
        {customRecords.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No custom papers yet.</p>
        )}
        {customRecords.map(rec => (
          <div key={rec.id} className="flex items-center gap-2 bg-secondary/30 rounded-lg px-3 py-2 flex-wrap">
            <span onClick={() => updateRecord(rec.id, { completed: !rec.completed })} className={boxCls(rec.completed)}>
              {rec.completed && <Tick />}
            </span>
            <select
              value={rec.paper}
              onChange={e => updateRecord(rec.id, { paper: e.target.value })}
              className="text-xs border border-border rounded px-1.5 py-1 bg-background h-7 shrink-0"
            >
              {papers.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="Custom">Custom</option>
            </select>
            <input
              type="text"
              placeholder="Label (e.g. Mock 1)"
              value={rec.customLabel ?? ""}
              onChange={e => updateRecord(rec.id, { customLabel: e.target.value })}
              className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background h-7 min-w-[80px]"
            />
            <div className="flex items-center gap-0.5 shrink-0">
              <input
                type="number" min={0} placeholder="—"
                value={rec.marksObtained ?? ""}
                onChange={e => updateRecord(rec.id, { marksObtained: e.target.value ? +e.target.value : undefined })}
                className="w-10 h-7 text-xs border border-border rounded px-1 bg-background text-center"
              />
              <span className="text-muted-foreground text-xs">/</span>
              <input
                type="number" min={0} placeholder="—"
                value={rec.totalMarks ?? ""}
                onChange={e => updateRecord(rec.id, { totalMarks: e.target.value ? +e.target.value : undefined })}
                className="w-10 h-7 text-xs border border-border rounded px-1 bg-background text-center"
              />
            </div>
            <button onClick={() => removeRecord(rec.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0" title="Remove">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ))}
        <button
          onClick={addCustom}
          className={`flex items-center gap-1.5 text-xs font-medium text-[hsl(var(${colorVar}))] hover:opacity-75 transition-opacity mt-1`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add custom paper
        </button>
      </div>
    </div>
  );
}

function ModuleCheckbox({
  id,
  label,
  checked,
  onChange,
  colorVar,
  previouslyDone = false
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (id: string, checked: boolean) => void;
  colorVar: string;
  previouslyDone?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 text-sm cursor-pointer py-1 group`}
      data-testid={`checkbox-module-${id}`}
    >
      <span
        onClick={() => onChange(id, !checked)}
        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          checked
            ? `bg-[hsl(var(${colorVar}))] border-[hsl(var(${colorVar}))]`
            : "border-border bg-background group-hover:border-muted-foreground"
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="1.5,6 4.5,9 10.5,3" />
          </svg>
        )}
      </span>
      <span className={checked ? `text-[hsl(var(${colorVar}))] font-medium` : "text-foreground"}>
        {label}
        {previouslyDone && (
          <span className="ml-1 text-emerald-500 font-bold" title="Previously revised">*</span>
        )}
      </span>
    </label>
  );
}

function BiologyModuleContent({
  selected,
  onChange,
  previouslyDone
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  previouslyDone: Set<string>;
}) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, id]);
    } else {
      onChange(selected.filter(s => s !== id));
    }
  };

  return (
    <div className="space-y-4 mt-3">
      {BIOLOGY_MODULES.map(mod => (
        <div key={mod.title} className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--biology))] opacity-80 mb-1">
            {mod.title}
          </p>
          <div className="pl-1 space-y-0.5">
            {mod.submodules.map(sub => (
              <ModuleCheckbox
                key={sub.id}
                id={sub.id}
                label={sub.label}
                checked={selected.includes(sub.id)}
                onChange={toggle}
                colorVar="--biology"
                previouslyDone={previouslyDone.has(sub.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChemistryModuleContent({
  selected,
  onChange,
  previouslyDone
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  previouslyDone: Set<string>;
}) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, id]);
    } else {
      onChange(selected.filter(s => s !== id));
    }
  };

  return (
    <div className="flex flex-wrap gap-x-6 mt-3">
      {CHEMISTRY_MODULES.map(mod => (
        <ModuleCheckbox
          key={mod}
          id={mod}
          label={mod}
          checked={selected.includes(mod)}
          onChange={toggle}
          previouslyDone={previouslyDone.has(mod)}
          colorVar="--chemistry"
        />
      ))}
    </div>
  );
}

function MathsModuleContent({
  selected,
  onChange,
  previouslyDone
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  previouslyDone: Set<string>;
}) {
  const SUBTOPIC_MAP: Record<string, string[]> = {
    Pure: PURE_SUBTOPICS,
    Mechanics: MECHANICS_SUBTOPICS,
    Statistics: STATISTICS_SUBTOPICS,
  };

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, id]);
    } else {
      if (SUBTOPIC_MAP[id]) {
        onChange(selected.filter(s => s !== id && !s.startsWith(`${id}:`)));
      } else {
        onChange(selected.filter(s => s !== id));
      }
    }
  };

  const toggleSubtopic = (parent: string, topic: string, checked: boolean) => {
    const id = `${parent}:${topic}`;
    if (checked) {
      const next = selected.includes(parent) ? [...selected] : [...selected, parent];
      onChange([...next, id]);
    } else {
      onChange(selected.filter(s => s !== id));
    }
  };

  return (
    <div className="mt-3 space-y-4">
      {MATHS_MODULES.map(mod => {
        const subtopics = SUBTOPIC_MAP[mod];
        const parentChecked = selected.includes(mod);
        return (
          <div key={mod}>
            <ModuleCheckbox
              id={mod}
              label={mod}
              checked={parentChecked}
              onChange={toggle}
              colorVar="--maths"
              previouslyDone={previouslyDone.has(mod)}
            />
            {subtopics && parentChecked && (
              <div className="ml-6 mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 border-l-2 border-[hsl(var(--maths))/30] pl-3">
                {subtopics.map(topic => {
                  const id = `${mod}:${topic}`;
                  const isChecked = selected.includes(id);
                  const wasDoneBefore = previouslyDone.has(id);
                  return (
                    <label
                      key={topic}
                      className="flex items-start gap-2 text-sm cursor-pointer py-0.5 group"
                      data-testid={`checkbox-${mod.toLowerCase()}-${topic}`}
                    >
                      <span
                        onClick={() => toggleSubtopic(mod, topic, !isChecked)}
                        className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                          isChecked
                            ? "bg-[hsl(var(--maths))] border-[hsl(var(--maths))]"
                            : "border-border bg-background group-hover:border-muted-foreground"
                        }`}
                      >
                        {isChecked && (
                          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                            <polyline points="1.5,6 4.5,9 10.5,3" />
                          </svg>
                        )}
                      </span>
                      <span className={`leading-snug ${isChecked ? "text-[hsl(var(--maths))] font-medium" : "text-foreground"}`}>
                        {topic}
                        {wasDoneBefore && (
                          <span className="ml-1 text-emerald-500 font-bold" title="Previously revised">*</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DayEntryModal({ date, anchorRect, existingEntry, allData, onClose, onSave }: DayEntryModalProps) {
  const [subjects, setSubjects] = useState<Partial<Record<Subject, SubjectEntry>>>({});
  const [notes, setNotes] = useState("");
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  // Guard against re-firing the productivity-record celebration when the user
  // saves the same day repeatedly without changing the rating (or rapid
  // double-click before parent state updates `allData`).
  const lastRecordRatingRef = useRef<number>(0);

  useEffect(() => {
    if (existingEntry) {
      setSubjects(existingEntry.subjects || {});
      setNotes(existingEntry.notes || "");
    } else {
      setSubjects({});
      setNotes("");
    }
  }, [existingEntry, date]);

  const allTodos = useTodos();
  const tasksDueToday: TodoItem[] = date
    ? allTodos.filter(t => {
        if (!t.deadline) return false;
        const dueDate = t.deadline.includes("T") ? t.deadline.split("T")[0] : t.deadline;
        return dueDate === date;
      })
    : [];

  const popoverRef = useRef<HTMLDivElement>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>(() => computePosition(anchorRect));

  useLayoutEffect(() => {
    if (!date) return;
    setPos(computePosition(anchorRect));
  }, [date, anchorRect]);

  useEffect(() => {
    if (!date) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!popoverRef.current || !target) return;
      if (popoverRef.current.contains(target)) return;
      // Ignore clicks inside the day-timeline modal (portaled to document.body, so
      // it lives outside popoverRef's subtree).
      const el = target instanceof Element ? target : (target as Node).parentElement;
      if (el?.closest('[data-testid="day-timeline-modal"]')) return;
      onClose();
    };
    const onResize = () => setPos(computePosition(anchorRect));
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [date, anchorRect, onClose]);

  if (!date) return null;

  // Compute which module IDs have been selected on any day OTHER than today
  const prevDone: Record<Subject, Set<string>> = {
    biology: new Set(),
    chemistry: new Set(),
    maths: new Set()
  };
  Object.entries(allData).forEach(([entryDate, entry]) => {
    if (entryDate === date) return;
    (Object.keys(prevDone) as Subject[]).forEach(subj => {
      const mc = entry.subjects?.[subj]?.moduleContent;
      if (mc) mc.forEach(id => prevDone[subj].add(id));
    });
  });

  const toggleType = (subject: Subject, type: RevisionType) => {
    setSubjects(prev => {
      const currentSubject = prev[subject] || { types: [], productivity: 0, moduleContent: [], notes: "" };
      const types = currentSubject.types.includes(type)
        ? currentSubject.types.filter(t => t !== type)
        : [...currentSubject.types, type];
      return {
        ...prev,
        [subject]: { ...currentSubject, types }
      };
    });
  };

  const setProductivity = (subject: Subject, rating: number) => {
    // Compute the previous rating from the latest closure state (not from
    // inside a setState updater — updaters must be pure side-effect free).
    const prevRating = subjects[subject]?.productivity ?? 0;
    setSubjects(prev => {
      const currentSubject = prev[subject] || { types: [], productivity: 0, moduleContent: [], notes: "" };
      return {
        ...prev,
        [subject]: { ...currentSubject, productivity: rating }
      };
    });
    if (rating === 5 && prevRating !== 5) {
      setConfettiTrigger(t => t + 1);
    }
  };

  const setModuleContent = (subject: Subject, ids: string[]) => {
    setSubjects(prev => {
      const currentSubject = prev[subject] || { types: [], productivity: 0, moduleContent: [], notes: "" };
      return {
        ...prev,
        [subject]: { ...currentSubject, moduleContent: ids }
      };
    });
  };

  const setExamPaperRecords = (subject: Subject, recs: ExamPaperRecord[]) => {
    setSubjects(prev => {
      const currentSubject = prev[subject] || { types: [], productivity: 0, examPaperRecords: [], notes: "" };
      return {
        ...prev,
        [subject]: { ...currentSubject, examPaperRecords: recs }
      };
    });
  };

  const setAnkiSessions = (subject: Subject, sessions: AnkiSessionRecord[]) => {
    setSubjects(prev => {
      const currentSubject = prev[subject] || { types: [], productivity: 0, notes: "" };
      return {
        ...prev,
        [subject]: { ...currentSubject, ankiSessions: sessions }
      };
    });
  };

  const setSubjectNotes = (subject: Subject, text: string) => {
    setSubjects(prev => {
      const currentSubject = prev[subject] || { types: [], productivity: 0, moduleContent: [], notes: "" };
      return {
        ...prev,
        [subject]: { ...currentSubject, notes: text }
      };
    });
  };

  const handleSave = () => {
    const filteredSubjects: Partial<Record<Subject, SubjectEntry>> = {};
    (Object.entries(subjects) as [Subject, SubjectEntry][]).forEach(([subj, entry]) => {
      if (
        entry.types.length > 0 ||
        entry.productivity > 0 ||
        (entry.moduleContent && entry.moduleContent.length > 0) ||
        (entry.examPaperRecords && entry.examPaperRecords.length > 0) ||
        (entry.ankiSessions && entry.ankiSessions.length > 0) ||
        entry.notes
      ) {
        filteredSubjects[subj] = entry;
      }
    });

    // Productivity-record check: did this save beat the all-time max
    // productivity rating across all OTHER days?
    let prevMax = 0;
    Object.entries(allData).forEach(([entryDate, entry]) => {
      if (entryDate === date) return;
      const subj = entry.subjects;
      if (!subj) return;
      (Object.values(subj) as SubjectEntry[]).forEach(s => {
        if (s && typeof s.productivity === "number" && s.productivity > prevMax) {
          prevMax = s.productivity;
        }
      });
    });
    let newMax = 0;
    (Object.values(filteredSubjects) as SubjectEntry[]).forEach(s => {
      if (s && typeof s.productivity === "number" && s.productivity > newMax) {
        newMax = s.productivity;
      }
    });

    onSave(date, {
      date,
      subjects: filteredSubjects,
      notes: notes.trim()
    });

    if (newMax > 0 && newMax > prevMax && newMax > lastRecordRatingRef.current) {
      lastRecordRatingRef.current = newMax;
      notifyProductivityRecord({ rating: newMax, prevMax });
    }
  };

  const displayDate = format(parseISO(date), "EEEE, do MMMM yyyy");

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Day entry for ${displayDate}`}
      data-testid="day-entry-popover"
      className="fixed z-50 w-[520px] max-w-[calc(100vw-1.5rem)] max-h-[min(560px,80vh)] overflow-y-auto rounded-3xl border border-border/60 shadow-2xl bg-card p-5 animate-in fade-in-0 zoom-in-95"
      style={{
        top: pos.top,
        left: pos.left,
      }}
    >
      <ConfettiOverlay trigger={confettiTrigger} />
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-col space-y-1.5">
          <h2 className="text-2xl font-bold tracking-tight leading-tight">{displayDate}</h2>
          <p className="text-sm text-muted-foreground">Log your revision sessions and rate your productivity.</p>
        </div>
        <div className="flex items-center gap-1.5 -mr-1 -mt-1">
          <button
            onClick={() => setShowTimeline(true)}
            aria-label="Open day timeline"
            data-testid="button-open-timeline"
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "hsl(var(--primary) / 0.12)",
              color: "hsl(var(--primary))",
            }}
          >
            <Clock className="w-3.5 h-3.5" />
            Day Timeline
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="button-close-popover"
            className="shrink-0 w-8 h-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <DayTimelineModal
        date={showTimeline ? date : null}
        onClose={() => setShowTimeline(false)}
      />

        {tasksDueToday.length > 0 && (
          <div className="rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-500/5 px-4 py-3 mb-2" data-testid="section-tasks-due">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
              Tasks due today ({tasksDueToday.length})
            </p>
            <ul className="space-y-1.5">
              {tasksDueToday.map(t => {
                const timePart = t.deadline && t.deadline.includes("T")
                  ? t.deadline.split("T")[1]?.slice(0, 5)
                  : null;
                return (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => completeTodoLocal(t.id)}
                      disabled={t.completed}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-emerald-600 disabled:opacity-60 disabled:hover:text-muted-foreground"
                      title={t.completed ? "Completed" : "Mark complete"}
                      data-testid={`button-complete-due-${t.id}`}
                    >
                      {t.completed
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        : <Circle className="w-4 h-4" />}
                    </button>
                    <span className={`flex-1 ${t.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {t.text}
                      {timePart && (
                        <span className="ml-2 text-xs text-muted-foreground">@ {timePart}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="py-4 space-y-8">
          {(Object.keys(SUBJECT_CONFIG) as Subject[]).map(subject => {
            const config = SUBJECT_CONFIG[subject];
            const entry = subjects[subject] || { types: [], productivity: 0, moduleContent: [], notes: "" };
            const isActive = entry.types.length > 0 || entry.productivity > 0;
            const showModuleContent = entry.types.includes("module_content");
            const showExamPractice = entry.types.includes("exam_practice");
            const showAnki = subject === "biology" && entry.types.includes("anki_flashcards");
            const moduleContent = entry.moduleContent || [];
            const examPaperRecords = entry.examPaperRecords || [];
            const ankiSessions = entry.ankiSessions || [];

            const subjectVar = `var(--${subject})`;
            return (
              <div
                key={subject}
                className="space-y-4 rounded-2xl p-5 border transition-colors relative overflow-hidden"
                style={{
                  background: isActive
                    ? `hsl(${subjectVar} / 0.06)`
                    : "hsl(var(--secondary) / 0.4)",
                  borderColor: isActive
                    ? `hsl(${subjectVar} / 0.25)`
                    : "hsl(var(--border) / 0.6)",
                }}
                data-testid={`subject-section-${subject}`}
              >
                {/* Color stripe */}
                <span
                  aria-hidden
                  className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full"
                  style={{ background: `hsl(${subjectVar})`, opacity: isActive ? 1 : 0.4 }}
                />
                <div className="flex items-center justify-between pl-2">
                  <h3
                    className="font-bold text-lg tracking-tight"
                    style={{ color: `hsl(${subjectVar})` }}
                  >
                    {config.name}
                  </h3>
                </div>

                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Activities</Label>
                  <div className="flex flex-wrap gap-2">
                    {config.types.map(type => {
                      const selected = entry.types.includes(type);
                      return (
                        <button
                          key={type}
                          data-testid={`toggle-${subject}-${type}`}
                          onClick={() => toggleType(subject, type)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${
                            selected ? config.activeClass : "bg-transparent text-muted-foreground hover:bg-secondary border-border"
                          }`}
                        >
                          {TYPE_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {showExamPractice && (
                  <div className="border-t border-border/50 pt-4">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                      Exam papers done
                    </Label>
                    <ExamPracticeContent
                      subject={subject as "biology" | "chemistry" | "maths"}
                      records={examPaperRecords}
                      onChange={(recs) => setExamPaperRecords(subject, recs)}
                      dayAlreadyLogged={!!existingEntry}
                    />
                  </div>
                )}

                {showAnki && (
                  <div className="border-t border-border/50 pt-4">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                      Anki flashcard sessions
                    </Label>
                    <AnkiFlashcardsContent
                      sessions={ankiSessions}
                      onChange={(next) => setAnkiSessions(subject, next)}
                    />
                  </div>
                )}

                {showModuleContent && (
                  <div className="border-t border-border/50 pt-4">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                      Modules covered
                    </Label>
                    {subject === "biology" && (
                      <BiologyModuleContent
                        selected={moduleContent}
                        onChange={(ids) => setModuleContent(subject, ids)}
                        previouslyDone={prevDone.biology}
                      />
                    )}
                    {subject === "chemistry" && (
                      <ChemistryModuleContent
                        selected={moduleContent}
                        onChange={(ids) => setModuleContent(subject, ids)}
                        previouslyDone={prevDone.chemistry}
                      />
                    )}
                    {subject === "maths" && (
                      <MathsModuleContent
                        selected={moduleContent}
                        onChange={(ids) => setModuleContent(subject, ids)}
                        previouslyDone={prevDone.maths}
                      />
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Focus & Productivity</Label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(rating => (
                      <button
                        key={rating}
                        data-testid={`productivity-${subject}-${rating}`}
                        onClick={() => setProductivity(subject, rating === entry.productivity ? 0 : rating)}
                        className={`w-10 h-10 rounded-md font-medium text-sm border flex items-center justify-center transition-all duration-150 hover:scale-110 hover:-translate-y-0.5 active:scale-95 ${
                          entry.productivity >= rating
                            ? config.activeClass
                            : "bg-transparent text-muted-foreground hover:bg-secondary border-border"
                        }`}
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    {config.name.split(" ")[0]} Notes
                  </Label>
                  <AutoResizeTextarea
                    data-testid={`notes-${subject}`}
                    placeholder={`Any notes on today's ${config.name.split(" ")[0].toLowerCase()} revision...`}
                    value={entry.notes || ""}
                    onChange={e => setSubjectNotes(subject, e.target.value)}
                    className="text-sm"
                    minRows={3}
                  />
                </div>
              </div>
            );
          })}

          <div className="space-y-3 px-1">
            <Label htmlFor="notes" className="text-xs text-muted-foreground uppercase tracking-wider">General Daily Notes</Label>
            <MarkdownEditor
              value={notes}
              onChange={setNotes}
              placeholder="Any general thoughts or reflections on today's study session? Markdown supported."
              minRows={3}
              testId="notes-general"
            />
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4 mt-2 border-t border-border/60">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">Cancel</Button>
          <Button onClick={handleSave} className="font-semibold px-8" data-testid="button-save">Save Record</Button>
        </div>
    </div>
  );
}
