import { AlertCircle, Cloud, Command, FolderPlus, LinkIcon, Pencil, RefreshCw, Search, Settings, Upload } from "lucide-react";
import type { RefObject } from "react";
import { t } from "../i18n";
import type { AuraStartData, AuraSyncStatus } from "../types";
import { getAuraStartVersion } from "../utils/appVersion";
import { formatDateTime } from "../utils/dates";
import { ExportMenu } from "./ExportMenu";
import { SearchBar } from "./SearchBar";

type HeaderProps = {
  data: AuraStartData;
  search: string;
  searchOpen: boolean;
  editMode: boolean;
  syncStatus: AuraSyncStatus;
  syncMessage: string | null;
  searchInputRef: RefObject<HTMLInputElement>;
  onSearchChange: (value: string) => void;
  onOpenSearch: () => void;
  onToggleEditMode: () => void;
  onOpenCommandPalette: () => void;
  onAddGroup: () => void;
  onAddLink: () => void;
  onOpenSettings: () => void;
  onOpenImport: () => void;
  onExportError: (message: string) => void;
};

export function Header({
  data,
  search,
  searchOpen,
  editMode,
  syncStatus,
  syncMessage,
  searchInputRef,
  onSearchChange,
  onOpenSearch,
  onToggleEditMode,
  onOpenCommandPalette,
  onAddGroup,
  onAddLink,
  onOpenSettings,
  onOpenImport,
  onExportError
}: HeaderProps) {
  const linkCount = data.groups.reduce((total, group) => total + group.links.length, 0);
  const searchVisible = data.settings.showSearch && (searchOpen || search.length > 0);
  const language = data.settings.language;
  const sync = data.settings.sync;
  const showSyncMarker = sync.mode !== "off" && Boolean(sync.connected);
  const syncMarkerLabel = sync.accountName ?? sync.accountEmail ?? t(language, "googleDriveConnectedShort");
  const appVersion = getAuraStartVersion();
  const syncMarkerTitle = [
    syncStatus === "syncing"
      ? t(language, "googleDriveSyncing")
      : syncStatus === "error"
        ? t(language, "googleDriveSyncFailed")
        : syncStatus === "conflict"
          ? t(language, "googleDriveConflictDetected")
          : t(language, "googleDriveConnected"),
    sync.accountEmail ?? sync.accountName,
    sync.lastSyncedAt ? t(language, "googleDriveLastSynced", { time: formatDateTime(sync.lastSyncedAt) }) : undefined,
    syncMessage
  ].filter(Boolean).join("\n");
  const SyncIcon = syncStatus === "syncing" ? RefreshCw : syncStatus === "error" || syncStatus === "conflict" ? AlertCircle : Cloud;

  return (
    <header className="aura-header">
      <div className="aura-actions">
        <div className="aura-brand" title={t(language, "groupsLinksCount", { groups: data.groups.length, links: linkCount })}>
          <div className="aura-brand-line">
            <img className="aura-logo" src="/logo.png" alt="" aria-hidden="true" />
            <span>Aura Start</span>
            {data.settings.showVersionInHeader ? (
              <span className="aura-version-badge" aria-label={t(language, "appVersion")}>
                v{appVersion}
              </span>
            ) : null}
            <span className="aura-inspired">{t(language, "inspiredBy")}</span>
          </div>
        </div>
        <div className="aura-action-list">
          {data.settings.showSearch ? (
            <button
              className="btn btn-ghost"
              type="button"
              aria-pressed={searchVisible}
              title={t(language, "pressSlashToSearch")}
              onClick={onOpenSearch}
            >
              <Search size={14} />
              {t(language, "search")}
            </button>
          ) : null}
          <button
            className="btn btn-ghost"
            title={t(language, "commandPaletteShortcutNote")}
            type="button"
            onClick={onOpenCommandPalette}
          >
            <Command size={17} />
            {t(language, "commandPalette")}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onAddLink}>
            <LinkIcon size={17} />
            {t(language, "add")}
          </button>
          <button
            aria-label={editMode ? t(language, "disableEditMode") : t(language, "enableEditMode")}
            aria-pressed={editMode}
            className={`btn btn-ghost ${editMode ? "btn-toggle-active" : ""}`}
            type="button"
            onClick={onToggleEditMode}
          >
            <Pencil size={17} />
            {t(language, "edit")}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onAddGroup}>
            <FolderPlus size={17} />
            {t(language, "newGroup")}
          </button>
          <ExportMenu data={data} onError={onExportError} />
          <button className="btn btn-ghost" type="button" onClick={onOpenImport}>
            <Upload size={17} />
            {t(language, "import")}
          </button>
          <div className="aura-settings-cluster">
            <button className="btn btn-ghost" type="button" onClick={onOpenSettings} aria-label={t(language, "openSettings")}>
              <Settings size={17} />
              {t(language, "settings")}
            </button>
            {showSyncMarker ? (
              <button
                className={`sync-account-marker ${
                  syncStatus === "error" || syncStatus === "conflict" ? "sync-account-marker-error" : ""
                } ${syncStatus === "syncing" ? "sync-account-marker-syncing" : ""}`}
                title={syncMarkerTitle}
                type="button"
                onClick={onOpenSettings}
              >
                <SyncIcon size={14} />
                <span>{syncMarkerLabel}</span>
              </button>
            ) : null}
          </div>
        </div>
        <span className="aura-slogan">{t(language, "brandSlogan")}</span>
      </div>
      {searchVisible ? (
      <div className="aura-search-row">
        <SearchBar
          ref={searchInputRef}
          language={language}
          hint={search ? t(language, "pressEscToClear") : t(language, "searchModifiersHint")}
          value={search}
          visible={searchVisible}
          onChange={onSearchChange}
        />
        {search ? (
          <span className="search-mode-label">
            {t(language, "searchMode")}
          </span>
        ) : null}
      </div>
      ) : null}
    </header>
  );
}
