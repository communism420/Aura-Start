import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartGroup, AuraStartLink } from "../types";
import { buildGroupTree, flattenGroupTree, groupTitlePath } from "../utils/groupTree";
import { Modal } from "./Modal";

export type EditingLink = {
  groupId: string;
  link: AuraStartLink;
};

type AddEditLinkDialogProps = {
  language: AuraLanguage;
  open: boolean;
  groups: AuraStartGroup[];
  initialGroupId?: string;
  editing?: EditingLink | null;
  onClose: () => void;
  onCreateGroup: (title: string) => Promise<string | undefined>;
  onAdd: (groupId: string, input: LinkFormState) => Promise<void>;
  onUpdate: (groupId: string, linkId: string, input: LinkFormState) => Promise<void>;
  onError: (message: string) => void;
};

export type LinkFormState = {
  title: string;
  url: string;
  description: string;
  tags: string;
};

export function AddEditLinkDialog({
  language,
  open,
  groups,
  initialGroupId,
  editing,
  onClose,
  onCreateGroup,
  onAdd,
  onUpdate,
  onError
}: AddEditLinkDialogProps) {
  const sortedGroups = useMemo(() => flattenGroupTree(buildGroupTree(groups)), [groups]);
  const [groupId, setGroupId] = useState("");
  const [newGroupTitle, setNewGroupTitle] = useState(t(language, "startGroupTitle"));
  const [form, setForm] = useState<LinkFormState>({ title: "", url: "", description: "", tags: "" });

  useEffect(() => {
    if (!open) return;
    const targetGroupId = editing?.groupId ?? initialGroupId ?? sortedGroups[0]?.id ?? "";
    setGroupId(targetGroupId);
    setNewGroupTitle(t(language, "startGroupTitle"));
    setForm({
      title: editing?.link.title ?? "",
      url: editing?.link.url ?? "",
      description: editing?.link.description ?? "",
      tags: editing?.link.tags?.join(", ") ?? ""
    });
  }, [editing, initialGroupId, language, open, sortedGroups]);

  const updateField = (field: keyof LinkFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function handleSubmit() {
    let targetGroupId = groupId;
    if (!editing && !targetGroupId) {
      const createdId = await onCreateGroup(newGroupTitle);
      if (!createdId) {
        throw new Error(t(language, "couldNotCreateGroupForLink"));
      }
      targetGroupId = createdId;
    }

    if (editing) {
      await onUpdate(editing.groupId, editing.link.id, form);
    } else {
      await onAdd(targetGroupId, form);
    }
  }

  return (
    <Modal open={open} title={editing ? t(language, "editLink") : t(language, "addLink")} closeLabel={t(language, "closeDialog")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit()
            .then(onClose)
            .catch((error: unknown) => onError(error instanceof Error ? error.message : t(language, "couldNotSaveLink")));
        }}
      >
        {!editing && sortedGroups.length > 0 ? (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "group")}</span>
            <select className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {sortedGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupTitlePath(groups, group)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!editing && sortedGroups.length === 0 ? (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "newGroupTitle")}</span>
            <input
              className="field"
              maxLength={80}
              value={newGroupTitle}
              onChange={(event) => setNewGroupTitle(event.target.value)}
            />
          </label>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "title")}</span>
            <input
              autoFocus
              className="field"
              maxLength={120}
              placeholder={t(language, "projectDashboard")}
              value={form.title}
              onChange={(event) => updateField("title", event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "url")}</span>
            <input
              className="field"
              placeholder="example.com"
              value={form.url}
              onChange={(event) => updateField("url", event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{t(language, "description")}</span>
          <textarea
            className="field min-h-24 resize-y"
            maxLength={260}
            placeholder={t(language, "optionalNote")}
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{t(language, "tags")}</span>
          <input
            className="field"
            placeholder={t(language, "tagsPlaceholder")}
            value={form.tags}
            onChange={(event) => updateField("tags", event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {t(language, "cancel")}
          </button>
          <button className="btn btn-primary" type="submit">
            {editing ? t(language, "saveLink") : t(language, "addLink")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
