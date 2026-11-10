import React, { useEffect, useState } from 'react';
import { X, Sparkles, Bell } from 'lucide-react';

export interface ToastItem {
  id: string;
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'reminder';
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number; // default 10000ms
}

export const TOAST_EVENT = 'kiberone:show-toast';

export function showToast(toast: Omit<ToastItem, 'id'> & { id?: string }): void {
  if (typeof window === 'undefined') return;
  const item: ToastItem = {
    ...toast,
    id: toast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    durationMs: toast.durationMs ?? 10000,
  };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: item }));
}

export const ToastNotification: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handleAdd = (e: Event) => {
      const customEvent = e as CustomEvent<ToastItem>;
      if (!customEvent.detail) return;
      const newToast = customEvent.detail;
      setToasts((prev) => [...prev.filter((t) => t.id !== newToast.id), newToast]);
    };

    window.addEventListener(TOAST_EVENT, handleAdd);
    return () => window.removeEventListener(TOAST_EVENT, handleAdd);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none select-none"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: () => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ toast, onDismiss }) => {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const duration = toast.durationMs ?? 10000;
    const timer = setTimeout(() => {
      handleClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onDismiss();
    }, 200);
  };

  return (
    <div
      className={`pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-slate-200/90 text-slate-800 transition-all duration-200 flex flex-col gap-2 ${
        isClosing
          ? 'opacity-0 translate-y-2 scale-95'
          : 'opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-bottom-3 duration-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs">
            {toast.type === 'reminder' ? (
              <Bell className="w-3.5 h-3.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 tracking-tight">
              {toast.title || 'Оповещаю вас, Анна'}
            </h4>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Закрыть уведомление"
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-slate-700 leading-relaxed break-words font-normal pl-9">
        {toast.message}
      </p>

      {toast.actionLabel && toast.onAction && (
        <div className="pl-9 pt-1">
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              handleClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-[11px] font-semibold transition-colors cursor-pointer shadow-xs"
          >
            <span>{toast.actionLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};
