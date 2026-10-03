import type { AuraStartData } from "../types";
import { collectBackgroundImageBackup } from "./backgroundImageBackup";
import { collectTimerSoundBackup } from "./timerSoundBackup";
import { dateForFile } from "./dates";
import { downloadTextFile } from "./download";
import { PortableJsonBudget } from "./portableJsonSize";
import { validateAuraData } from "./importJson";
import { normalizeSharedSettings } from "./settingsSchema";

export function createJsonBackup(data: AuraStartData): string {
  return JSON.stringify(data, null, 2);
}

/** Media-free JSON remains importable on a device without the source assets.
 * Omitted selections are neutral, so importing also preserves a receiver's
 * existing custom background/sound instead of interpreting omission as removal.
 */
export function createSettingsLinksJsonBackup(data: AuraStartData): string {
  const snapshot = structuredClone(validateAuraData(data));
  for (const item of [snapshot, ...snapshot.restorePoints.map((point) => point.data)]) {
    const omitted: string[] = [];
    if (item.settings.background.customImageId) {
      item.settings.background.customImageId = null;
      omitted.push("background.customImageId");
    }
    if (item.settings.background.preset === "custom") {
      item.settings.background.preset = "none";
      omitted.push("background.preset");
    }
    if (item.settings.timer.customSoundId) {
      item.settings.timer.customSoundId = null;
      omitted.push("timer.customSoundId");
    }
    const { settingsCompatibility } = normalizeSharedSettings(item.settings, item.settingsCompatibility);
    settingsCompatibility.defaulted = [...new Set([...settingsCompatibility.defaulted, ...omitted])].sort();
    for (const path of omitted) {
      delete settingsCompatibility.preserved[path];
      if (item === snapshot && snapshot.syncReplica) delete snapshot.syncReplica.settings[path];
    }
    item.settingsCompatibility = settingsCompatibility;
  }
  new PortableJsonBudget().add(snapshot);
  return JSON.stringify(snapshot, null, 2);
}

export function exportSettingsLinksJson(data: AuraStartData): void {
  downloadTextFile(`aura-start-settings-links-${dateForFile()}.json`,
    createSettingsLinksJsonBackup(data), "application/json;charset=utf-8");
}

export async function createPortableJsonBackup(data: AuraStartData): Promise<string> {
  const snapshot = structuredClone(data);
  const budget = new PortableJsonBudget();
  budget.add(snapshot);
  const backgroundImages = await collectBackgroundImageBackup(snapshot);
  if (Object.keys(backgroundImages).length) budget.add({ backgroundImages });
  const timerSounds = await collectTimerSoundBackup(snapshot, budget);
  return JSON.stringify({
    ...snapshot,
    ...(Object.keys(backgroundImages).length ? { backgroundImages } : {}),
    ...(Object.keys(timerSounds).length ? { timerSounds } : {})
  }, null, 2);
}

export async function exportJsonBackup(data: AuraStartData): Promise<void> {
  const backup = await createPortableJsonBackup(data);
  downloadTextFile(
    `aura-start-backup-${dateForFile()}.json`,
    backup,
    "application/json;charset=utf-8"
  );
}
