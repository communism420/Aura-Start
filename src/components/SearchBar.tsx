import { Search, X } from "lucide-react";
import { forwardRef } from "react";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";
import type { SearchQuickFilter } from "../utils/search";

type SearchBarProps = {
  filter: SearchQuickFilter;
  language: AuraLanguage;
  resultCount?: number;
  value: string;
  visible: boolean;
  hint?: string;
  onChange: (value: string) => void;
  onFilterChange: (filter: SearchQuickFilter) => void;
};

const filterOptions: SearchQuickFilter[] = ["all", "title", "url", "tag"];

function filterLabel(language: AuraLanguage, filter: SearchQuickFilter): string {
  switch (filter) {
    case "all":
      return t(language, "searchFilter_all");
    case "tag":
      return t(language, "searchFilter_tag");
    case "title":
      return t(language, "searchFilter_title");
    case "url":
      return t(language, "searchFilter_url");
  }
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { filter, language, resultCount, value, visible, hint, onChange, onFilterChange },
  ref
) {
  if (!visible) return null;

  return (
    <div className="search-control">
      <label className="flex w-full items-center gap-2">
        <span className="sr-only">{t(language, "searchLinks")}</span>
        <Search aria-hidden="true" className="shrink-0 text-[var(--muted)]" size={18} />
        <span className="relative min-w-0 flex-1">
          <input
            className="field h-11 pr-10"
            placeholder={t(language, "searchPlaceholder")}
            ref={ref}
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {value ? (
            <button
              aria-label={t(language, "clearSearch")}
              className="btn btn-ghost absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 p-0"
              type="button"
              onClick={() => onChange("")}
            >
              <X size={16} />
            </button>
          ) : null}
        </span>
      </label>
      <div className="search-meta-row">
        <div className="search-filter-list" aria-label={t(language, "searchFilters")}>
          {filterOptions.map((option) => (
            <button
              aria-pressed={filter === option}
              className={`search-filter-button ${filter === option ? "search-filter-button-active" : ""}`}
              key={option}
              type="button"
              onClick={() => onFilterChange(option)}
            >
              {filterLabel(language, option)}
            </button>
          ))}
        </div>
        {typeof resultCount === "number" && value ? (
          <span className="search-result-count">{t(language, "searchResultsCount", { count: resultCount })}</span>
        ) : null}
      </div>
      {hint ? <div className="search-help-row">{hint}</div> : null}
    </div>
  );
});
