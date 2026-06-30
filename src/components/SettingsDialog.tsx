import {
  Database,
  ExternalLink,
  FileUp,
  HelpCircle,
  Image as ImageIcon,
  Keyboard,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  Upload,
  X
} from "lucide-react";
import { languageOptions, t } from "../i18n";
import type {
  AuraStartData,
  AuraStartSettings,
  AuraSyncConflict,
  AuraSyncConflictChoice,
  AuraSyncStatus
} from "../types";
import { getAuraStartVersion } from "../utils/appVersion";
import { BUILTIN_BACKGROUNDS } from "../utils/backgrounds";
import { ExportMenu } from "./ExportMenu";
import { GoogleDriveSyncPanel } from "./GoogleDriveSyncPanel";
import { Modal } from "./Modal";

type SettingsDialogProps = {
  open: boolean;
  data: AuraStartData;
  syncStatus: AuraSyncStatus;
  syncMessage: string | null;
  syncConflict: AuraSyncConflict | null;
  onClose: () => void;
  onUpdateSettings: (settings: Partial<AuraStartSettings>) => Promise<void>;
  onOpenImport: () => void;
  onOpenImportAFineStart: () => void;
  onOpenDuplicateFinder: () => void;
  onOpenRestorePoints: () => void;
  onOpenOnboarding: () => void;
  onReset: () => void;
  hasDemoData: boolean;
  customBackgroundImage: string | null;
  onSetCustomBackgroundImage: (image: string | null) => void;
  onRemoveDemoData: () => void;
  onConnectGoogleDrive: () => Promise<void>;
  onDisconnectGoogleDrive: () => Promise<void>;
  onDeleteGoogleDriveBackupAndDisconnect: () => Promise<void>;
  onResolveSyncConflict: (choice: AuraSyncConflictChoice) => Promise<void>;
  onError: (message: string) => void;
};

const columnOptions = ["auto", 1, 2, 3, 4, 5, 6] as const;
const privacyPolicyUrl = "https://github.com/communism420/Aura-Start/blob/main/PRIVACY.md";
const maxCustomBackgroundBytes = 2_000_000;

export function SettingsDialog({
  open,
  data,
  syncStatus,
  syncMessage,
  syncConflict,
  onClose,
  onUpdateSettings,
  onOpenImport,
  onOpenImportAFineStart,
  onOpenDuplicateFinder,
  onOpenRestorePoints,
  onOpenOnboarding,
  onReset,
  hasDemoData,
  customBackgroundImage,
  onSetCustomBackgroundImage,
  onRemoveDemoData,
  onConnectGoogleDrive,
  onDisconnectGoogleDrive,
  onDeleteGoogleDriveBackupAndDisconnect,
  onResolveSyncConflict,
  onError
}: SettingsDialogProps) {
  const settings = data.settings;
  const language = settings.language;
  const appVersion = getAuraStartVersion();
  const privacyPromises = [
    t(language, "noAnalytics"),
    t(language, "noTracking"),
    t(language, "noAds"),
    t(language, "noBackend"),
    t(language, "noRequiredAccount"),
    t(language, "noBrowserHistoryPermission"),
    t(language, "noBrowserBookmarksPermission"),
    t(language, "driveSyncOptionalOffByDefault"),
    t(language, "driveSyncAppDataFolderOnly")
  ];
  const shortcuts = [
    ["Ctrl/⌘ K", t(language, "shortcutOpenCommandPalette")],
    ["/", t(language, "shortcutFocusSearch")],
    ["Esc", t(language, "shortcutClearSearch")],
    ["Enter", t(language, "shortcutOpenSelectedResult")],
    ["E", t(language, "shortcutToggleEditMode")],
    ["N", t(language, "shortcutCreateNewLink")],
    ["G", t(language, "shortcutCreateNewGroup")]
  ];

  function update(settingsPatch: Partial<AuraStartSettings>) {
    void onUpdateSettings(settingsPatch).catch((error: unknown) =>
      onError(error instanceof Error ? error.message : t(language, "couldNotUpdateSettings"))
    );
  }

  function updateBackground(backgroundPatch: Partial<AuraStartSettings["background"]>) {
    update({ background: { ...settings.background, ...backgroundPatch } });
  }

  function updateWidgets(widgetPatch: Partial<AuraStartSettings["widgets"]>) {
    update({ widgets: { ...settings.widgets, ...widgetPatch } });
  }

  function updatePomodoro(pomodoroPatch: Partial<AuraStartSettings["pomodoro"]>) {
    update({ pomodoro: { ...settings.pomodoro, ...pomodoroPatch } });
  }

  function handleBackgroundUpload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError(t(language, "backgroundUploadImageOnly"));
      return;
    }
    if (file.size > maxCustomBackgroundBytes) {
      onError(t(language, "backgroundUploadTooLarge"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => onError(t(language, "backgroundUploadFailed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) {
        onError(t(language, "backgroundUploadFailed"));
        return;
      }

      onSetCustomBackgroundImage(result);
      updateBackground({ preset: "custom" });
    };
    reader.readAsDataURL(file);
  }

  return (
    <Modal open={open} title={t(language, "settings")} description={t(language, "settingsDescription")} closeLabel={t(language, "closeDialog")} onClose={onClose} size="xl">
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
              ["showDescriptions", t(language, "showDescriptions")],
              ["showSearch", t(language, "showSearch")],
              ["showVersionInHeader", t(language, "showVersionInHeader")],
              ["captureOpenTabs", t(language, "captureOpenTabs")],
              ["openLinksInNewTab", t(language, "openLinksInNewTab")]
            ].map(([key, label]) => (
              <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] p-3" key={key}>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  {key === "openLinksInNewTab" ? (
                    <span className="muted block text-xs">{t(language, "openLinksInNewTabDescription")}</span>
                  ) : null}
                  {key === "showVersionInHeader" ? (
                    <span className="muted block text-xs">{t(language, "showVersionInHeaderDescription")}</span>
                  ) : null}
                  {key === "captureOpenTabs" ? (
                    <span className="muted block text-xs">{t(language, "captureOpenTabsDescription")}</span>
                  ) : null}
                </span>
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
          <div className="surface-flat rounded-xl p-4">
            <div className="flex items-center gap-2">
              <ImageIcon className="text-[var(--accent)]" size={18} />
              <h3 className="font-semibold">{t(language, "backgrounds")}</h3>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-semibold">{t(language, "backgroundImage")}</span>
              <select
                className="field"
                value={settings.background.preset}
                onChange={(event) => updateBackground({ preset: event.target.value as AuraStartSettings["background"]["preset"] })}
              >
                <option value="none">{t(language, "backgroundPresetNone")}</option>
                {BUILTIN_BACKGROUNDS.map((background) => (
                  <option key={background.id} value={background.id}>
                    {t(language, background.labelKey)}
                  </option>
                ))}
                <option value="custom">{t(language, "backgroundPresetCustom")}</option>
              </select>
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">{t(language, "backgroundBlur")}</span>
                <input
                  className="field"
                  max={18}
                  min={0}
                  type="range"
                  value={settings.background.blur}
                  onChange={(event) => updateBackground({ blur: Number(event.target.value) })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">{t(language, "backgroundDim")}</span>
                <input
                  className="field"
                  max={80}
                  min={0}
                  type="range"
                  value={settings.background.dim}
                  onChange={(event) => updateBackground({ dim: Number(event.target.value) })}
                />
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-semibold">{t(language, "backgroundPosition")}</span>
              <select
                className="field"
                value={settings.background.position}
                onChange={(event) => updateBackground({ position: event.target.value as AuraStartSettings["background"]["position"] })}
              >
                <option value="center">{t(language, "positionCenter")}</option>
                <option value="top">{t(language, "positionTop")}</option>
                <option value="bottom">{t(language, "positionBottom")}</option>
                <option value="left">{t(language, "positionLeft")}</option>
                <option value="right">{t(language, "positionRight")}</option>
              </select>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="btn btn-secondary cursor-pointer">
                <Upload size={17} />
                {t(language, "uploadBackground")}
                <input
                  accept="image/*"
                  className="sr-only"
                  type="file"
                  onChange={(event) => {
                    handleBackgroundUpload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {customBackgroundImage ? (
                <button className="btn btn-secondary" type="button" onClick={() => onSetCustomBackgroundImage(null)}>
                  <X size={17} />
                  {t(language, "removeBackground")}
                </button>
              ) : null}
            </div>
          </div>
          <div className="surface-flat rounded-xl p-4">
            <h3 className="font-semibold">{t(language, "widgets")}</h3>
            <div className="mt-3 space-y-3">
              {[
                ["clock", t(language, "widgetClock"), t(language, "widgetClockDescription")],
                ["notes", t(language, "widgetNotes"), t(language, "widgetNotesDescription")],
                ["pomodoro", t(language, "widgetPomodoro"), t(language, "widgetPomodoroDescription")]
              ].map(([key, label, description]) => (
                <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] p-3" key={key}>
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="muted block text-xs">{description}</span>
                  </span>
                  <input
                    checked={Boolean(settings.widgets[key as keyof AuraStartSettings["widgets"]])}
                    type="checkbox"
                    onChange={(event) => updateWidgets({ [key]: event.target.checked } as Partial<AuraStartSettings["widgets"]>)}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">{t(language, "pomodoroFocusMinutes")}</span>
                <input
                  className="field"
                  max={90}
                  min={5}
                  type="number"
                  value={settings.pomodoro.focusMinutes}
                  onChange={(event) => updatePomodoro({ focusMinutes: Number(event.target.value) })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">{t(language, "pomodoroBreakMinutes")}</span>
                <input
                  className="field"
                  max={30}
                  min={1}
                  type="number"
                  value={settings.pomodoro.breakMinutes}
                  onChange={(event) => updatePomodoro({ breakMinutes: Number(event.target.value) })}
                />
              </label>
            </div>
          </div>
        </section>
        <section className="space-y-3">
          <div className="surface-flat rounded-xl p-4">
            <h3 className="font-semibold">{t(language, "aboutAuraStart")}</h3>
            <table className="settings-info-table mt-3">
              <tbody>
                <tr>
                  <th scope="row">{t(language, "appVersion")}</th>
                  <td>
                    <code>v{appVersion}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="surface-flat rounded-xl p-4">
            <h3 className="font-semibold">{t(language, "dataOwnership")}</h3>
            <p className="muted mt-1 text-sm leading-6">{t(language, "dataOwnershipDescription")}</p>
          </div>
          <div className="surface-flat rounded-xl p-4">
            <h3 className="font-semibold">{t(language, "tools")}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-secondary" type="button" onClick={onOpenDuplicateFinder}>
                <SearchCheck size={17} />
                {t(language, "duplicateFinder")}
              </button>
              <ExportMenu data={data} onError={onError} />
              <button className="btn btn-secondary" type="button" onClick={onOpenImport}>
                <Upload size={17} />
                {t(language, "importBackup")}
              </button>
              <button className="btn btn-secondary" type="button" onClick={onOpenImportAFineStart}>
                <FileUp size={17} />
                {t(language, "importFromAFineStart")}
              </button>
              <button className="btn btn-secondary" type="button" onClick={onOpenRestorePoints}>
                <RotateCcw size={17} />
                {t(language, "restoreTimeline")}
              </button>
            </div>
          </div>
          <div className="surface-flat rounded-xl p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-[var(--accent)]" size={18} />
              <h3 className="font-semibold">{t(language, "privacyPromise")}</h3>
            </div>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {privacyPromises.map((promise) => (
                <li className="flex items-start gap-2" key={promise}>
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{promise}</span>
                </li>
              ))}
            </ul>
            <a
              className="btn btn-secondary mt-4"
              href={privacyPolicyUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink size={16} />
              {t(language, "privacyPolicy")}
            </a>
          </div>
          <div className="surface-flat rounded-xl p-4">
            <div className="flex items-center gap-2">
              <Keyboard className="text-[var(--accent)]" size={18} />
              <h3 className="font-semibold">{t(language, "keyboardShortcuts")}</h3>
            </div>
            <p className="muted mt-1 text-sm">{t(language, "searchShortcuts")}: {t(language, "pressSlashToSearch")} · {t(language, "pressEscToClear")}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {shortcuts.map(([shortcut, label]) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2" key={shortcut}>
                  <span className="muted">{label}</span>
                  <kbd className="shortcut-key">{shortcut}</kbd>
                </div>
              ))}
            </div>
            <p className="muted mt-3 text-sm">{t(language, "commandPaletteShortcutNote")}</p>
            <div className="muted mt-3 text-sm">
              <div className="font-semibold text-[var(--text)]">{t(language, "searchModifiers")}</div>
              <div className="mt-1">{t(language, "searchModifiersExamples")}</div>
            </div>
          </div>
          <button className="btn btn-secondary w-full justify-start" type="button" onClick={onOpenOnboarding}>
            <HelpCircle size={17} />
            {t(language, "openOnboardingHelpAgain")}
          </button>
          {hasDemoData ? (
            <button className="btn btn-secondary w-full justify-start" type="button" onClick={onRemoveDemoData}>
              <Database size={17} />
              {t(language, "removeDemoData")}
            </button>
          ) : null}
          <button className="btn btn-danger w-full justify-start" type="button" onClick={onReset}>
            {t(language, "resetAllData")}
          </button>
        </section>
        <section className="lg:col-span-2">
          <GoogleDriveSyncPanel
            data={data}
            syncConflict={syncConflict}
            syncMessage={syncMessage}
            syncStatus={syncStatus}
            onConnect={onConnectGoogleDrive}
            onDisconnect={onDisconnectGoogleDrive}
            onDeleteBackupAndDisconnect={onDeleteGoogleDriveBackupAndDisconnect}
            onError={onError}
            onUpdateSyncSettings={(syncPatch) => update({ sync: { ...settings.sync, ...syncPatch } })}
            onResolveConflict={onResolveSyncConflict}
          />
        </section>
      </div>
    </Modal>
  );
}
