import { RotateCcw, ShieldPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraRestorePoint } from "../types";
import { formatDateTime } from "../utils/dates";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

type RestorePointsDialogProps = {
  language: AuraLanguage;
  open: boolean;
  restorePoints: AuraRestorePoint[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onError: (message: string) => void;
};

type PendingAction =
  | { type: "restore"; point: AuraRestorePoint }
  | { type: "delete"; point: AuraRestorePoint }
  | null;

function restoreReasonLabel(language: AuraLanguage, reason: AuraRestorePoint["reason"]): string {
  switch (reason) {
    case "auto":
      return t(language, "restoreReasonAuto");
    case "before_delete":
      return t(language, "restoreReasonBeforeDelete");
    case "before_import":
      return t(language, "restoreReasonBeforeImport");
    case "before_reset":
      return t(language, "restoreReasonBeforeReset");
    case "manual":
      return t(language, "restoreReasonManual");
  }
}

export function RestorePointsDialog({
  language,
  open,
  restorePoints,
  onClose,
  onCreate,
  onRestore,
  onDelete,
  onError
}: RestorePointsDialogProps) {
  const [name, setName] = useState(t(language, "manualCheckpoint"));
  const [pending, setPending] = useState<PendingAction>(null);

  return (
    <>
      <Modal
        open={open}
        title={t(language, "restorePoints")}
        description={t(language, "restorePointsDescription")}
        closeLabel={t(language, "closeDialog")}
        onClose={onClose}
        size="lg"
      >
        <form
          className="mb-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreate(name).catch((error: unknown) =>
              onError(error instanceof Error ? error.message : t(language, "couldNotCreateRestorePoint"))
            );
          }}
        >
          <input
            className="field"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="btn btn-secondary shrink-0" type="submit">
            <ShieldPlus size={17} />
            {t(language, "create")}
          </button>
        </form>
        {restorePoints.length ? (
          <div className="space-y-2">
            {restorePoints.map((point) => (
              <div className="surface-flat flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-center" key={point.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{point.name}</div>
                  <div className="muted text-xs">
                    {formatDateTime(point.createdAt)} · {restoreReasonLabel(language, point.reason)} ·{" "}
                    {t(language, "groupsCount", { count: point.data.groups.length })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary" type="button" onClick={() => setPending({ type: "restore", point })}>
                    <RotateCcw size={16} />
                    {t(language, "restore")}
                  </button>
                  <button
                    aria-label={t(language, "deleteRestorePointAria", { name: point.name })}
                    className="btn btn-ghost text-[var(--danger)]"
                    type="button"
                    onClick={() => setPending({ type: "delete", point })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-flat rounded-xl p-8 text-center">
            <p className="font-semibold">{t(language, "noRestorePoints")}</p>
            <p className="muted mt-1 text-sm">{t(language, "noRestorePointsDescription")}</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        cancelLabel={t(language, "cancel")}
        confirmLabel={pending?.type === "restore" ? t(language, "restore") : t(language, "delete")}
        message={
          pending?.type === "restore"
            ? t(language, "restoreThisPointMessage")
            : t(language, "deleteRestorePointMessage")
        }
        open={pending !== null}
        title={pending?.type === "restore" ? t(language, "restoreThisPoint") : t(language, "deleteRestorePoint")}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          try {
            if (pending.type === "restore") {
              await onRestore(pending.point.id);
            } else {
              await onDelete(pending.point.id);
            }
            setPending(null);
          } catch (error) {
            onError(error instanceof Error ? error.message : t(language, "restorePointActionFailed"));
          }
        }}
      />
    </>
  );
}
