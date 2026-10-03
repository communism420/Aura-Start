import { DEFAULT_SETTINGS, DATA_VERSION } from "../constants";
import { isAuraLanguage } from "../i18n";
import type { AuraLanguage, AuraStartData } from "../types";
import { nowIso } from "./dates";
import { createId } from "./ids";
import { SHARED_SETTING_PATHS } from "./settingsSchema";

function detectDefaultLanguage(): AuraLanguage {
  if (typeof navigator === "undefined") {
    return DEFAULT_SETTINGS.language;
  }

  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const code = candidate.toLowerCase().split("-")[0];
    if (isAuraLanguage(code)) {
      return code;
    }
  }

  return DEFAULT_SETTINGS.language;
}

export function createEmptyData(): AuraStartData {
  return {
    version: DATA_VERSION,
    updatedAt: nowIso(),
    settingsCompatibility: { version: 1, defaulted: [...SHARED_SETTING_PATHS], preserved: {} },
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      language: detectDefaultLanguage(),
      sync: {
        ...DEFAULT_SETTINGS.sync,
        deviceId: createId("device")
      }
    },
    groups: [],
    restorePoints: []
  };
}
