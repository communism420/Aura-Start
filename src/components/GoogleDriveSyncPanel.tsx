import { AlertTriangle, Cloud, Trash2, X } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import type {
  AuraStartData,
  AuraSyncConflict,
  AuraSyncConflictChoice,
  AuraSyncStatus
} from "../types";
import { formatDateTime } from "../utils/dates";
import { exportJsonBackup } from "../utils/exportJson";
import { GoogleDriveSyncError } from "../services/googleDriveSync";

type GoogleDriveSyncPanelProps = {
  data: AuraStartData;
  syncStatus: AuraSyncStatus;
  syncMessage: string | null;
  syncConflict: AuraSyncConflict | null;
  onConnect: () => Promise<void>;
  onDeleteBackupAndDisconnect: () => Promise<void>;
  onResolveConflict: (choice: AuraSyncConflictChoice) => Promise<void>;
  onError: (message: string) => void;
};

type PendingConfirm = "delete_backup_and_disconnect" | null;

function isBusy(status: AuraSyncStatus): boolean {
  return status === "connecting" || status === "syncing";
}

export function GoogleDriveSyncPanel({
  data,
  syncStatus,
  syncMessage,
  syncConflict,
  onConnect,
  onDeleteBackupAndDisconnect,
  onResolveConflict,
  onError
}: GoogleDriveSyncPanelProps) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const language = data.settings.language;
  const sync = data.settings.sync;
  const busy = isBusy(syncStatus);
  const hasGoogleConnection = Boolean(sync.connected);
  const connected = sync.mode !== "off" && hasGoogleConnection;
  const canManageConnection = hasGoogleConnection && !busy;
  const displayMessage = hasGoogleConnection && syncMessage ? syncMessage : (sync.mode === "off"
    ? t(language, "googleDriveSyncDisabled")
    : connected
      ? t(language, "googleDriveConnected")
      : t(language, "googleDriveNotConnected"));

  function run(action: () => Promise<void>) {
    void action().catch((error: unknown) => {
      if (error instanceof GoogleDriveSyncError) return;
      onError(error instanceof Error ? error.message : t(language, "googleDriveSyncFailed"));
    });
  }

  async function runConfirmed(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (error instanceof GoogleDriveSyncError) return;
      onError(error instanceof Error ? error.message : t(language, "googleDriveSyncFailed"));
    }
  }

  function handleExportLocal() {
    try {
      exportJsonBackup(data);
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotExportBackup"));
    }
  }

  return (
    <div className="surface-flat rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t(language, "googleDriveSyncTitle")}</h3>
          <p className="muted mt-1 text-sm leading-6">{t(language, "googleDriveSyncDescription")}</p>
        </div>
        <Cloud className={syncStatus === "error" || syncStatus === "conflict" ? "text-[var(--danger)]" : "text-[var(--accent)]"} size={20} />
      </div>

      <ul className="muted mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
        <li>{t(language, "googleDriveSyncOffByDefault")}</li>
        <li>{t(language, "googleDriveAutoSyncActive")}</li>
        <li>{t(language, "googleDriveGoogleWindow")}</li>
        <li>{t(language, "googleDriveMinimalScope")}</li>
        <li>{t(language, "googleDriveSyncUsesAppData")}</li>
        <li>{t(language, "googleDriveNoFullDrive")}</li>
        <li>{t(language, "googleDriveNoTracking")}</li>
        <li>{t(language, "googleDriveManualExportStillWorks")}</li>
      </ul>

      <div className="mt-4 rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="font-semibold">{displayMessage}</div>
        {sync.accountEmail || sync.accountName ? (
          <div className="muted mt-1">{sync.accountName ?? sync.accountEmail}</div>
        ) : null}
        {hasGoogleConnection && sync.lastSyncedAt ? (
          <div className="muted mt-1">{t(language, "googleDriveLastSynced", { time: formatDateTime(sync.lastSyncedAt) })}</div>
        ) : null}
        {hasGoogleConnection && sync.lastCloudUpdatedAt ? (
          <div className="muted mt-1">{t(language, "googleDriveLastCloudUpdate", { time: formatDateTime(sync.lastCloudUpdatedAt) })}</div>
        ) : null}
      </div>

      {pendingConfirm === "delete_backup_and_disconnect" ? (
        <div className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertTriangle size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold">{t(language, "googleDriveDeleteBackupAndDisconnect")}</div>
                <button
                  aria-label={t(language, "cancel")}
                  className="btn btn-ghost h-8 w-8 shrink-0 p-0"
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="muted mt-2 leading-6">{t(language, "googleDriveDeleteBackupAndDisconnectConfirmMessage")}</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button className="btn btn-secondary" type="button" onClick={() => setPendingConfirm(null)}>
                  {t(language, "cancel")}
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => {
                    setPendingConfirm(null);
                    void runConfirmed(onDeleteBackupAndDisconnect);
                  }}
                >
                  {t(language, "googleDriveDeleteBackupAndDisconnectConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        {!hasGoogleConnection ? (
          <button className="btn btn-primary h-11 min-w-0 w-full justify-center whitespace-nowrap px-3 text-sm" disabled={busy} type="button" onClick={() => run(onConnect)}>
            <Cloud className="shrink-0" size={17} />
            <span className="truncate">{t(language, "googleDriveConnect")}</span>
          </button>
        ) : (
          <button
            className="btn btn-danger h-11 min-w-0 w-full justify-center whitespace-nowrap px-3 text-sm"
            disabled={!canManageConnection}
            type="button"
            onClick={() => setPendingConfirm("delete_backup_and_disconnect")}
          >
            <Trash2 className="shrink-0" size={17} />
            <span className="truncate">{t(language, "googleDriveDeleteBackupAndDisconnect")}</span>
          </button>
        )}
      </div>

      {syncConflict ? (
        <div className="mt-4 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm">
          <div className="font-semibold text-[var(--danger)]">{t(language, "googleDriveConflictDetected")}</div>
          <div className="mt-1 leading-6">
            {t(language, "googleDriveConflictTimes", {
              local: formatDateTime(syncConflict.localUpdatedAt),
              cloud: formatDateTime(syncConflict.cloudUpdatedAt)
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} type="button" onClick={() => run(() => onResolveConflict("keep_local"))}>
              {t(language, "googleDriveKeepLocal")}
            </button>
            <button className="btn btn-secondary" disabled={busy} type="button" onClick={() => run(() => onResolveConflict("keep_cloud"))}>
              {t(language, "googleDriveKeepCloud")}
            </button>
            <button className="btn btn-secondary" type="button" onClick={handleExportLocal}>
              {t(language, "googleDriveExportLocalBackup")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
