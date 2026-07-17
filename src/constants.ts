import type { AuraStartSettings } from "./types";

export const DATA_VERSION = 1 as const;
export const STORAGE_KEY = "aura-start-data-v1";
export const UI_STATE_STORAGE_KEY = "aura-start-ui-state-v1";
export const MAX_RESTORE_POINTS = 20;

export const DEFAULT_SETTINGS: AuraStartSettings = {
  theme: "system",
  language: "en",
  columns: "auto",
  compactMode: false,
  openLinksInNewTab: false,
  showDescriptions: true,
  showSearch: true,
  showVersionInHeader: true,
  captureOpenTabs: false,
  background: {
    preset: "none",
    blur: 0,
    dim: 22,
    position: "center"
  },
  widgets: {
    clock: false,
    notes: false,
    pomodoro: false
  },
  pomodoro: {
    focusMinutes: 25,
    breakMinutes: 5
  },
  autoRestorePoints: true,
  sync: {
    mode: "off",
    deviceId: "",
    connected: false,
    reconnectRequired: false,
    deleteCloudFileOnDisconnect: true
  }
};
