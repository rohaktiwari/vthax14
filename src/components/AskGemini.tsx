import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useChat, useChatStatus } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import type { ChatMessage } from "../api/types";
import { useCenterView } from "../context/CenterViewContext";
import { useMapSelection } from "../context/MapSelectionContext";
import { useProfessorDrawer } from "../context/ProfessorDrawerContext";
import { useSchedule } from "../context/ScheduleContext";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const MAX_MESSAGE_CHARS = 500;
const MAX_USER_TURNS = 4;
const SHOW_COUNTER_AT = 400;

const STARTERS_WITH_SCHEDULE = [
  "Why is my schedule risky?",
  "Which walk between classes is tightest?",
  "Is there a better section for one of my classes?",
  "How do I use this planner?",
] as const;
const STARTERS_WITHOUT_SCHEDULE = ["How do I use this planner?"] as const;

export const GEMINI_STARTERS = STARTERS_WITH_SCHEDULE;

interface VisibleMessage {
  role: "user" | "assistant";
  content: string;
  notice?: string | null;
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 13.8 8.2 19.5 10 13.8 11.8 12 17.5 10.2 11.8 4.5 10 10.2 8.2Z" />
      <path d="M18.2 14.2 19 16.6 21.4 17.4 19 18.2 18.2 20.6 17.4 18.2 15 17.4 17.4 16.6Z" />
    </svg>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start" role="status" aria-label="Gemini is reading your schedule">
      <div className="w-4/5 animate-pulse space-y-2 rounded-2xl border border-line bg-warm px-3.5 py-3" aria-hidden="true">
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-5/6 rounded bg-line" />
        <div className="h-3 w-1/2 rounded bg-line" />
      </div>
    </div>
  );
}

/**
 * Ask Gemini chat. The browser never sees GEMINI_API_KEY; every model call goes
 * through POST /api/chat, and the server grounds the answer in this schedule.
 * The planner keeps working if chat is off, rate limited, or out of quota.
 */
export default function AskGemini() {
  const { crns } = useSchedule();
  const { highlightedBuilding, highlightedCrns } = useMapSelection();
  const { focusedCrn } = useCenterView();
  const { openTarget } = useProfessorDrawer();
  const chat = useChat();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const status = useChatStatus(open);
  const enabled = status.data?.enabled === true;

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const userTurns = messages.filter((item) => item.role === "user").length;
  const threadFull = userTurns >= MAX_USER_TURNS;
  const busy = chat.isPending;
  const starters = crns.length >= 2 ? STARTERS_WITH_SCHEDULE : STARTERS_WITHOUT_SCHEDULE;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy, error]);

  function resetThread() {
    setMessages([]);
    setDraft("");
    setError(null);
    setLastQuestion(null);
    chat.reset();
    inputRef.current?.focus();
  }

  async function send(text: string, { retry = false }: { retry?: boolean } = {}) {
    const content = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content || busy || (threadFull && !retry)) return;
    setError(null);
    setLastQuestion(content);
    const base = retry ? messages : [...messages, { role: "user" as const, content }];
    const history: ChatMessage[] = base.map((item) => ({ role: item.role, content: item.content }));
    if (!retry) {
      setMessages(base);
      setDraft("");
    }
    try {
      const payload = await chat.mutateAsync({
        messages: history,
        crns,
        focus: {
          building: highlightedBuilding,
          crn: focusedCrn ?? highlightedCrns[0] ?? crns[0] ?? null,
          professor: openTarget?.displayName ?? null,
        },
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", content: payload.reply, notice: payload.notice },
      ]);
    } catch (raw) {
      setError(normalizeApiError(raw).message);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function handleComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Ask Gemini"
          className="absolute right-0 top-full z-50 mt-3 flex h-[min(34rem,calc(100dvh-6rem))] w-[24rem] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-line bg-soft-maroon px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon text-white">
              <SparkleIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-ink-primary">Ask Gemini</p>
              <p className="text-xs text-ink-secondary">
                {enabled
                  ? "Answers use your current courses."
                  : "Gemini is off here. Answers come from HokieLens's own analysis."}
              </p>
            </div>
            <button
              type="button"
              onClick={resetThread}
              className="rounded-md px-2 py-1 text-xs font-semibold text-maroon hover:bg-panel"
            >
              New chat
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Ask Gemini"
              className="rounded-md p-1.5 text-ink-secondary hover:bg-panel hover:text-ink-primary"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 hl-scroll">
            {messages.length === 0 ? (
              <div>
                <p className="text-sm text-ink-primary">
                  Ask about your week: why it is risky, which walk is tight, or another section of a
                  class you picked.
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {starters.map((prompt) => (
                    <li key={prompt}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void send(prompt)}
                        className="rounded-full border border-line bg-warm px-3 py-1.5 text-left text-sm text-ink-primary transition-colors hover:border-maroon/40 hover:bg-soft-maroon disabled:opacity-60"
                      >
                        {prompt}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              messages.map((item, index) => (
                <div
                  key={`${item.role}-${index}`}
                  className={item.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                      item.role === "user"
                        ? "bg-maroon text-white"
                        : "border border-line bg-warm text-ink-primary"
                    }`}
                  >
                    <p className="whitespace-pre-line">{item.content}</p>
                    {item.role === "assistant" && item.notice ? (
                      <p className="mt-1.5 border-t border-line pt-1.5 text-xs text-ink-secondary">
                        {item.notice}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {busy ? <ThinkingBubble /> : null}
            {error ? (
              <div role="alert" className="rounded-xl border border-danger/40 bg-panel p-3 text-sm">
                <p className="text-danger">{error}</p>
                <p className="mt-1 text-xs text-ink-secondary">The rest of the planner still works.</p>
                {lastQuestion ? (
                  <button
                    type="button"
                    onClick={() => void send(lastQuestion, { retry: true })}
                    className="mt-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-primary hover:bg-soft-maroon"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-line p-3">
            <label htmlFor="ask-gemini-input" className="sr-only">
              Message Ask Gemini
            </label>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                id="ask-gemini-input"
                rows={2}
                maxLength={MAX_MESSAGE_CHARS}
                value={draft}
                disabled={busy || threadFull}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKey}
                placeholder={threadFull ? "Start a new chat to keep going." : "Ask about your schedule…"}
                className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-warm px-3 py-2 text-sm text-ink-primary placeholder:text-ink-secondary disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={busy || threadFull || draft.trim().length === 0}
                className="rounded-xl bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-maroon-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {draft.length >= SHOW_COUNTER_AT ? (
              <p className="mt-1 text-right text-xs text-ink-secondary">
                {draft.length}/{MAX_MESSAGE_CHARS}
              </p>
            ) : null}
          </form>
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open Ask Gemini"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 items-center gap-2 rounded-full bg-maroon pl-3.5 pr-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-maroon-dark"
      >
        <SparkleIcon className="h-4 w-4" />
        Ask Gemini
      </button>
    </div>
  );
}
