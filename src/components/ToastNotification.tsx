import React, { useEffect, useState } from 'react';
import { X, Sparkles, Bell, Clock, CheckCircle } from 'lucide-react';

export interface ToastItem {
  id: string;
  title?: string;
  message: string;
  taskTitle?: string;
  taskTime?: string;
  type?: 'info' | 'success' | 'warning' | 'reminder';
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number; // default 10000ms for regular toasts
  persistent?: boolean; // if true or type === 'reminder', never auto-closes
}

export const TOAST_EVENT = 'kiberone:show-toast';

export function showToast(toast: Omit<ToastItem, 'id'> & { id?: string }): void {
  if (typeof window === 'undefined') return;
  const isReminder = toast.type === 'reminder' || toast.persistent;
  const item: ToastItem = {
    ...toast,
    id: toast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: toast.title || (isReminder ? 'Оповещаю вас, Анна 🔔' : 'Оповещаю вас, Анна'),
    durationMs: isReminder ? undefined : (toast.durationMs ?? 10000),
    persistent: isReminder ? true : Boolean(toast.persistent),
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
      className="fixed bottom-6 right-6 z-[99999] flex flex-col gap-3 max-w-[420px] w-[calc(100vw-3rem)] pointer-events-none select-none"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

export const GlobalToast = ToastNotification;

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: () => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ toast, onDismiss }) => {
  const [isClosing, setIsClosing] = useState(false);
  const isReminder = toast.type === 'reminder' || toast.persistent;

  useEffect(() => {
    // Crucial: Reminders must NOT close themselves until Anna explicitly clicks dismiss!
    if (isReminder || toast.persistent) {
      return;
    }
    const duration = toast.durationMs ?? 10000;
    const timer = setTimeout(() => {
      handleClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, isReminder]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onDismiss();
    }, 200);
  };

  if (isReminder) {
    return (
      <div
        className={`pointer-events-auto bg-white rounded-2xl p-5 shadow-xl border border-amber-200 text-slate-900 transition-all duration-200 flex flex-col gap-3.5 relative overflow-hidden ${
          isClosing
            ? 'opacity-0 translate-y-3 scale-95'
            : 'opacity-100 translate-y-0 scale-100'
        }`}
      >
        {/* Close button in top-right with neat offset */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Закрыть уведомление"
          title="Закрыть уведомление"
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header: Bell Icon + Title with pr-8 to prevent collision with close button */}
        <div className="flex items-start gap-3 pr-8 pt-0.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-amber-600 block leading-tight">
              Срочное напоминание
            </span>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight leading-snug">
              {toast.title || 'Оповещаю вас, Анна 🔔'}
            </h3>
          </div>
        </div>

        {/* Body Content */}
        <div className="space-y-1.5">
          {toast.taskTitle ? (
            <div className="text-sm font-semibold text-slate-800 leading-snug break-words">
              {toast.taskTitle}
            </div>
          ) : (
            <div className="text-sm font-normal text-slate-700 leading-snug break-words">
              {toast.message}
            </div>
          )}

          {toast.taskTime && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50/80 border border-amber-200 text-xs font-semibold text-amber-900 font-mono-tabular">
              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Время: {toast.taskTime}</span>
            </div>
          )}
        </div>

        {/* Action Buttons: aligned in row with flex gap-2 and equal height */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 h-9 px-3 rounded-xl bg-transparent hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer border border-gray-200 inline-flex items-center justify-center"
          >
            Отключить
          </button>

          <button
            type="button"
            onClick={() => {
              if (toast.onAction) {
                toast.onAction();
              } else {
                window.dispatchEvent(
                  new CustomEvent('kiberone:navigate', { detail: { section: 'tasks' } })
                );
              }
              handleClose();
            }}
            className="flex-1 h-9 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs inline-flex items-center justify-center gap-1.5"
          >
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{toast.actionLabel || 'Посмотреть задачи'}</span>
          </button>
        </div>
      </div>
    );
  }

  // Standard info/success toast
  return (
    <div
      className={`pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-slate-200 text-slate-800 transition-all duration-200 flex flex-col gap-2 ${
        isClosing
          ? 'opacity-0 translate-y-2 scale-95'
          : 'opacity-100 translate-y-0 scale-100'
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs">
            <Sparkles className="w-3.5 h-3.5" />
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
