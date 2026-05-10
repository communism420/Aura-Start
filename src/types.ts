export type AuraTheme = "light" | "dark" | "system";
export type AuraColumns = "auto" | 1 | 2 | 3 | 4 | 5 | 6;
export type AuraLanguage = "en" | "ru" | "es" | "de" | "fr" | "pt" | "uk";

export type AuraStartSettings = {
  theme: AuraTheme;
  language: AuraLanguage;
  columns: AuraColumns;
  compactMode: boolean;
  openLinksInNewTab: boolean;
  showDescriptions: boolean;
  showSearch: boolean;
  autoRestorePoints: boolean;
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
