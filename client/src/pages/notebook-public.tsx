import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { format, parseISO } from "date-fns";
import { BookOpen, Globe, ArrowLeft } from "lucide-react";
import { MarkdownPreview } from "@/components/markdown-editor";

type Tag = "maths" | "biology" | "chemistry" | "miscellaneous";
type Color = "blue" | "green" | "red" | "amber" | "purple" | "pink" | "teal" | "slate" | "orange" | "indigo";

interface PublicNotebook {
  id: string;
  title: string;
  tag: Tag;
  color: Color;
  content: string;
  isPublic: boolean;
  updatedAt: string;
}

const TAG_LABELS: Record<Tag, string> = { maths: "Maths", biology: "Biology", chemistry: "Chemistry", miscellaneous: "Misc" };
const TAG_DOT: Record<Tag, string> = {
  maths: "hsl(var(--maths))",
  biology: "hsl(var(--biology))",
  chemistry: "hsl(var(--chemistry))",
  miscellaneous: "hsl(var(--muted-foreground))",
};
const COLOR_BG: Record<Color, string> = {
  blue: "from-blue-400 to-blue-600",
  green: "from-emerald-400 to-emerald-600",
  red: "from-rose-400 to-rose-600",
  amber: "from-amber-300 to-amber-500",
  purple: "from-purple-400 to-purple-600",
  pink: "from-pink-400 to-pink-600",
  teal: "from-teal-400 to-teal-600",
  slate: "from-slate-400 to-slate-600",
  orange: "from-orange-400 to-orange-600",
  indigo: "from-indigo-400 to-indigo-600",
};

export default function NotebookPublicPage() {
  const [, params] = useRoute("/r/:id");
  const id = params?.id;
  const [notebook, setNotebook] = useState<PublicNotebook | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/notebooks/public/${id}`);
        if (!res.ok) {
          setStatus("missing");
          return;
        }
        const data = (await res.json()) as PublicNotebook;
        setNotebook(data);
        setStatus("ok");
      } catch {
        setStatus("missing");
      }
    })();
  }, [id]);

  if (status === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "missing" || !notebook) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/60 mb-3" />
          <h1 className="text-xl font-bold mb-2">Notebook unavailable</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This notebook is private or the link is no longer valid.
          </p>
          <Link href="/" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back home
          </Link>
        </div>
      </div>
    );
  }

  const grad = COLOR_BG[notebook.color] ?? COLOR_BG.blue;

  return (
    <div className="flex-1">
      {/* Hero */}
      <div className={`bg-gradient-to-br ${grad} text-white px-6 py-10 sm:py-14`}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-90 mb-3">
            <Globe className="w-3.5 h-3.5" />
            <span>Public notebook</span>
            <span className="opacity-60">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: TAG_DOT[notebook.tag] }} />
              {TAG_LABELS[notebook.tag]}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight drop-shadow-sm">{notebook.title}</h1>
          <p className="text-xs opacity-80 mt-3">Last updated {format(parseISO(notebook.updatedAt), "d MMMM yyyy 'at' HH:mm")}</p>
        </div>
      </div>
      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <article className="bg-card rounded-2xl border border-border/60 shadow-sm p-6 sm:p-10">
          <MarkdownPreview value={notebook.content} />
        </article>
        <p className="text-[11px] text-center text-muted-foreground mt-6">
          Shared from a Revision Tracker notebook.
        </p>
      </div>
    </div>
  );
}
