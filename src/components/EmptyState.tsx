import { Database, Download, FolderPlus, FileUp } from "lucide-react";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";

type EmptyStateProps = {
  language: AuraLanguage;
  mode: "empty" | "search";
  onAddGroup: () => void;
  onAddDemoData: () => void;
  onImportAFineStart: () => void;
  onImportBackup: () => void;
};

export function EmptyState({
  language,
  mode,
  onAddGroup,
  onAddDemoData,
  onImportAFineStart,
  onImportBackup
}: EmptyStateProps) {
  if (mode === "search") {
    return (
      <div className="initial-view">
        <h1>{t(language, "noResults")}</h1>
        <p className="muted">{t(language, "searchDescription")}</p>
      </div>
    );
  }

  return (
    <div className="initial-view">
      <h1>{t(language, "hiThere")}</h1>
      <p>{t(language, "onboardingDescription")}</p>
      <div className="initial-actions">
        <button className="btn btn-primary" type="button" onClick={onAddGroup}>
          <FolderPlus size={17} />
          {t(language, "createYourFirstGroup")}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onImportAFineStart}>
          <FileUp size={17} />
          {t(language, "importFromAFineStart")}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onImportBackup}>
          <Download size={17} />
          {t(language, "importBackupFile")}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onAddDemoData}>
          <Database size={17} />
          {t(language, "addDemoGroups")}
        </button>
      </div>
    </div>
  );
}
