import { useState } from "react";
import { Lock, Globe, Link as LinkIcon, Check } from "lucide-react";

interface PrivacyToggleProps {
  isPublic: boolean;
  onToggle: () => void | Promise<void>;
  /** Optional copy-link callback shown only when public. */
  onCopyLink?: () => void | Promise<void>;
  /** "compact" = small icon button only (for cards); "full" = pill with label. */
  variant?: "compact" | "full";
  testIdSuffix?: string;
  /** Optional label override for the "full" variant. */
  label?: string;
}

/**
 * Animated public/private indicator. Tap to flip — icon rotates and the
 * background fades between a calm slate (private) and a confident emerald
 * (public) so the active state is unmistakable. The copy-link affordance only
 * appears when the item is currently public.
 */
export function PrivacyToggle({
  isPublic,
  onToggle,
  onCopyLink,
  variant = "compact",
  testIdSuffix,
  label,
}: PrivacyToggleProps) {
  const [pulse, setPulse] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPulse(true);
    setTimeout(() => setPulse(false), 600);
    await onToggle();
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onCopyLink) return;
    await onCopyLink();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (variant === "full") {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleToggle}
          aria-pressed={isPublic}
          aria-label={isPublic ? "Set to private" : "Set to public"}
          title={isPublic ? "Public — click to make private" : "Private — click to make public"}
          data-testid={testIdSuffix ? `privacy-toggle-${testIdSuffix}` : undefined}
          className={`relative flex items-center gap-1.5 text-xs font-semibold pl-2.5 pr-3 py-1.5 rounded-full overflow-hidden transition-all duration-300 ${
            isPublic
              ? "bg-emerald-500/95 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          <span
            className={`relative grid place-items-center w-4 h-4 transition-transform duration-300 ${
              pulse ? "scale-125 rotate-12" : "scale-100 rotate-0"
            }`}
          >
            <Lock
              className={`absolute w-3.5 h-3.5 transition-all duration-300 ${
                isPublic ? "opacity-0 scale-50 -rotate-90" : "opacity-100 scale-100 rotate-0"
              }`}
            />
            <Globe
              className={`absolute w-3.5 h-3.5 transition-all duration-300 ${
                isPublic ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"
              }`}
            />
          </span>
          <span className="transition-opacity duration-300">{label ?? (isPublic ? "Public" : "Private")}</span>
          {pulse && isPublic && (
            <span className="pointer-events-none absolute inset-0 rounded-full bg-white/40 animate-ping" />
          )}
        </button>
        {isPublic && onCopyLink && (
          <button
            onClick={handleCopy}
            title="Copy public CDN link"
            aria-label="Copy public CDN link"
            data-testid={testIdSuffix ? `copy-link-${testIdSuffix}` : undefined}
            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-secondary hover:bg-secondary/80 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <LinkIcon className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
      </div>
    );
  }

  // compact variant — for the photo card row.
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={handleToggle}
        aria-pressed={isPublic}
        aria-label={isPublic ? "Set to private" : "Set to public"}
        title={isPublic ? "Public — click to make private" : "Private — click to make public"}
        data-testid={testIdSuffix ? `privacy-toggle-${testIdSuffix}` : undefined}
        className={`relative grid place-items-center w-6 h-6 rounded-full overflow-hidden transition-all duration-300 ${
          isPublic
            ? "bg-emerald-500 text-white shadow-[0_0_0_2px_rgba(16,185,129,0.25)]"
            : "bg-secondary text-muted-foreground hover:text-foreground"
        } ${pulse ? "scale-110" : "scale-100"}`}
      >
        <Lock
          className={`absolute w-3 h-3 transition-all duration-300 ${
            isPublic ? "opacity-0 scale-50 -rotate-90" : "opacity-100 scale-100 rotate-0"
          }`}
        />
        <Globe
          className={`absolute w-3 h-3 transition-all duration-300 ${
            isPublic ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"
          }`}
        />
        {pulse && isPublic && (
          <span className="pointer-events-none absolute inset-0 rounded-full bg-white/50 animate-ping" />
        )}
      </button>
      {isPublic && onCopyLink && (
        <button
          onClick={handleCopy}
          title="Copy public CDN link"
          aria-label="Copy public CDN link"
          data-testid={testIdSuffix ? `copy-link-${testIdSuffix}` : undefined}
          className="grid place-items-center w-6 h-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <LinkIcon className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}
