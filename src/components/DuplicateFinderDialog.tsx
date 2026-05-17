import { SearchCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartData } from "../types";
import { findDuplicateLinks, type DuplicateGroup, type DuplicateLinkRef, type DuplicateReason } from "../utils/duplicates";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

type DuplicateDeleteTarget = {
  groupId: string;
  linkId: string;
};

type DuplicateFinderDialogProps = {
  language: AuraLanguage;
  open: boolean;
  data: AuraStartData;
  onClose: () => void;
  onDeleteSelected: (targets: DuplicateDeleteTarget[]) => Promise<void>;
  onError: (message: string) => void;
};

function itemId(item: DuplicateLinkRef): string {
  return `${item.groupId}::${item.link.id}`;
}

function reasonLabel(language: AuraLanguage, reason: DuplicateReason): string {
  switch (reason) {
    case "exact_url":
      return t(language, "duplicateReasonExactUrl");
    case "hostname_case":
      return t(language, "duplicateReasonHostnameCase");
    case "trailing_slash":
      return t(language, "duplicateReasonTrailingSlash");
    case "http_https":
      return t(language, "duplicateReasonHttpHttps");
  }
}

function selectedTargets(selected: Set<string>): DuplicateDeleteTarget[] {
  return Array.from(selected).map((id) => {
    const [groupId, linkId] = id.split("::");
    return { groupId, linkId };
  });
}

function willRemoveAllCopies(groups: DuplicateGroup[], selected: Set<string>): boolean {
  return groups.some((group) => group.items.every((item) => selected.has(itemId(item))));
}

export function DuplicateFinderDialog({
  language,
  open,
  data,
  onClose,
  onDeleteSelected,
  onError
}: DuplicateFinderDialogProps) {
  const duplicateGroups = useMemo(() => findDuplicateLinks(data), [data]);
  const exactGroups = duplicateGroups.filter((group) => group.kind === "exact");
  const possibleGroups = duplicateGroups.filter((group) => group.kind === "possible");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectedCount = selected.size;
  const removesAllCopies = willRemoveAllCopies(duplicateGroups, selected);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setConfirmOpen(false);
    }
  }, [open, data.updatedAt]);

  function toggleItem(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function keepOnly(group: DuplicateGroup, keepId: string) {
    setSelected((current) => {
      const next = new Set(current);
      group.items.forEach((item) => {
        const id = itemId(item);
        if (id === keepId) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }

  const renderGroup = (group: DuplicateGroup) => (
    <div className="rounded-lg border border-[var(--border)] p-3" key={group.id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{reasonLabel(language, group.reason)}</div>
          <div className="muted text-sm">{t(language, "linksCount", { count: group.items.length })}</div>
        </div>
      </div>
      <div className="space-y-2">
        {group.items.map((item) => {
          const id = itemId(item);
          const checked = selected.has(id);
          return (
            <div className="duplicate-row" key={id}>
              <label className="flex min-w-0 flex-1 items-start gap-3">
                <input
                  aria-label={t(language, "selectDuplicateLink", { title: item.link.title })}
                  checked={checked}
                  className="mt-1"
                  type="checkbox"
                  onChange={() => toggleItem(id)}
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{item.link.title}</span>
                  <span className="muted block truncate text-sm">{item.link.url}</span>
                  <span className="muted block text-xs">{item.groupTitle}</span>
                </span>
              </label>
              <button
                aria-label={`${t(language, "keepThis")}: ${item.link.title}`}
                className="btn btn-secondary shrink-0"
                type="button"
                onClick={() => keepOnly(group, id)}
              >
                {t(language, "keepThis")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        title={t(language, "duplicateFinder")}
        description={t(language, "duplicateFinderDescription")}
        closeLabel={t(language, "closeDialog")}
        onClose={onClose}
        size="xl"
      >
        {duplicateGroups.length ? (
          <div className="space-y-5">
            <div className="rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent-strong)]">
              {t(language, "duplicateFinderReadOnly")}
            </div>
            {exactGroups.length ? (
              <section className="space-y-2">
                <h3 className="font-semibold">{t(language, "exactDuplicates")}</h3>
                {exactGroups.map(renderGroup)}
              </section>
            ) : null}
            {possibleGroups.length ? (
              <section className="space-y-2">
                <h3 className="font-semibold">{t(language, "possibleDuplicates")}</h3>
                {possibleGroups.map(renderGroup)}
              </section>
            ) : null}
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] pt-3">
              <span className="muted text-sm">{t(language, "selectedDuplicatesCount", { count: selectedCount })}</span>
              <button className="btn btn-danger" disabled={!selectedCount} type="button" onClick={() => setConfirmOpen(true)}>
                <Trash2 size={16} />
                {t(language, "deleteSelected")}
              </button>
            </div>
          </div>
        ) : (
          <div className="surface-flat rounded-xl p-8 text-center">
            <SearchCheck className="mx-auto text-[var(--accent)]" size={32} />
            <p className="mt-3 font-semibold">{t(language, "noDuplicatesFound")}</p>
            <p className="muted mt-1 text-sm">{t(language, "duplicateFinderNoMutation")}</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        cancelLabel={t(language, "cancel")}
        confirmLabel={t(language, "deleteSelected")}
        message={
          removesAllCopies
            ? `${t(language, "deleteSelectedDuplicatesMessage", { count: selectedCount })} ${t(language, "thisWouldRemoveAllCopies")}`
            : t(language, "deleteSelectedDuplicatesMessage", { count: selectedCount })
        }
        open={confirmOpen}
        title={t(language, "deleteSelectedDuplicates")}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          try {
            await onDeleteSelected(selectedTargets(selected));
            setConfirmOpen(false);
            setSelected(new Set());
          } catch (error) {
            onError(error instanceof Error ? error.message : t(language, "couldNotCompleteAction"));
          }
        }}
      />
    </>
  );
}
