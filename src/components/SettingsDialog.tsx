import { Download, RotateCcw, Upload } from "lucide-react";
import { languageOptions, t } from "../i18n";
import type { AuraStartData, AuraStartSettings } from "../types";
import { ExportMenu } from "./ExportMenu";
import { Modal } from "./Modal";

type SettingsDialogProps = {
  open: boolean;
  data: AuraStartData;
  onClose: () => void;
  onUpdateSettings: (settings: Partial<AuraStartSettings>) => Promise<void>;
  onOpenImport: () => void;
  onOpenRestorePoints: () => void;
  onReset: () => void;
  onError: (message: string) => void;
};

const columnOptions = ["auto", 1, 2, 3, 4, 5, 6] as const;

export function SettingsDialog({
  open,
  data,
  onClose,
  onUpdateSettings,
  onOpenImport,
  onOpenRestorePoints,
  onReset,
  onError
}: SettingsDialogProps) {
  const settings = data.settings;
  const language = settings.language;

  function update(settingsPatch: Partial<AuraStartSettings>) {
    void onUpdateSettings(settingsPatch).catch((error: unknown) =>
      onError(error instanceof Error ? error.message : t(language, "couldNotUpdateSettings"))
    );
  }

  return (
    <Modal open={open} title={t(language, "settings")} description={t(language, "settingsDescription")} closeLabel={t(language, "closeDialog")} onClose={onClose} size="lg">
      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <section className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "theme")}</span>
            <select className="field" value={settings.theme} onChange={(event) => update({ theme: event.target.value as AuraStartSettings["theme"] })}>
              <option value="system">{t(language, "system")}</option>
              <option value="light">{t(language, "light")}</option>
              <option value="dark">{t(language, "dark")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "language")}</span>
            <select className="field" value={settings.language} onChange={(event) => update({ language: event.target.value as AuraStartSettings["language"] })}>
              {languageOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{t(language, "columns")}</span>
            <select
              className="field"
              value={String(settings.columns)}
              onChange={(event) => {
                const value = event.target.value;
                update({ columns: value === "auto" ? "auto" : (Number(value) as AuraStartSettings["columns"]) });
              }}
            >
              {columnOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "auto" ? t(language, "auto") : option}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-3">
            {[
              ["compactMode", t(language, "compactMode")],
              ["openLinksInNewTab", t(language, "openLinksInNewTab")],
              ["showDescriptions", t(language, "showDescriptions")],
              ["showSearch", t(language, "showSearch")],
              ["autoRestorePoints", t(language, "updateAutomaticRestoreSafety")]
            ].map(([key, label]) => (
              <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] p-3" key={key}>
                <span className="text-sm font-semibold">{label}</span>
                <input
                  checked={Boolean(settings[key as keyof AuraStartSettings])}
                  type="checkbox"
                  onChange={(event) =>
                    update({ [key]: event.target.checked } as Partial<AuraStartSettings>)
                  }
                />
              </label>
            ))}
          </div>
        </section>
        <section className="space-y-3">
          <div className="surface-flat rounded-xl p-4">
            <h3 className="font-semibold">{t(language, "dataOwnership")}</h3>
            <p className="muted mt-1 text-sm leading-6">{t(language, "dataOwnershipDescription")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ExportMenu data={data} onError={onError} />
              <button className="btn btn-secondary" type="button" onClick={onOpenImport}>
                <Upload size={17} />
                {t(language, "import")}
              </button>
            </div>
          </div>
          <button className="btn btn-secondary w-full justify-start" type="button" onClick={onOpenRestorePoints}>
            <RotateCcw size={17} />
            {t(language, "restorePoints")}
          </button>
          <button className="btn btn-secondary w-full justify-start" type="button" onClick={onOpenImport}>
            <Download size={17} />
            {t(language, "importBackup")}
          </button>
          <button className="btn btn-danger w-full justify-start" type="button" onClick={onReset}>
            {t(language, "resetAllData")}
          </button>
        </section>
      </div>
    </Modal>
  );
}
