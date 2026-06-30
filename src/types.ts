export type AuraTheme = "light" | "dark" | "system";
export type AuraColumns = "auto" | 1 | 2 | 3 | 4 | 5 | 6;
export type AuraLanguage = "en" | "ru" | "es" | "de" | "fr" | "pt" | "uk";
export type AuraBackgroundPreset = "none" | "aurora" | "dawn" | "forest" | "custom";
export type AuraBackgroundPosition = "center" | "top" | "bottom" | "left" | "right";
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

export type AuraBackgroundSettings = {
  preset: AuraBackgroundPreset;
  blur: number;
  dim: number;
  position: AuraBackgroundPosition;
};

export type AuraWidgetSettings = {
  clock: boolean;
  notes: boolean;
  pomodoro: boolean;
};

export type AuraPomodoroSettings = {
  focusMinutes: number;
  breakMinutes: number;
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
  captureOpenTabs: boolean;
  background: AuraBackgroundSettings;
  widgets: AuraWidgetSettings;
  pomodoro: AuraPomodoroSettings;
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
  parentId: string | null;
  collapsed: boolean;
  order: number;
  links: AuraStartLink[];
};

export type GroupTreeNode = AuraStartGroup & {
  children: GroupTreeNode[];
  depth: number;
};

export type AuraRestorePointReason =
  | "manual"
  | "before_bulk_delete"
  | "before_cloud_restore"
  | "before_demo_remove"
  | "before_duplicate_delete"
  | "before_group_delete"
  | "before_group_move"
  | "before_group_reorder"
  | "before_import"
  | "before_link_delete"
  | "before_link_move"
  | "before_tabs_save"
  | "before_delete"
  | "before_reset"
  | "before_restore"
  | "auto";

export type AuraRestorePointEntity =
  | "data"
  | "demo"
  | "group"
  | "groups"
  | "import"
  | "link"
  | "links"
  | "settings"
  | "sync"
  | "tabs";

export type AuraRestorePointContext = {
  entity?: AuraRestorePointEntity;
  title?: string;
  groupTitle?: string;
  count?: number;
  source?: string;
  from?: string;
  to?: string;
  description?: string;
};

export type AuraStartDataWithoutRestorePoints = Omit<AuraStartData, "restorePoints">;

export type AuraRestorePoint = {
  id: string;
  name: string;
  createdAt: string;
  reason: AuraRestorePointReason;
  context?: AuraRestorePointContext;
  data: AuraStartDataWithoutRestorePoints;
};

export type RestoreTimelineEntry = {
  point: AuraRestorePoint;
  groupCount: number;
  linkCount: number;
};

export type RestoreTimelineDay = {
  day: string;
  entries: RestoreTimelineEntry[];
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
