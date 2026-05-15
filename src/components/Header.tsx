import { FolderPlus, LinkIcon, Pencil, Search, Settings, Upload } from "lucide-react";
import type { RefObject } from "react";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { ExportMenu } from "./ExportMenu";
import { SearchBar } from "./SearchBar";

type HeaderProps = {
  data: AuraStartData;
  search: string;
  searchOpen: boolean;
  editMode: boolean;
  searchInputRef: RefObject<HTMLInputElement>;
  onSearchChange: (value: string) => void;
  onOpenSearch: () => void;
  onToggleEditMode: () => void;
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
  searchInputRef,
  onSearchChange,
  onOpenSearch,
  onToggleEditMode,
  onAddGroup,
  onAddLink,
  onOpenSettings,
  onOpenImport,
  onExportError
}: HeaderProps) {
  const linkCount = data.groups.reduce((total, group) => total + group.links.length, 0);
  const searchVisible = data.settings.showSearch && (searchOpen || search.length > 0);
  const language = data.settings.language;

  return (
    <header className="aura-header">
      <div className="aura-actions">
        <div className="aura-brand" title={t(language, "groupsLinksCount", { groups: data.groups.length, links: linkCount })}>
          <div className="aura-brand-line">
            <img className="aura-logo" src="/logo.png" alt="" aria-hidden="true" />
            <span>Aura Start</span>
            <span className="aura-inspired">{t(language, "inspiredBy")}</span>
          </div>
          <span className="aura-slogan">{t(language, "brandSlogan")}</span>
        </div>
        <div className="aura-action-list">
          {data.settings.showSearch ? (
            <button className="btn btn-ghost" type="button" aria-pressed={searchVisible} onClick={onOpenSearch}>
              <Search size={14} />
              {t(language, "search")}
            </button>
          ) : null}
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
          <button className="btn btn-ghost" type="button" onClick={onOpenSettings} aria-label={t(language, "openSettings")}>
            <Settings size={17} />
            {t(language, "settings")}
          </button>
        </div>
      </div>
      {searchVisible ? (
      <div className="aura-search-row">
        <SearchBar
          ref={searchInputRef}
          language={language}
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
