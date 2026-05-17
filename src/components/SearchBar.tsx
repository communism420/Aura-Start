import { Search, X } from "lucide-react";
import { forwardRef } from "react";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";

type SearchBarProps = {
  language: AuraLanguage;
  value: string;
  visible: boolean;
  hint?: string;
  onChange: (value: string) => void;
};

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { language, value, visible, hint, onChange },
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
      {hint ? <div className="search-help-row">{hint}</div> : null}
    </div>
  );
});
