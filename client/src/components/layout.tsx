import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  CalendarDays, BarChart2, LogIn, LogOut, User, Images,
  Sparkles, Sun, Moon, Bookmark, BookOpen, Layers,
} from "lucide-react";
import { useAuthContext } from "@/lib/auth-context";
import { useTodoSync } from "@/hooks/use-todo-sync";
import { useBookmarksSync } from "@/hooks/use-bookmarks-sync";
import { useDeviceSync } from "@/hooks/use-device-sync";
import { getDeviceId, getDeviceLabel } from "@/lib/device-sync";
import { DailyQuote } from "@/components/daily-quote";
import { AchievementOverlay } from "@/components/achievement-overlay";
import { Cloud, CloudOff } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

const THEME_KEY = "revision_tracker_theme";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return { theme, toggle: () => setTheme(t => (t === "dark" ? "light" : "dark")) };
}

export function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const { user, isLoading, login, logout } = useAuthContext();
  const { theme, toggle } = useTheme();
  const isMobile = useIsMobile();

  // On mobile, the calendar/stats UI is too dense to be usable. Send mobile
  // visitors straight to the flashcard list — that's the only screen designed
  // to be reviewed on the go (and the study screen forces landscape).
  useEffect(() => {
    if (isMobile && location === "/") {
      setLocation("/flashcards", { replace: true });
    }
  }, [isMobile, location, setLocation]);

  const { state: syncState } = useDeviceSync(user);
  useTodoSync(user);
  useBookmarksSync(user);

  const myDeviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const myDeviceLabel = typeof window !== "undefined" ? getDeviceLabel() : "";
  const isDominant = !!user && syncState?.dominantDeviceId === myDeviceId;
  const someoneElseDominant =
    !!user && !!syncState?.dominantDeviceId && syncState.dominantDeviceId !== myDeviceId;

  const navItems = [
    { href: "/",         label: "Calendar", icon: CalendarDays, match: (l: string) => l === "/" },
    { href: "/stats",    label: "Stats",    icon: BarChart2,    match: (l: string) => l === "/stats" },
    { href: "/photos",   label: "Photos",   icon: Images,       match: (l: string) => l.startsWith("/photos"), testId: "link-photos" },
    { href: "/bookmarks", label: "Bookmarks", icon: Bookmark,    match: (l: string) => l === "/bookmarks", testId: "link-bookmarks" },
    { href: "/resources", label: "Resources", icon: BookOpen,    match: (l: string) => l.startsWith("/resources"), testId: "link-resources" },
    { href: "/flashcards", label: "Flashcards", icon: Layers,     match: (l: string) => l.startsWith("/flashcards"), testId: "link-flashcards" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="h-14 flex items-center gap-2 px-3 sm:px-5 justify-between bg-card/80 backdrop-blur-md border-b border-border/60 shrink-0 sticky top-0 z-30">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div
            className="w-7 h-7 rounded-[8px] grid place-items-center shadow-sm group-hover:shadow transition-shadow"
            style={{
              background: "linear-gradient(135deg, hsl(var(--maths)), color-mix(in srgb, hsl(var(--maths)) 60%, white))",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-bold tracking-tight">Revision</div>
            <div className="text-[10px] text-muted-foreground">A-Level · 2026</div>
          </div>
        </Link>

        <div className="ml-3 mr-auto pl-3 border-l border-border/40 hidden 2xl:block">
          <DailyQuote />
        </div>

        {/* Pill nav. Labels collapse on tablet (lg only) so the bar fits an
            iPad 10.9" landscape (~1180px) without horizontal scrolling. */}
        <nav className="flex items-center gap-0.5 p-1 rounded-full bg-secondary/60 border border-border/60 mx-auto xl:mx-0">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = item.match(location);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                title={item.label}
                aria-label={item.label}
                className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-all duration-200 hover:scale-105 active:scale-95 ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-2">
          {user && (
            <div
              title={
                isDominant
                  ? `${myDeviceLabel} is your main device — its data syncs to all others.`
                  : someoneElseDominant
                    ? `Main device: ${syncState?.dominantDeviceLabel ?? "another device"}. Press ⌘E to make ${myDeviceLabel} the main device.`
                    : `No main device set yet. Press ⌘E on ${myDeviceLabel} to make it the source of truth.`
              }
              className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                isDominant
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30"
                  : someoneElseDominant
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/30"
                    : "bg-secondary/60 text-muted-foreground border-border/60"
              }`}
              data-testid="device-sync-badge"
            >
              {someoneElseDominant ? <CloudOff className="w-3 h-3" /> : <Cloud className="w-3 h-3" />}
              <span className="hidden xl:inline">
                {isDominant ? "Main device" : someoneElseDominant ? `${syncState?.dominantDeviceLabel ?? "Other"} is main` : "⌘E to set main"}
              </span>
            </div>
          )}
          <button
            onClick={toggle}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            data-testid="button-theme-toggle"
            className="w-9 h-9 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200 hover:scale-110 hover:rotate-12 active:scale-95"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {!isLoading && (user ? (
            <div className="flex items-center gap-2">
              {user.profileImageUrl ? (
                <img
                  src={user.profileImageUrl}
                  alt={user.firstName ?? "User"}
                  className="w-8 h-8 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center ring-1 ring-border">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <button
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Sign out</span>
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
          ))}
        </div>
      </header>
      <main className="flex-1 flex flex-col relative">
        {children}
      </main>
      <AchievementOverlay />
    </div>
  );
}
