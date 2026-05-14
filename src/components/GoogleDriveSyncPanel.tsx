import { Cloud, Download, RefreshCw, Trash2, Upload, XCircle } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import type { I18nKey } from "../i18n";
import type {
  AuraStartData,
  AuraSyncConflict,
  AuraSyncConflictChoice,
  AuraSyncMode,
  AuraSyncStatus
} from "../types";
import { formatDateTime } from "../utils/dates";
import { exportJsonBackup } from "../utils/exportJson";
import { GoogleDriveSyncError } from "../services/googleDriveSync";
import { ConfirmDialog } from "./ConfirmDialog";

type GoogleDriveSyncPanelProps = {
  data: AuraStartData;
  syncStatus: AuraSyncStatus;
  syncMessage: string | null;
  syncConflict: AuraSyncConflict | null;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onBackup: () => Promise<void>;
  onRestore: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onSetSyncMode: (mode: AuraSyncMode) => Promise<void>;
  onDeleteSyncFile: () => Promise<void>;
  onResolveConflict: (choice: AuraSyncConflictChoice) => Promise<void>;
  onError: (message: string) => void;
};

type PendingConfirm = "delete_sync_file" | "disconnect" | null;

const syncModeOptions: AuraSyncMode[] = ["off", "manual", "auto"];
const syncModeLabelKeys: Record<AuraSyncMode, I18nKey> = {
  off: "googleDriveSyncMode_off",
  manual: "googleDriveSyncMode_manual",
  auto: "googleDriveSyncMode_auto"
};

function isBusy(status: AuraSyncStatus): boolean {
  return status === "connecting" || status === "syncing";
}

export function GoogleDriveSyncPanel({
  data,
  syncStatus,
  syncMessage,
  syncConflict,
  onConnect,
  onDisconnect,
  onBackup,
  onRestore,
  onSyncNow,
  onSetSyncMode,
  onDeleteSyncFile,
  onResolveConflict,
  onError
}: GoogleDriveSyncPanelProps) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const language = data.settings.language;
  const sync = data.settings.sync;
  const busy = isBusy(syncStatus);
  const hasGoogleConnection = Boolean(sync.connected);
  const connected = sync.mode !== "off" && hasGoogleConnection;
  const canSync = connected && !busy;
  const canManageConnection = hasGoogleConnection && !busy;
  const displayMessage = syncMessage ?? (sync.mode === "off"
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
        <li>{t(language, "googleDriveSyncUsesAppData")}</li>
        <li>{t(language, "googleDriveNoFullDrive")}</li>
        <li>{t(language, "googleDriveManualExportStillWorks")}</li>
      </ul>

      <label className="mt-4 block">
        <span className="mb-1 block text-sm font-semibold">{t(language, "googleDriveSyncMode")}</span>
        <select
          className="field"
          disabled={busy}
          value={sync.mode}
          onChange={(event) => run(() => onSetSyncMode(event.target.value as AuraSyncMode))}
        >
          {syncModeOptions.map((mode) => (
            <option key={mode} value={mode}>
              {t(language, syncModeLabelKeys[mode])}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="font-semibold">{displayMessage}</div>
        {sync.accountEmail || sync.accountName ? (
          <div className="muted mt-1">{sync.accountName ?? sync.accountEmail}</div>
        ) : null}
        {sync.lastSyncedAt ? (
          <div className="muted mt-1">{t(language, "googleDriveLastSynced", { time: formatDateTime(sync.lastSyncedAt) })}</div>
        ) : null}
        {sync.lastCloudUpdatedAt ? (
          <div className="muted mt-1">{t(language, "googleDriveLastCloudUpdate", { time: formatDateTime(sync.lastCloudUpdatedAt) })}</div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button className="btn btn-primary justify-start" disabled={busy} type="button" onClick={() => run(onConnect)}>
          <Cloud size={17} />
          {hasGoogleConnection ? t(language, "googleDriveReconnect") : t(language, "googleDriveConnect")}
        </button>
        <button className="btn btn-secondary justify-start" disabled={!canSync} type="button" onClick={() => run(onSyncNow)}>
          <RefreshCw size={17} />
          {t(language, "googleDriveSyncNow")}
        </button>
        <button className="btn btn-secondary justify-start" disabled={!canSync} type="button" onClick={() => run(onBackup)}>
          <Upload size={17} />
          {t(language, "googleDriveBackupToDrive")}
        </button>
        <button className="btn btn-secondary justify-start" disabled={!canSync} type="button" onClick={() => run(onRestore)}>
          <Download size={17} />
          {t(language, "googleDriveRestoreFromDrive")}
        </button>
        <button
          className="btn btn-danger justify-start"
          disabled={!canManageConnection}
          type="button"
          onClick={() => setPendingConfirm("delete_sync_file")}
        >
          <Trash2 size={17} />
          {t(language, "googleDriveDeleteSyncFile")}
        </button>
        <button
          className="btn btn-secondary justify-start"
          disabled={!canManageConnection}
          type="button"
          onClick={() => setPendingConfirm("disconnect")}
        >
          <XCircle size={17} />
          {t(language, "googleDriveDisconnectAccount")}
        </button>
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

      <ConfirmDialog
        cancelLabel={t(language, "cancel")}
        confirmLabel={pendingConfirm === "delete_sync_file" ? t(language, "delete") : t(language, "googleDriveDisconnectAccount")}
        message={
          pendingConfirm === "delete_sync_file"
            ? t(language, "googleDriveDeleteSyncFileConfirmMessage")
            : t(language, "googleDriveDisconnectConfirmMessage")
        }
        open={pendingConfirm !== null}
        title={
          pendingConfirm === "delete_sync_file"
            ? t(language, "googleDriveDeleteSyncFile")
            : t(language, "googleDriveDisconnectAccount")
        }
        onCancel={() => setPendingConfirm(null)}
        onConfirm={async () => {
          const action = pendingConfirm === "delete_sync_file" ? onDeleteSyncFile : onDisconnect;
          setPendingConfirm(null);
          await runConfirmed(action);
        }}
      />
    </div>
  );
}
