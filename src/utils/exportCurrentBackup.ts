import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { hasUnsavedWidgetNotes } from "../store/useAuraStore";
import { exportSettingsLinksJson } from "./exportJson";
import { loadAuraData } from "./storage";
import { exportZipBackup } from "./zipBackup";

async function currentSnapshot(fallback: AuraStartData): Promise<AuraStartData> {
  // Reading under the storage lock waits for queued notes/settings writes and
  // finishes legacy media migration before a current-data backup is captured.
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error(t(fallback.settings.language, "couldNotExportBackup"));
  if (loaded.backgroundMigrationError || loaded.notesMigrationError) {
    throw new Error(t(loaded.data.settings.language,
      loaded.notesMigrationError ? "notesMigrationFailed" : "backgroundMigrationFailed"));
  }
  if (hasUnsavedWidgetNotes()) throw new Error(t(loaded.data.settings.language, "notesSaveFailed"));
  return loaded.data;
}

export async function exportCurrentZipBackup(data: AuraStartData): Promise<void> {
  await exportZipBackup(await currentSnapshot(data));
}

export async function exportCurrentSettingsLinksJson(data: AuraStartData): Promise<void> {
  exportSettingsLinksJson(await currentSnapshot(data));
}
