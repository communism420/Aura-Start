import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartGroup } from "../types";
import { buildGroupTree, flattenGroupTree } from "../utils/groupTree";
import { Modal } from "./Modal";

type AddEditGroupDialogProps = {
  language: AuraLanguage;
  open: boolean;
  group?: AuraStartGroup | null;
  groups: AuraStartGroup[];
  initialParentId?: string | null;
  onClose: () => void;
  onSubmit: (title: string, parentId: string | null) => Promise<void>;
  onError: (message: string) => void;
};

export function AddEditGroupDialog({
  language,
  open,
  group,
  groups,
  initialParentId = null,
  onClose,
  onSubmit,
  onError
}: AddEditGroupDialogProps) {
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const groupHasChildren = Boolean(group && groups.some((candidate) => candidate.parentId === group.id));
  const parentOptions = useMemo(() => {
    if (groupHasChildren) {
      return [];
    }

    return flattenGroupTree(buildGroupTree(groups)).filter(
      (candidate) => candidate.depth === 0 && candidate.id !== group?.id
    );
  }, [group?.id, groupHasChildren, groups]);

  useEffect(() => {
    if (open) {
      setTitle(group?.title ?? "");
      setParentId(group?.parentId ?? initialParentId ?? "");
    }
  }, [group, initialParentId, open]);

  return (
    <Modal open={open} title={group ? t(language, "renameGroup") : t(language, "addGroup")} closeLabel={t(language, "closeDialog")} onClose={onClose} size="sm">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(title, parentId || null)
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
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{t(language, "parentGroup")}</span>
          <select
            className="field"
            disabled={groupHasChildren}
            value={groupHasChildren ? "" : parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">{t(language, "topLevelGroup")}</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          {groupHasChildren ? (
            <span className="muted mt-1 block text-xs">{t(language, "groupWithChildrenCannotBeNested")}</span>
          ) : null}
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
