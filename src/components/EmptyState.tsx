import { Download, FolderPlus, LinkIcon } from "lucide-react";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";

type EmptyStateProps = {
  language: AuraLanguage;
  mode: "empty" | "search";
  onAddGroup: () => void;
  onAddLink: () => void;
  onImport: () => void;
};

export function EmptyState({ language, mode, onAddGroup, onAddLink, onImport }: EmptyStateProps) {
  if (mode === "search") {
    return (
      <div className="initial-view">
        <h1>{t(language, "noMatchingLinks")}</h1>
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
          {t(language, "addGroup")}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onAddLink}>
          <LinkIcon size={17} />
          {t(language, "addLink")}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onImport}>
          <Download size={17} />
          {t(language, "import")}
        </button>
      </div>
    </div>
  );
}
