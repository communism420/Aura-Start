import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { t } from "../i18n";
import { useAuraStore } from "../store/useAuraStore";

const iconByType = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle
};

export function Toasts() {
  const toasts = useAuraStore((state) => state.toasts);
  const removeToast = useAuraStore((state) => state.removeToast);
  const language = useAuraStore((state) => state.data?.settings.language ?? "en");

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => {
        const Icon = iconByType[toast.type];
        return (
          <div className="surface rounded-xl p-4" key={toast.id} role="status">
            <div className="flex gap-3">
              <Icon
                className={toast.type === "error" ? "text-[var(--danger)]" : "text-[var(--accent)]"}
                size={20}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{toast.title}</div>
                {toast.message ? <div className="muted mt-1 text-sm">{toast.message}</div> : null}
                {toast.actionLabel && toast.onAction ? (
                  <button
                    className="mt-3 text-sm font-semibold text-[var(--accent-strong)]"
                    type="button"
                    onClick={() => {
                      void toast.onAction?.();
                      removeToast(toast.id);
                    }}
                  >
                    {toast.actionLabel}
                  </button>
                ) : null}
              </div>
              <button
                aria-label={t(language, "dismissNotification")}
                className="btn btn-ghost h-8 w-8 p-0"
                type="button"
                onClick={() => removeToast(toast.id)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
