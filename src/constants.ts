import type { AuraStartSettings } from "./types";

export const DATA_VERSION = 1 as const;
export const STORAGE_KEY = "aura-start-data-v1";
export const MAX_RESTORE_POINTS = 20;

export const DEFAULT_SETTINGS: AuraStartSettings = {
  theme: "system",
  language: "en",
  columns: "auto",
  compactMode: false,
  openLinksInNewTab: false,
  showDescriptions: true,
  showSearch: true,
  autoRestorePoints: true,
  sync: {
    mode: "off",
    deviceId: "",
    connected: false
  }
};
