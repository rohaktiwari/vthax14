/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastController {
  /** Queue an accessible toast. Success/info announce politely; errors assertively. */
  showToast: (message: string, tone?: ToastTone) => void;
}

/** No-op default so components render in isolation without a provider. */
const ToastContext = createContext<ToastController>({ showToast: () => {} });

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-success/40 bg-panel text-ink-primary",
  info: "border-line bg-panel text-ink-primary",
  error: "border-danger/50 bg-panel text-ink-primary",
};

const TONE_LABEL: Record<ToastTone, string> = {
  success: "Success",
  info: "Information",
  error: "Error",
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm shadow-card-lg ${TONE_CLASSES[toast.tone]}`}
    >
      <p className="min-w-0 flex-1">
        <span className="sr-only">{TONE_LABEL[toast.tone]}: </span>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-0.5 text-ink-secondary hover:text-ink-primary"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Toast host (frontend PRD §8.3, §10.6, §12.5).
 *
 * The two live regions are always mounted so screen readers announce messages
 * appended later. Toasts are queued for a short time and can be dismissed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((previous) => [...previous, { id, message, tone }]);
      const timer = window.setTimeout(() => dismiss(id), tone === "error" ? 8000 : 5000);
      timersRef.current.push(timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  const value = useMemo<ToastController>(() => ({ showToast }), [showToast]);
  const polite = toasts.filter((toast) => toast.tone !== "error");
  const assertive = toasts.filter((toast) => toast.tone === "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 print:hidden">
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex w-full flex-col items-center gap-2"
        >
          {polite.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="flex w-full flex-col items-center gap-2"
        >
          {assertive.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastController {
  return useContext(ToastContext);
}
