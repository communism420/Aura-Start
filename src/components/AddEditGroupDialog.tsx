import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartGroup } from "../types";
import { Modal } from "./Modal";

type AddEditGroupDialogProps = {
  language: AuraLanguage;
  open: boolean;
  group?: AuraStartGroup | null;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
  onError: (message: string) => void;
};

export function AddEditGroupDialog({ language, open, group, onClose, onSubmit, onError }: AddEditGroupDialogProps) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(group?.title ?? "");
    }
  }, [group, open]);

  return (
    <Modal open={open} title={group ? t(language, "renameGroup") : t(language, "addGroup")} closeLabel={t(language, "closeDialog")} onClose={onClose} size="sm">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(title)
            .then(onClose)
            .catch((error: unknown) => onError(error instanceof Error ? error.message : t(language, "couldNotSaveGroup")));
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{t(language, "title")}</span>
          <input
            autoFocus
            className="field"
            maxLength={80}
            placeholder={t(language, "groupTitlePlaceholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {t(language, "cancel")}
          </button>
          <button className="btn btn-primary" type="submit">
            {group ? t(language, "save") : t(language, "addGroup")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
