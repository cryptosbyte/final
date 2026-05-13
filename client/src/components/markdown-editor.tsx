import { useState, useRef, useEffect, type ReactNode, type ImgHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import "katex/dist/katex.min.css";
import {
  Bold, Italic, Heading1, Heading2, List, ListOrdered, Link2, Image as ImageIcon,
  Eye, Pencil, Quote, Code, Minus, Youtube, Trash2, Lock, Sigma, Superscript, Subscript,
} from "lucide-react";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";

// KaTeX renders to a deep tree of spans (and a hidden MathML mirror). We allow
// every element it emits along with the className/style/aria attributes it
// relies on. Other tags remain restricted.
const KATEX_HTML_TAGS = ["span", "div"] as const;
const KATEX_MATHML_TAGS = [
  "math", "semantics", "annotation", "annotation-xml", "mrow", "mi", "mo", "mn",
  "ms", "mtext", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mspace",
  "mstyle", "mtable", "mtr", "mtd", "munder", "mover", "munderover", "mpadded",
  "mphantom", "menclose", "mglyph",
] as const;
const KATEX_ATTRS = ["className", "class", "style", "aria-hidden", "ariaHidden"];

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "iframe", "video", "source",
    ...KATEX_HTML_TAGS, ...KATEX_MATHML_TAGS,
  ],
  attributes: {
    ...defaultSchema.attributes,
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "title", "loading", "referrerpolicy"],
    video: ["src", "controls", "width", "height", "poster", "preload"],
    source: ["src", "type"],
    img: [...(defaultSchema.attributes?.img || []), "loading", "width", "height", "style"],
    a: [...(defaultSchema.attributes?.a || []), "target", "rel"],
    // Allow inline styles + classes on span/div so KaTeX's positioning works.
    span: [...(defaultSchema.attributes?.span || []), ...KATEX_ATTRS],
    div: [...(defaultSchema.attributes?.div || []), ...KATEX_ATTRS],
    sub: [...(defaultSchema.attributes?.sub || []), "className", "class"],
    sup: [...(defaultSchema.attributes?.sup || []), "className", "class"],
    // Permissive attrs for the MathML mirror tree so KaTeX accessibility works.
    ...Object.fromEntries(KATEX_MATHML_TAGS.map(t => [t, ["className", "class", "style", "mathvariant", "displaystyle", "scriptlevel", "encoding", "xmlns"]])),
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data"],
  },
};

const remarkPlugins = [remarkGfm, remarkMath] as const;
const rehypePluginsList = [rehypeRaw, rehypeKatex, [rehypeSanitize, sanitizeSchema]] as const;

/**
 * Animated placeholder shown when an embedded image cannot be loaded — most
 * commonly because the image is private but the surrounding notebook is
 * public. The look is intentionally calm and friendly: a soft slate panel,
 * a shimmering sweep, and a gently floating lock icon.
 */
function PrivateImagePlaceholder({ alt, width }: { alt?: string; width?: string | number }) {
  return (
    <span
      className="not-prose relative inline-flex flex-col items-center justify-center gap-2 my-3 rounded-xl border border-dashed border-border/70 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-6 py-8 overflow-hidden text-center"
      style={{ width: width ?? "100%", minHeight: 160, maxWidth: "100%" }}
      role="img"
      aria-label={alt ? `Private image: ${alt}` : "Private image"}
    >
      <span className="pointer-events-none absolute inset-0">
        <span className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/40 dark:via-white/10 to-transparent animate-[private-shimmer_2.4s_ease-in-out_infinite]" />
      </span>
      <span className="relative grid place-items-center w-12 h-12 rounded-full bg-white/70 dark:bg-slate-700/60 shadow-sm animate-[private-float_3s_ease-in-out_infinite]">
        <Lock className="w-5 h-5 text-slate-500 dark:text-slate-300" />
      </span>
      <span className="relative flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">Sorry — this image is private</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          The notebook owner hasn't shared this picture publicly{alt ? ` (${alt})` : ""}.
        </span>
      </span>
      <style>{`
        @keyframes private-shimmer {
          0% { transform: translateX(0); }
          100% { transform: translateX(450%); }
        }
        @keyframes private-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </span>
  );
}

function ImgWithFallback({ src, alt, width, style }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <PrivateImagePlaceholder alt={alt} width={typeof width === "number" ? `${width}px` : (width as string | undefined)} />;
  }
  return (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      width={width as number | string | undefined}
      style={style}
      onError={() => setFailed(true)}
      className="rounded-lg max-w-full h-auto"
    />
  );
}

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
  testId?: string;
  /** Hide toolbar entirely (useful for inline simple notes). */
  compact?: boolean;
  /** Optional async image-upload callback; returns the URL to insert. */
  onImageUpload?: (file: File) => Promise<string | null>;
  /**
   * Optional callback registration: the editor exposes an `insert(markdown)`
   * function so external UI (e.g. a photo-library picker) can insert content
   * at the current caret position.
   */
  registerInsert?: (insert: (markdown: string) => void) => void;
  /** Initial mode — defaults to "edit". Pass "preview" to open in read view. */
  defaultMode?: "edit" | "preview";
}

export function MarkdownPreview({ value, className }: { value: string; className?: string }) {
  const components: Components = {
    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    img: ({ node, ...props }) => <ImgWithFallback {...props} />,
  };
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:leading-relaxed prose-img:rounded-lg prose-a:text-[hsl(var(--primary))] prose-a:no-underline hover:prose-a:underline prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-[''] prose-iframe:rounded-lg ${className ?? ""}`}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePluginsList as never}
        components={components}
      >
        {value || "*Nothing yet — switch to Edit to start writing.*"}
      </ReactMarkdown>
    </div>
  );
}

interface ToolbarBtnProps {
  onClick: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
}
function ToolbarBtn({ onClick, title, children, testId }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testId}
      className="w-7 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    >
      {children}
    </button>
  );
}

function youtubeEmbedFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (u.hostname.endsWith("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" && parts[1]) return url;
    }
    if (u.hostname.endsWith("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {}
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Set the width attribute on every embedded image whose `src` matches `url`.
 * If the image is currently in markdown form (`![alt](url)`), it is converted
 * to an HTML `<img>` so the width can be expressed.
 *
 * Pass `widthPercent = null` to remove the image entirely.
 */
function setImageSizeInContent(content: string, url: string, widthPercent: number | null): string {
  const escUrl = escapeRegex(url);
  if (widthPercent === null) {
    // Remove HTML img and markdown img variants for this src.
    let next = content.replace(new RegExp(`\\s*<img[^>]*src=["']${escUrl}["'][^>]*\\/?>\\s*`, "g"), "\n");
    next = next.replace(new RegExp(`\\s*!\\[[^\\]]*\\]\\(${escUrl}\\)\\s*`, "g"), "\n");
    return next;
  }
  // Replace existing HTML <img src="url" ...>
  const htmlRe = new RegExp(`<img([^>]*?)src=(["'])${escUrl}\\2([^>]*?)\\/?>`, "g");
  let replaced = false;
  let next = content.replace(htmlRe, (_m, before: string, q: string, after: string) => {
    replaced = true;
    const cleanedBefore = before.replace(/\s+width=["'][^"']*["']/g, "").replace(/\s+style=["'][^"']*["']/g, "");
    const cleanedAfter = after.replace(/\s+width=["'][^"']*["']/g, "").replace(/\s+style=["'][^"']*["']/g, "");
    return `<img${cleanedBefore}src=${q}${url}${q}${cleanedAfter} width="${widthPercent}%" />`;
  });
  if (replaced) return next;
  // Convert markdown ![alt](url) → <img ... width=...>
  const mdRe = new RegExp(`!\\[([^\\]]*)\\]\\(${escUrl}\\)`, "g");
  next = next.replace(mdRe, (_m, alt: string) => `<img src="${url}" alt="${alt}" width="${widthPercent}%" />`);
  return next;
}

const SIZE_PRESETS: { label: string; value: number }[] = [
  { label: "S", value: 25 },
  { label: "M", value: 50 },
  { label: "L", value: 75 },
  { label: "Full", value: 100 },
];

function widthToPercent(width: string | number | undefined): number | null {
  if (width === undefined) return null;
  if (typeof width === "number") return width;
  const m = String(width).trim().match(/^(\d+(?:\.\d+)?)%$/);
  return m ? Math.round(parseFloat(m[1]!)) : null;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minRows = 6,
  testId,
  compact = false,
  onImageUpload,
  registerInsert,
  defaultMode = "edit",
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"edit" | "preview">(defaultMode);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the latest insertText in a ref so we can register it once on mount
  // without re-firing on every render (which previously caused
  // setState-during-render warnings in parents).
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => { valueRef.current = value; });
  useEffect(() => { onChangeRef.current = onChange; });

  useEffect(() => {
    if (!registerInsert) return;
    registerInsert((text: string) => {
      const ta = taRef.current;
      const cur = valueRef.current;
      if (!ta) {
        onChangeRef.current(cur + text);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = cur.slice(0, start) + text + cur.slice(end);
      onChangeRef.current(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + text.length;
        ta.setSelectionRange(pos, pos);
      });
    });
  }, [registerInsert]);

  const wrapSelection = (before: string, after: string = before, placeholderText = "") => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const cursorStart = start + before.length;
      ta.setSelectionRange(cursorStart, cursorStart + selected.length);
    });
  };

  const insertAtLineStart = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const insertText = (text: string) => {
    const ta = taRef.current;
    if (!ta) {
      onChange(value + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleLink = () => {
    const url = window.prompt("Link URL");
    if (!url) return;
    wrapSelection("[", `](${url})`, "link text");
  };

  const handleImageUrl = () => {
    const url = window.prompt("Image URL");
    if (!url) return;
    insertText(`\n<img src="${url}" alt="" width="100%" />\n`);
  };

  const handleEmbed = () => {
    const url = window.prompt("YouTube or Vimeo URL");
    if (!url) return;
    const embed = youtubeEmbedFromUrl(url);
    if (!embed) {
      insertText(`\n[${url}](${url})\n`);
      return;
    }
    insertText(
      `\n<iframe src="${embed}" width="100%" height="360" frameborder="0" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>\n`,
    );
  };

  const handleFile = async (file: File) => {
    if (!onImageUpload) return;
    const url = await onImageUpload(file);
    if (!url) return;
    insertText(`\n<img src="${url}" alt="${file.name.replace(/"/g, "")}" width="100%" />\n`);
  };

  // ----- Editable preview: images get an overlay with resize/remove controls.
  const editableComponents: Components = {
    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    img: ({ node, src, alt, width, style }) => {
      const currentPercent = widthToPercent(width as string | number | undefined);
      const wrapperStyle: React.CSSProperties = {
        width: width !== undefined ? (typeof width === "number" ? `${width}px` : (width as string)) : "100%",
        maxWidth: "100%",
      };
      return (
        <span className="not-prose relative inline-block group my-3 align-middle" style={wrapperStyle}>
          <ImgWithFallback src={src} alt={alt} width="100%" style={style} />
          {src && (
            <span className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <span className="flex items-center gap-0.5 bg-black/70 backdrop-blur-sm rounded-full p-0.5 text-white text-[10px] font-bold shadow-lg">
                {SIZE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => onChange(setImageSizeInContent(value, src, p.value))}
                    title={`${p.value}% width`}
                    className={`px-2 py-1 rounded-full transition-all ${
                      currentPercent === p.value
                        ? "bg-white text-black scale-105"
                        : "hover:bg-white/20"
                    }`}
                    data-testid={`img-size-${p.value}`}
                  >
                    {p.label}
                  </button>
                ))}
              </span>
              <button
                type="button"
                onClick={() => onChange(setImageSizeInContent(value, src, null))}
                title="Remove image"
                className="grid place-items-center w-7 h-7 rounded-full bg-rose-500/90 hover:bg-rose-500 text-white shadow-lg transition-colors"
                data-testid="img-remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          {currentPercent !== null && (
            <span className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {currentPercent}%
            </span>
          )}
        </span>
      );
    },
  };

  return (
    <div className="rounded-xl border border-border/60 bg-background overflow-hidden" data-testid={testId}>
      {!compact && (
        <div className="flex items-center gap-1 px-1.5 py-1 border-b border-border/60 bg-secondary/30">
          <ToolbarBtn onClick={() => wrapSelection("**", "**", "bold")} title="Bold (Ctrl+B)" testId="md-bold"><Bold className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => wrapSelection("_", "_", "italic")} title="Italic (Ctrl+I)" testId="md-italic"><Italic className="w-3.5 h-3.5" /></ToolbarBtn>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <ToolbarBtn onClick={() => insertAtLineStart("# ")} title="Heading 1" testId="md-h1"><Heading1 className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => insertAtLineStart("## ")} title="Heading 2" testId="md-h2"><Heading2 className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => insertAtLineStart("> ")} title="Quote" testId="md-quote"><Quote className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => insertAtLineStart("- ")} title="Bullet list" testId="md-ul"><List className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => insertAtLineStart("1. ")} title="Numbered list" testId="md-ol"><ListOrdered className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => wrapSelection("`", "`", "code")} title="Inline code" testId="md-code"><Code className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn onClick={() => insertText("\n\n---\n\n")} title="Horizontal rule" testId="md-hr"><Minus className="w-3.5 h-3.5" /></ToolbarBtn>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <ToolbarBtn
            onClick={() => wrapSelection("$", "$", "x^2")}
            title="Inline math (LaTeX) — wrap with $...$"
            testId="md-math-inline"
          ><Sigma className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn
            onClick={() => insertText("\n$$\n\\int_0^1 f(x)\\,dx\n$$\n")}
            title="Block math (LaTeX) — $$...$$"
            testId="md-math-block"
          ><span className="font-bold text-[10px] tracking-tight">∑∫</span></ToolbarBtn>
          <ToolbarBtn
            onClick={() => wrapSelection("<sup>", "</sup>", "2")}
            title="Superscript"
            testId="md-sup"
          ><Superscript className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn
            onClick={() => wrapSelection("<sub>", "</sub>", "2")}
            title="Subscript"
            testId="md-sub"
          ><Subscript className="w-3.5 h-3.5" /></ToolbarBtn>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <ToolbarBtn onClick={handleLink} title="Insert link" testId="md-link"><Link2 className="w-3.5 h-3.5" /></ToolbarBtn>
          <ToolbarBtn
            onClick={() => (onImageUpload ? fileRef.current?.click() : handleImageUrl())}
            title={onImageUpload ? "Upload image" : "Image by URL"}
            testId="md-image"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn onClick={handleEmbed} title="Embed YouTube / Vimeo" testId="md-embed"><Youtube className="w-3.5 h-3.5" /></ToolbarBtn>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (f) await handleFile(f);
              e.target.value = "";
            }}
          />
          <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-md bg-secondary/60">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded transition-colors ${mode === "edit" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="md-mode-edit"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded transition-colors ${mode === "preview" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="md-mode-preview"
            >
              <Eye className="w-3 h-3" /> Preview
            </button>
          </div>
        </div>
      )}
      {mode === "edit" ? (
        <AutoResizeTextarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          minRows={minRows}
          className="border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-3 py-2 text-sm leading-relaxed font-mono"
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
              e.preventDefault();
              wrapSelection("**", "**", "bold");
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
              e.preventDefault();
              wrapSelection("_", "_", "italic");
            }
          }}
          data-testid={testId ? `${testId}-textarea` : undefined}
        />
      ) : (
        <div className="px-3 py-3 min-h-[8rem]">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:leading-relaxed prose-a:text-[hsl(var(--primary))] prose-a:no-underline hover:prose-a:underline prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-[''] prose-iframe:rounded-lg">
            <ReactMarkdown
              remarkPlugins={remarkPlugins as never}
              rehypePlugins={rehypePluginsList as never}
              components={editableComponents}
            >
              {value || "*Nothing yet — switch to Edit to start writing.*"}
            </ReactMarkdown>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Hover any image to resize (S · M · L · Full) or remove it.
          </p>
        </div>
      )}
    </div>
  );
}
