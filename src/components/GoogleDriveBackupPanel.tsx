import { Cloud, Download, ExternalLink, Upload } from "lucide-react";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { exportJsonBackup } from "../utils/exportJson";

type GoogleDriveBackupPanelProps = {
  data: AuraStartData;
  onImport: () => void;
  onError: (message: string) => void;
};

export function GoogleDriveBackupPanel({ data, onImport, onError }: GoogleDriveBackupPanelProps) {
  const language = data.settings.language;

  function handleExport() {
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
          <h3 className="font-semibold">{t(language, "googleDriveBackupTitle")}</h3>
          <p className="muted mt-1 text-sm leading-6">{t(language, "googleDriveBackupDescription")}</p>
        </div>
        <Cloud className="text-[var(--accent)]" size={20} />
      </div>

      <ul className="muted mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
        <li>{t(language, "googleDriveBackupNoAccountAccess")}</li>
        <li>{t(language, "googleDriveBackupNoTracking")}</li>
        <li>{t(language, "googleDriveBackupOptional")}</li>
        <li>{t(language, "googleDriveBackupManual")}</li>
      </ul>

      <div className="mt-4 rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="font-semibold">{t(language, "googleDriveBackupHowItWorks")}</div>
        <p className="muted mt-1 leading-6">{t(language, "googleDriveBackupHowItWorksDescription")}</p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button className="btn btn-primary justify-start" type="button" onClick={handleExport}>
          <Download size={17} />
          {t(language, "googleDriveBackupExport")}
        </button>
        <button className="btn btn-secondary justify-start" type="button" onClick={onImport}>
          <Upload size={17} />
          {t(language, "googleDriveBackupImport")}
        </button>
        <a
          className="btn btn-secondary justify-start"
          href="https://drive.google.com/drive/my-drive"
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink size={17} />
          {t(language, "googleDriveBackupOpenDrive")}
        </a>
      </div>
    </div>
  );
}
