import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  size?: "sm" | "md" | "lg";
};

const sizeClass = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl"
};

export function Modal({ open, title, description, children, closeLabel = "Close dialog", onClose, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/34 px-4 py-8 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`surface w-full ${sizeClass[size]} rounded-xl p-5`}
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold" id="modal-title">
              {title}
            </h2>
            {description ? <p className="muted mt-1 text-sm">{description}</p> : null}
          </div>
          <button className="btn btn-ghost h-9 w-9 p-0" type="button" onClick={onClose} aria-label={closeLabel}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
