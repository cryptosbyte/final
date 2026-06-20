import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  RefreshCw,
  Reply,
  Send,
  ArrowLeft,
  Loader2,
  Inbox,
  LinkIcon,
} from "lucide-react";
import { useAuthContext } from "@/lib/auth-context";
import { isOwner } from "@/lib/owner";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";

interface MessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

interface MessageDetail extends MessageSummary {
  messageId: string;
  references: string;
  html: string;
  text: string;
}

interface EmailStatus {
  connected: boolean;
  email: string | null;
  contactAddress: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    const error = new Error(
      (payload as { error?: string })?.error || `Request failed (${res.status})`,
    ) as Error & { status?: number; code?: string };
    error.status = res.status;
    error.code = (payload as { error?: string })?.error;
    throw error;
  }
  return res.json() as Promise<T>;
}

function formatDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function senderName(from: string): string {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (match ? match[1] : from).trim() || from;
}

export default function EmailPage() {
  const { user, isLoading } = useAuthContext();
  const { toast } = useToast();

  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  const owner = isOwner(user?.id);

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    try {
      const data = await jsonFetch<{ messages: MessageSummary[] }>(
        "/api/email/messages",
      );
      setMessages(data.messages);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "gmail_not_connected") {
        setStatus((s) => (s ? { ...s, connected: false } : s));
      } else {
        toast({ title: "Couldn't load emails", description: e.message, variant: "destructive" });
      }
    } finally {
      setLoadingMessages(false);
    }
  }, [toast]);

  const loadStatus = useCallback(async () => {
    try {
      const s = await jsonFetch<EmailStatus>("/api/email/status");
      setStatus(s);
      if (s.connected) await loadMessages();
    } catch (err) {
      toast({
        title: "Couldn't load email status",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }, [toast, loadMessages]);

  // Handle the Google OAuth redirect (?code=...&state=...) and otherwise load status.
  useEffect(() => {
    if (!owner) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state) {
      setExchanging(true);
      jsonFetch<{ connected: boolean; email: string | null }>(
        "/api/email/oauth/exchange",
        { method: "POST", body: JSON.stringify({ code, state }) },
      )
        .then(() => {
          window.history.replaceState({}, "", "/email");
          toast({ title: "Gmail connected" });
          return loadStatus();
        })
        .catch((err) => {
          window.history.replaceState({}, "", "/email");
          toast({
            title: "Gmail connection failed",
            description: (err as Error).message,
            variant: "destructive",
          });
        })
        .finally(() => setExchanging(false));
    } else {
      void loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const connectGmail = async () => {
    setConnecting(true);
    try {
      const { url } = await jsonFetch<{ url: string }>("/api/email/auth-url");
      window.location.href = url;
    } catch (err) {
      toast({
        title: "Couldn't start Gmail connection",
        description: (err as Error).message,
        variant: "destructive",
      });
      setConnecting(false);
    }
  };

  const openMessage = async (id: string) => {
    setLoadingDetail(true);
    setReplyOpen(false);
    setReplyBody("");
    try {
      const data = await jsonFetch<{ message: MessageDetail }>(
        `/api/email/messages/${id}`,
      );
      setSelected(data.message);
    } catch (err) {
      toast({
        title: "Couldn't open email",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !replyBody.trim()) return;
    setSending(true);
    try {
      const subject = selected.subject.toLowerCase().startsWith("re:")
        ? selected.subject
        : `Re: ${selected.subject}`;
      await jsonFetch("/api/email/reply", {
        method: "POST",
        body: JSON.stringify({
          to: selected.from,
          subject,
          text: replyBody,
          inReplyTo: selected.messageId,
          references: selected.references
            ? `${selected.references} ${selected.messageId}`
            : selected.messageId,
        }),
      });
      toast({ title: "Reply sent" });
      setReplyOpen(false);
      setReplyBody("");
    } catch (err) {
      toast({
        title: "Couldn't send reply",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!owner) return <NotFound />;

  const contactAddress = status?.contactAddress ?? "contact@zakir.today";

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-3 sm:px-5 py-4 gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl grid place-items-center bg-primary/10 text-primary">
            <Mail className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <h1 className="text-lg font-bold tracking-tight">Inbox</h1>
            <p className="text-xs text-muted-foreground">{contactAddress}</p>
          </div>
        </div>
        {status?.connected && (
          <button
            onClick={loadMessages}
            disabled={loadingMessages}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-secondary hover:bg-secondary/70 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMessages ? "animate-spin" : ""}`} />
            Refresh
          </button>
        )}
      </div>

      {exchanging && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting Gmail…
        </div>
      )}

      {status && !status.connected && !exchanging && (
        <div className="flex-1 grid place-items-center">
          <div className="max-w-sm text-center flex flex-col items-center gap-4 py-12">
            <div className="w-14 h-14 rounded-2xl grid place-items-center bg-primary/10 text-primary">
              <LinkIcon className="w-7 h-7" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Connect your Gmail</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Sign in with the Gmail account that receives mail forwarded to{" "}
                <span className="font-medium text-foreground">{contactAddress}</span>{" "}
                so this inbox can read those messages.
              </p>
            </div>
            <button
              onClick={connectGmail}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
              Connect Gmail
            </button>
          </div>
        </div>
      )}

      {status?.connected && (
        <div className="flex-1 grid md:grid-cols-[minmax(0,360px)_1fr] gap-4 min-h-0">
          {/* Message list */}
          <div
            className={`rounded-2xl border border-border/60 bg-card/50 overflow-hidden flex flex-col ${
              selected ? "hidden md:flex" : "flex"
            }`}
          >
            <div className="flex-1 overflow-y-auto divide-y divide-border/40">
              {loadingMessages && messages.length === 0 ? (
                <div className="p-8 grid place-items-center">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                  <Inbox className="w-6 h-6" />
                  No emails to {contactAddress} yet.
                </div>
              ) : (
                messages.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => openMessage(m.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors ${
                      selected?.id === m.id ? "bg-secondary/60" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm truncate ${
                          m.unread ? "font-bold" : "font-medium"
                        }`}
                      >
                        {senderName(m.from)}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {formatDate(m.date)}
                      </span>
                    </div>
                    <div className="text-[13px] font-medium truncate mt-0.5">
                      {m.subject}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {m.snippet}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Reader */}
          <div
            className={`rounded-2xl border border-border/60 bg-card/50 overflow-hidden flex-col min-h-0 ${
              selected ? "flex" : "hidden md:flex"
            }`}
          >
            {loadingDetail ? (
              <div className="flex-1 grid place-items-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : !selected ? (
              <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                Select an email to read it.
              </div>
            ) : (
              <>
                <div className="px-5 py-4 border-b border-border/50">
                  <button
                    onClick={() => setSelected(null)}
                    className="md:hidden flex items-center gap-1 text-xs text-muted-foreground mb-2"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>
                  <h2 className="font-bold text-base">{selected.subject}</h2>
                  <div className="text-sm mt-1">
                    <span className="font-medium">{senderName(selected.from)}</span>{" "}
                    <span className="text-muted-foreground">{selected.from.replace(/^[^<]*</, "<")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(selected.date)}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {selected.html ? (
                    <iframe
                      title="email-body"
                      sandbox=""
                      className="w-full min-h-[320px] bg-white rounded-lg"
                      srcDoc={selected.html}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {selected.text || selected.snippet}
                    </pre>
                  )}
                </div>

                <div className="border-t border-border/50 p-4">
                  {!replyOpen ? (
                    <button
                      onClick={() => setReplyOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                    >
                      <Reply className="w-4 h-4" /> Reply
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="text-xs text-muted-foreground">
                        Replying to {senderName(selected.from)} · from {contactAddress}
                      </div>
                      <textarea
                        autoFocus
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        rows={5}
                        placeholder="Write your reply…"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={sendReply}
                          disabled={sending || !replyBody.trim()}
                          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {sending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Send
                        </button>
                        <button
                          onClick={() => {
                            setReplyOpen(false);
                            setReplyBody("");
                          }}
                          className="px-4 py-2 rounded-full text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
