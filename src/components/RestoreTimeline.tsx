import { Clock, Download, Filter, Move, RotateCcw, Search, ShieldPlus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { MAX_RESTORE_POINTS } from "../constants";
import { t } from "../i18n";
import type { AuraLanguage, AuraRestorePoint, AuraRestorePointReason, AuraStartData, RestoreTimelineDay } from "../types";
import { dateForFile, formatDateTime } from "../utils/dates";
import { downloadTextFile } from "../utils/download";
import { createJsonBackup } from "../utils/exportJson";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

type RestoreTimelineProps = {
  language: AuraLanguage;
  open: boolean;
  timeline: RestoreTimelineDay[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onError: (message: string) => void;
};

type PendingAction =
  | { type: "restore"; point: AuraRestorePoint }
  | { type: "delete"; point: AuraRestorePoint }
  | { type: "deleteAll" }
  | null;

type ReasonFilter = AuraRestorePointReason | "all";

const reasonFilters: AuraRestorePointReason[] = [
  "manual",
  "before_link_delete",
  "before_group_delete",
  "before_duplicate_delete",
  "before_bulk_delete",
  "before_link_move",
  "before_group_move",
  "before_group_reorder",
  "before_tabs_save",
  "before_import",
  "before_cloud_restore",
  "before_demo_remove",
  "before_reset",
  "before_restore",
  "before_delete",
  "auto"
];

function restoreReasonLabel(language: AuraLanguage, reason: AuraRestorePointReason): string {
  switch (reason) {
    case "auto":
      return t(language, "restoreReasonAuto");
    case "before_bulk_delete":
      return t(language, "restoreReasonBeforeBulkDelete");
    case "before_cloud_restore":
      return t(language, "restoreReasonBeforeCloudRestore");
    case "before_delete":
      return t(language, "restoreReasonBeforeDelete");
    case "before_demo_remove":
      return t(language, "restoreReasonBeforeDemoRemove");
    case "before_duplicate_delete":
      return t(language, "restoreReasonBeforeDuplicateDelete");
    case "before_group_delete":
      return t(language, "restoreReasonBeforeGroupDelete");
    case "before_group_move":
      return t(language, "restoreReasonBeforeGroupMove");
    case "before_group_reorder":
      return t(language, "restoreReasonBeforeGroupReorder");
    case "before_tabs_save":
      return t(language, "restoreReasonBeforeTabsSave");
    case "before_import":
      return t(language, "restoreReasonBeforeImport");
    case "before_link_delete":
      return t(language, "restoreReasonBeforeLinkDelete");
    case "before_link_move":
      return t(language, "restoreReasonBeforeLinkMove");
    case "before_reset":
      return t(language, "restoreReasonBeforeReset");
    case "before_restore":
      return t(language, "restoreReasonBeforeRestore");
    case "manual":
      return t(language, "restoreReasonManual");
  }
}

function restoreReasonIcon(reason: AuraRestorePointReason) {
  if (reason.includes("move") || reason.includes("reorder")) {
    return <Move size={15} />;
  }

  if (reason.includes("delete")) {
    return <Trash2 size={15} />;
  }

  if (reason.includes("import") || reason.includes("restore") || reason === "auto") {
    return <RotateCcw size={15} />;
  }

  return <Clock size={15} />;
}

function restorePointAsBackup(point: AuraRestorePoint): AuraStartData {
  return {
    ...point.data,
    restorePoints: []
  };
}

function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(date)
    ? new Date(year, month - 1, date)
    : new Date(day);

  if (Number.isNaN(value.getTime())) {
    return day;
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(value);
}

function contextDetails(language: AuraLanguage, point: AuraRestorePoint): string[] {
  const context = point.context;
  if (!context) return [];

  const details = [
    context.title,
    context.groupTitle,
    context.source,
    context.description
  ].filter((value): value is string => Boolean(value));

  if (context.from && context.to && context.from !== context.to) {
    details.push(t(language, "restoreTimelineContextFromTo", { from: context.from, to: context.to }));
  }

  if (typeof context.count === "number" && context.count > 0) {
    details.push(t(language, "restoreTimelineContextCount", { count: context.count }));
  }

  return Array.from(new Set(details));
}

function pointSearchText(language: AuraLanguage, point: AuraRestorePoint): string {
  return [
    point.name,
    restoreReasonLabel(language, point.reason),
    formatDateTime(point.createdAt),
    ...contextDetails(language, point)
  ].join(" ").toLowerCase();
}

export function RestoreTimeline({
  language,
  open,
  timeline,
  onClose,
  onCreate,
  onRestore,
  onDelete,
  onDeleteAll,
  onError
}: RestoreTimelineProps) {
  const [name, setName] = useState(t(language, "manualCheckpoint"));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReasonFilter>("all");
  const [pending, setPending] = useState<PendingAction>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const totalEntries = timeline.reduce((count, day) => count + day.entries.length, 0);
  const filteredTimeline = useMemo(
    () =>
      timeline
        .map((day) => ({
          ...day,
          entries: day.entries.filter((entry) => {
            const reasonMatches = filter === "all" || entry.point.reason === filter;
            const queryMatches = !normalizedQuery || pointSearchText(language, entry.point).includes(normalizedQuery);
            return reasonMatches && queryMatches;
          })
        }))
        .filter((day) => day.entries.length > 0),
    [filter, language, normalizedQuery, timeline]
  );
  const filteredCount = filteredTimeline.reduce((count, day) => count + day.entries.length, 0);

  function exportPoint(point: AuraRestorePoint) {
    try {
      downloadTextFile(
        `aura-start-restore-point-${dateForFile(new Date(point.createdAt))}.json`,
        createJsonBackup(restorePointAsBackup(point)),
        "application/json;charset=utf-8"
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotExportBackup"));
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={t(language, "restoreTimeline")}
        description={t(language, "restoreTimelineDescription", { count: MAX_RESTORE_POINTS })}
        closeLabel={t(language, "closeDialog")}
        onClose={onClose}
        size="lg"
      >
        <form
          className="restore-timeline-create"
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

        <div className="restore-timeline-toolbar">
          <label className="restore-timeline-search">
            <span className="sr-only">{t(language, "restoreTimelineSearchPlaceholder")}</span>
            <Search aria-hidden="true" size={16} />
            <input
              className="restore-timeline-search-input"
              placeholder={t(language, "restoreTimelineSearchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="restore-timeline-filter">
            <Filter aria-hidden="true" size={16} />
            <span className="sr-only">{t(language, "restoreTimelineActionFilter")}</span>
            <select className="field" value={filter} onChange={(event) => setFilter(event.target.value as ReasonFilter)}>
              <option value="all">{t(language, "restoreTimelineAllActions")}</option>
              {reasonFilters.map((reason) => (
                <option key={reason} value={reason}>
                  {restoreReasonLabel(language, reason)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="restore-timeline-summary">
          <span>{t(language, "restoreTimelineTotal", { count: filteredCount })}</span>
          {totalEntries ? (
            <button className="btn btn-ghost text-[var(--danger)]" type="button" onClick={() => setPending({ type: "deleteAll" })}>
              <Trash2 size={16} />
              {t(language, "deleteAllOldRestorePoints")}
            </button>
          ) : null}
        </div>

        {filteredTimeline.length ? (
          <div className="restore-timeline-list">
            {filteredTimeline.map((day) => (
              <section className="restore-timeline-day" key={day.day}>
                <h3 className="restore-timeline-day-title">{formatDay(day.day)}</h3>
                <div className="restore-timeline-day-list">
                  {day.entries.map((entry) => {
                    const details = contextDetails(language, entry.point);
                    return (
                      <article className="restore-timeline-entry" key={entry.point.id}>
                        <div className="restore-timeline-marker" aria-hidden="true">
                          {restoreReasonIcon(entry.point.reason)}
                        </div>
                        <div className="restore-timeline-entry-main">
                          <div className="restore-timeline-entry-header">
                            <div className="min-w-0">
                              <h4 className="restore-timeline-entry-title">{entry.point.name}</h4>
                              <div className="restore-timeline-entry-meta">
                                {formatDateTime(entry.point.createdAt)} · {restoreReasonLabel(language, entry.point.reason)} ·{" "}
                                {t(language, "groupsCount", { count: entry.groupCount })} ·{" "}
                                {t(language, "linksCount", { count: entry.linkCount })}
                              </div>
                            </div>
                            <div className="restore-timeline-entry-actions">
                              <button className="btn btn-secondary" type="button" onClick={() => setPending({ type: "restore", point: entry.point })}>
                                <RotateCcw size={16} />
                                {t(language, "restore")}
                              </button>
                              <button className="btn btn-secondary" type="button" onClick={() => exportPoint(entry.point)}>
                                <Download size={16} />
                                {t(language, "exportRestorePoint")}
                              </button>
                              <button
                                aria-label={t(language, "deleteRestorePointAria", { name: entry.point.name })}
                                className="btn btn-ghost text-[var(--danger)]"
                                type="button"
                                onClick={() => setPending({ type: "delete", point: entry.point })}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          {details.length ? (
                            <div className="restore-timeline-details">
                              {details.map((detail) => (
                                <span key={detail}>{detail}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : totalEntries ? (
          <div className="surface-flat rounded-xl p-8 text-center">
            <p className="font-semibold">{t(language, "restoreTimelineNoMatches")}</p>
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
        confirmLabel={
          pending?.type === "restore"
            ? t(language, "restore")
            : pending?.type === "deleteAll"
              ? t(language, "deleteAllOldRestorePoints")
              : t(language, "delete")
        }
        message={
          pending?.type === "restore"
            ? t(language, "restoreThisPointMessage")
            : pending?.type === "deleteAll"
              ? t(language, "deleteAllRestorePointsMessage")
              : t(language, "deleteRestorePointMessage")
        }
        open={pending !== null}
        title={
          pending?.type === "restore"
            ? t(language, "restoreThisPoint")
            : pending?.type === "deleteAll"
              ? t(language, "deleteAllOldRestorePoints")
              : t(language, "deleteRestorePoint")
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          try {
            if (pending.type === "restore") {
              await onRestore(pending.point.id);
            } else if (pending.type === "delete") {
              await onDelete(pending.point.id);
            } else {
              await onDeleteAll();
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
