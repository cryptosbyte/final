import { useState, useEffect } from "react";
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  parseISO,
  startOfWeek,
  endOfWeek
} from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useRevisionData } from "@/hooks/use-revision-data";
import { DayEntryModal } from "@/components/day-entry-modal";
import { DayTimelineModal, RT_TODO_DRAG_TYPE } from "@/components/day-timeline-modal";
import { Subject } from "@/hooks/use-revision-data";
import { getExamsOnDate } from "@/lib/exam-dates";
import { estimateDayHours, formatHours } from "@/lib/activity-hours";
import { useAuthContext } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useTodoCountsByDeadline, useTodos, updateTodoLocal } from "@/hooks/use-todos";
import { useEvents } from "@/hooks/use-events";
import { startOfDay } from "date-fns";
import { TodoPanel } from "@/components/todo-panel";
import { useQuranPlan, getPagesForDate } from "@/hooks/use-quran-plan";
import { QuranSetupModal } from "@/components/quran-setup-modal";

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [direction, setDirection] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  // Future-date timeline popover state — separate from selectedDate so the
  // revision-entry modal stays closed for future dates.
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [timelineAnchorRect, setTimelineAnchorRect] = useState<DOMRect | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const { user } = useAuthContext();
  const { toast } = useToast();
  const { data, getDay, updateDay, syncing, synced, uploadedCount } = useRevisionData(user);
  const todoCountsByDate = useTodoCountsByDeadline();
  const allTodos = useTodos();
  const allEvents = useEvents();
  const todayStart = startOfDay(new Date());
  const [quranModalOpen, setQuranModalOpen] = useState(false);
  const { plan: quranPlan } = useQuranPlan();

  useEffect(() => {
    if (synced && uploadedCount > 0) {
      toast({
        title: "Local data synced",
        description: `${uploadedCount} day${uploadedCount !== 1 ? "s" : ""} of revision data uploaded to your account.`,
        duration: 5000,
      });
    }
  }, [synced, uploadedCount, toast]);

  const nextMonth = () => {
    setDirection(1);
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const prevMonth = () => {
    setDirection(-1);
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleSave = (date: string, entry: any) => {
    updateDay(date, entry);
    setSelectedDate(null);
    setAnchorRect(null);
  };

  const handleDayClick = (e: React.MouseEvent<HTMLButtonElement>, dateStr: string) => {
    const clicked = parseISO(dateStr);
    if (clicked > todayStart) {
      // Toggle: clicking the same future date again closes the timeline.
      if (timelineDate === dateStr) {
        setTimelineDate(null);
        setTimelineAnchorRect(null);
        setHoveredDate(null);
        return;
      }
      // Future date: open the day timeline so the user can plan ahead by
      // clicking any hour to add a task — even if no tasks exist yet.
      setTimelineAnchorRect(e.currentTarget.getBoundingClientRect());
      setTimelineDate(dateStr);
      setHoveredDate(null);
      return;
    }
    // Toggle: clicking the same day again closes the productivity log.
    if (selectedDate === dateStr) {
      setSelectedDate(null);
      setAnchorRect(null);
      setHoveredDate(null);
      return;
    }
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setSelectedDate(dateStr);
    setHoveredDate(null);
  };

  const handleClose = () => {
    setSelectedDate(null);
    setAnchorRect(null);
    setHoveredDate(null);
  };

  const closeTimeline = () => {
    setTimelineDate(null);
    setTimelineAnchorRect(null);
  };

  // Drop a dragged task onto a day cell — reschedule its date while preserving
  // any time component on the existing deadline.
  const handleDayDrop = (e: React.DragEvent, dateStr: string) => {
    const id = e.dataTransfer.getData(RT_TODO_DRAG_TYPE) || e.dataTransfer.getData("text/plain");
    setDragOverDate(null);
    if (!id) return;
    e.preventDefault();
    const todo = allTodos.find(t => t.id === id);
    if (!todo) return;
    let newDeadline = dateStr;
    if (todo.deadline && todo.deadline.includes("T")) {
      const time = todo.deadline.split("T")[1] ?? "09:00";
      newDeadline = `${dateStr}T${time}`;
    }
    if (newDeadline === todo.deadline) return;
    updateTodoLocal(id, { deadline: newDeadline });
    toast({
      title: "Task moved",
      description: `“${todo.text || "Untitled task"}” → ${format(parseISO(dateStr), "EEE d MMM")}`,
      duration: 2200,
    });
  };

  const handleDayDragOver = (e: React.DragEvent, dateStr: string) => {
    if (!e.dataTransfer.types.includes(RT_TODO_DRAG_TYPE) && !e.dataTransfer.types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverDate !== dateStr) setDragOverDate(dateStr);
  };

  const handleDayDragLeave = (dateStr: string) => {
    setDragOverDate(prev => (prev === dateStr ? null : prev));
  };

  // Get calendar days to show (full weeks)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Start on Monday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '10%' : '-10%',
      opacity: 0
    }),
    center: {
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      x: direction < 0 ? '10%' : '-10%',
      opacity: 0
    })
  };

  const today = new Date();
  const goToToday = () => {
    setDirection(currentMonth > today ? -1 : 1);
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  return (
    <div className="flex flex-col flex-1 h-[calc(100vh-3.5rem)] overflow-hidden p-4">
      <div className="flex-1 flex gap-4 min-h-0">
      <section className="flex-1 flex flex-col bg-card rounded-3xl shadow-sm border border-border/60 overflow-hidden min-h-0">
        {/* Calendar Header */}
        <div className="flex items-end justify-between px-7 pt-6 pb-4 shrink-0">
          <div className="flex items-end gap-3">
            <h2 className="text-[36px] font-bold leading-none tracking-tight text-foreground" style={{ letterSpacing: "-0.025em" }}>
              {format(currentMonth, "MMMM yyyy")}
            </h2>
            {syncing && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground pb-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Syncing…
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setQuranModalOpen(true)}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80 flex items-center gap-1.5"
              style={{
                background: quranPlan ? "hsl(199 89% 48% / 0.12)" : "hsl(var(--secondary) / 0.8)",
                color: quranPlan ? "hsl(199 89% 48%)" : "hsl(var(--muted-foreground))",
                border: quranPlan ? "1px solid hsl(199 89% 48% / 0.25)" : "1px solid transparent",
              }}
              title="Quran completion plan"
            >
              🌙 Khatm
            </button>
            <button
              onClick={goToToday}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80"
              style={{
                background: "hsl(var(--primary) / 0.12)",
                color: "hsl(var(--primary))",
              }}
            >
              Today
            </button>
            <button
              onClick={prevMonth}
              className="w-9 h-9 rounded-full grid place-items-center bg-secondary/60 border border-border/60 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={nextMonth}
              className="w-9 h-9 rounded-full grid place-items-center bg-secondary/60 border border-border/60 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Weekday Labels */}
        <div className="grid grid-cols-7 px-5 pb-2 shrink-0">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
            <div
              key={day}
              className="py-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.10em]"
              style={{
                color: i >= 5 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                opacity: i >= 5 ? 0.7 : 1,
              }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={currentMonth.toString()}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute inset-0 grid grid-cols-7 grid-rows-5 gap-1.5 px-5 pb-5"
            >
              {days.map((day, i) => {
                const dateStr = format(day, "yyyy-MM-dd");
                const isCurrentMonth = isSameMonth(day, monthStart);
                const isToday = isSameDay(day, new Date());
                const isWeekend = (i % 7) >= 5;
                const entry = data[dateStr];

                const hasBiology = !!entry?.subjects?.biology && (entry.subjects.biology.types.length > 0 || entry.subjects.biology.productivity > 0);
                const hasChemistry = !!entry?.subjects?.chemistry && (entry.subjects.chemistry.types.length > 0 || entry.subjects.chemistry.productivity > 0);
                const hasMaths = !!entry?.subjects?.maths && (entry.subjects.maths.types.length > 0 || entry.subjects.maths.productivity > 0);
                const examsOnDay = getExamsOnDate(dateStr);
                const eventsOnDay = allEvents.filter(ev => ev.date === dateStr);

                // Estimated study hours — shown only for the exam-season months
                // (Apr/May/Jun 2026) and only when work was actually logged.
                const inRecapMonth = day.getFullYear() === 2026 && [3, 4, 5].includes(day.getMonth());
                const estHours = inRecapMonth ? estimateDayHours(entry) : 0;
                // Round before deciding visibility so a tiny positive total never
                // renders as a "0h" badge (requirement: never show 0h).
                const roundedHours = Math.round(estHours * 2) / 2;
                const showHoursBadge = inRecapMonth && roundedHours > 0;

                const SUBJECT_VAR: Record<string, string> = {
                  biology:   "--biology",
                  chemistry: "--chemistry",
                  maths:     "--maths",
                };

                const isHovered = hoveredDate === dateStr;
                const baseBg = isToday
                  ? "hsl(var(--primary) / 0.18)"
                  : !isCurrentMonth
                  ? "transparent"
                  : isWeekend
                  ? "hsl(var(--secondary) / 0.6)"
                  : "hsl(var(--secondary) / 0.4)";
                const hoverBg = isToday
                  ? "hsl(var(--primary) / 0.32)"
                  : !isCurrentMonth
                  ? "hsl(var(--secondary) / 0.5)"
                  : isWeekend
                  ? "hsl(var(--secondary))"
                  : "hsl(var(--secondary) / 0.85)";

                const isDropOver = dragOverDate === dateStr;
                const cellStyle: React.CSSProperties = {
                  borderRadius: 14,
                  background: isDropOver
                    ? "hsl(var(--primary) / 0.18)"
                    : isHovered ? hoverBg : baseBg,
                  border: isDropOver
                    ? "1.5px dashed hsl(var(--primary))"
                    : isToday
                    ? "1.5px solid hsl(var(--primary))"
                    : isHovered
                    ? "1px solid hsl(var(--border))"
                    : "1px solid transparent",
                  opacity: isCurrentMonth ? 1 : isDropOver ? 1 : isHovered ? 0.7 : 0.45,
                  transition: "background-color 120ms ease, border-color 120ms ease, opacity 120ms ease",
                };

                return (
                  <button
                    key={day.toString()}
                    onClick={(e) => handleDayClick(e, dateStr)}
                    onMouseEnter={() => setHoveredDate(dateStr)}
                    onMouseLeave={() => setHoveredDate(prev => (prev === dateStr ? null : prev))}
                    onDragOver={(e) => handleDayDragOver(e, dateStr)}
                    onDragLeave={() => handleDayDragLeave(dateStr)}
                    onDrop={(e) => handleDayDrop(e, dateStr)}
                    className="relative flex flex-col items-stretch gap-1 p-2 text-left"
                    style={cellStyle}
                    data-testid={`day-cell-${dateStr}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-[12.5px] inline-flex shrink-0"
                        style={{
                          fontWeight: isToday ? 700 : 600,
                          color: isToday
                            ? "hsl(var(--primary))"
                            : !isCurrentMonth
                            ? "hsl(var(--muted-foreground))"
                            : "hsl(var(--foreground))",
                        }}
                      >
                        {format(day, "d")}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {isCurrentMonth && day >= todayStart && todoCountsByDate[dateStr] > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap leading-none"
                            style={{
                              background: "hsl(var(--apple-orange))",
                              color: "rgba(0,0,0,0.85)",
                            }}
                            title={`${todoCountsByDate[dateStr]} task${todoCountsByDate[dateStr] !== 1 ? "s" : ""} due`}
                            data-testid={`badge-tasks-due-${dateStr}`}
                          >
                            {todoCountsByDate[dateStr]} {todoCountsByDate[dateStr] === 1 ? "Task" : "Tasks"}
                          </span>
                        )}
                        {showHoursBadge && (
                          <span
                            className="px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap leading-none"
                            style={{
                              background: "hsl(var(--primary) / 0.14)",
                              color: "hsl(var(--primary))",
                            }}
                            title={`~${formatHours(roundedHours)} of work estimated from what you logged`}
                            data-testid={`badge-hours-${dateStr}`}
                          >
                            {formatHours(roundedHours)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Indicators */}
                    <div className="flex-1 w-full mt-1 flex flex-col gap-1 overflow-hidden">
                      {eventsOnDay.map(ev => (
                        <div
                          key={ev.id}
                          className="w-full text-left px-1.5 py-0.5 rounded-md font-semibold text-[10px] md:text-[10.5px] truncate"
                          style={{ background: `${ev.color === "indigo" ? "hsl(240 60% 58% / 0.15)" : ev.color === "rose" ? "hsl(350 75% 58% / 0.15)" : ev.color === "amber" ? "hsl(40 92% 52% / 0.15)" : `hsl(var(--${ev.color}) / 0.15)`}`, color: ev.color === "indigo" ? "hsl(240 60% 58%)" : ev.color === "rose" ? "hsl(350 75% 58%)" : ev.color === "amber" ? "hsl(40 92% 52%)" : `hsl(var(--${ev.color}))` }}
                          title={ev.title}
                        >
                          📌 {ev.title}
                        </div>
                      ))}

                      {examsOnDay.map(exam => (
                        <div
                          key={exam.label}
                          className="w-full text-left px-1.5 py-0.5 rounded-md font-semibold text-[10px] md:text-[10.5px] truncate"
                          style={{
                            background: `hsl(var(${SUBJECT_VAR[exam.subject]}) / 0.15)`,
                            color: `hsl(var(${SUBJECT_VAR[exam.subject]}))`,
                          }}
                          title={exam.label}
                        >
                          📝 {exam.shortLabel}
                        </div>
                      ))}

                      {hasBiology && (
                        <div
                          className="w-full text-left px-1.5 py-0.5 rounded-md text-[10px] md:text-[10.5px] font-semibold truncate"
                          style={{ background: "hsl(var(--biology) / 0.18)", color: "hsl(var(--biology))" }}
                        >
                          Biology
                        </div>
                      )}
                      {hasChemistry && (
                        <div
                          className="w-full text-left px-1.5 py-0.5 rounded-md text-[10px] md:text-[10.5px] font-semibold truncate"
                          style={{ background: "hsl(var(--chemistry) / 0.18)", color: "hsl(var(--chemistry))" }}
                        >
                          Chemistry
                        </div>
                      )}
                      {hasMaths && (
                        <div
                          className="w-full text-left px-1.5 py-0.5 rounded-md text-[10px] md:text-[10.5px] font-semibold truncate"
                          style={{ background: "hsl(var(--maths) / 0.18)", color: "hsl(var(--maths))" }}
                        >
                          Maths
                        </div>
                      )}

                      {!hasBiology && !hasChemistry && !hasMaths && !examsOnDay.length && entry?.notes && (
                        <div className="w-full text-left px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] md:text-[10.5px] truncate">
                          Notes…
                        </div>
                      )}

                      {/* Quran completion chip */}
                      {isCurrentMonth && quranPlan && (() => {
                        const isDone = quranPlan.completedDates.includes(dateStr);
                        const pages = !isDone ? getPagesForDate(quranPlan, dateStr) : 0;
                        if (isDone) {
                          return (
                            <div className="w-full text-left px-1.5 py-0.5 rounded-md text-[10px] md:text-[10.5px] font-semibold truncate" style={{ background: "hsl(199 89% 48% / 0.12)", color: "hsl(199 89% 48%)" }}>
                              📖 Done
                            </div>
                          );
                        }
                        if (pages > 0) {
                          return (
                            <div className="w-full text-left px-1.5 py-0.5 rounded-md text-[10px] md:text-[10.5px] font-semibold truncate" style={{ background: "hsl(199 89% 48% / 0.08)", color: "hsl(199 89% 42%)" }}>
                              📖 {pages}p
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <TodoPanel className="hidden lg:flex" />
      </div>

      <DayEntryModal
        date={selectedDate}
        anchorRect={anchorRect}
        existingEntry={selectedDate ? getDay(selectedDate) : undefined}
        allData={data}
        onClose={handleClose}
        onSave={handleSave}
      />

      <DayTimelineModal
        date={timelineDate}
        anchorRect={timelineAnchorRect}
        onClose={closeTimeline}
      />

      <QuranSetupModal open={quranModalOpen} onClose={() => setQuranModalOpen(false)} />
    </div>
  );
}
