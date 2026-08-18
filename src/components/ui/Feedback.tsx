"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

/**
 * Transient feedback after a mutation.
 *
 * Rendered into a live region so a screen reader announces the outcome rather
 * than leaving it to be noticed visually. Errors are polite but explicit —
 * what failed and what to do about it, no apologies.
 */

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show: (tone: ToastTone, message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  // A no-op fallback keeps components usable outside a provider — in tests,
  // or in a portal that has not adopted the provider yet.
  return api ?? { show: () => {} };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((tone: ToastTone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    // Errors stay until dismissed; success and info clear themselves.
    if (tone !== "error") {
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 5000);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 max-w-sm"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tones = {
    success: { cls: "bg-good-50 border-good-100 text-good-700", Icon: CheckCircle2 },
    error: { cls: "bg-crit-50 border-crit-100 text-crit-700", Icon: AlertTriangle },
    info: { cls: "bg-brand-50 border-brand-200 text-brand-700", Icon: Info },
  }[toast.tone];
  const { Icon } = tones;

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-card border px-4 py-3 shadow-e4 ${tones.cls}`}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm font-semibold flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
