import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "normal";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} closeLabel={cancelLabel} onClose={onCancel} size="sm">
      <div className="flex gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)]"
          }`}
        >
          <AlertTriangle size={20} />
        </div>
        <p className="muted text-sm leading-6">{message}</p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn btn-secondary" type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
          type="button"
          onClick={() => {
            void onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
