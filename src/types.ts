export type AuraTheme = "light" | "dark" | "system";
export type AuraColumns = "auto" | 1 | 2 | 3 | 4 | 5 | 6;
export type AuraLanguage = "en" | "ru" | "es" | "de" | "fr" | "pt" | "uk";
export type AuraSyncMode = "off" | "manual" | "auto";
export type AuraSyncStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "syncing"
  | "error"
  | "conflict";

export type AuraSyncSettings = {
  mode: AuraSyncMode;
  deviceId: string;
  lastSyncedAt?: string;
  lastCloudUpdatedAt?: string;
  accountEmail?: string;
  accountName?: string;
  accountAvatarUrl?: string;
  cloudFileId?: string;
  connected?: boolean;
  deleteCloudFileOnDisconnect: boolean;
};

export type AuraStartSettings = {
  theme: AuraTheme;
  language: AuraLanguage;
  columns: AuraColumns;
  compactMode: boolean;
  openLinksInNewTab: boolean;
  showDescriptions: boolean;
  showSearch: boolean;
  showVersionInHeader: boolean;
  autoRestorePoints: boolean;
  sync: AuraSyncSettings;
};

export type AuraStartLink = {
  id: string;
  title: string;
  url: string;
  description?: string;
  tags?: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type AuraStartGroup = {
  id: string;
  title: string;
  collapsed: boolean;
  order: number;
  links: AuraStartLink[];
};

export type AuraRestorePointReason =
  | "manual"
  | "before_import"
  | "before_delete"
  | "before_reset"
  | "auto";

export type AuraStartDataWithoutRestorePoints = Omit<AuraStartData, "restorePoints">;

export type AuraRestorePoint = {
  id: string;
  name: string;
  createdAt: string;
  reason: AuraRestorePointReason;
  data: AuraStartDataWithoutRestorePoints;
};

export type AuraStartData = {
  version: 1;
  updatedAt: string;
  settings: AuraStartSettings;
  groups: AuraStartGroup[];
  restorePoints: AuraRestorePoint[];
};

export type ImportMode = "replace" | "merge";
export type AuraSyncConflictChoice = "keep_local" | "keep_cloud";

export type AuraSyncConflict = {
  detectedAt: string;
  localUpdatedAt: string;
  cloudUpdatedAt: string;
  cloudFileId?: string;
  cloudData: AuraStartData;
};
