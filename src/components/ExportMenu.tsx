import { ChevronDown, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { exportAFineStartCode } from "../utils/exportAFineStart";
import { exportCsv } from "../utils/exportCsv";
import { exportHtmlBookmarks } from "../utils/exportHtmlBookmarks";
import { exportJsonBackup } from "../utils/exportJson";
import { exportMarkdown } from "../utils/exportMarkdown";

type ExportMenuProps = {
  data: AuraStartData;
  onError: (message: string) => void;
};

export function ExportMenu({ data, onError }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const language = data.settings.language;
  const fullBackupJsonLabel = t(language, "fullBackupJson");
  const htmlBookmarksLabel = t(language, "htmlBookmarks");
  const markdownLabel = t(language, "markdown");
  const csvLabel = t(language, "csv");
  const aFineStartLabel = t(language, "aFineStartExportCode");
  const exportOptions = [
    {
      label: htmlBookmarksLabel,
      description: t(language, "exportHtmlDescription"),
      action: exportHtmlBookmarks
    },
    {
      label: markdownLabel,
      description: t(language, "exportMarkdownDescription"),
      action: exportMarkdown
    },
    {
      label: csvLabel,
      description: t(language, "exportCsvDescription"),
      action: exportCsv
    },
    {
      label: aFineStartLabel,
      description: t(language, "exportAFineStartDescription"),
      action: exportAFineStartCode
    }
  ];

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const runExport = (label: string, action: (value: AuraStartData) => void) => {
    try {
      action(data);
      setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "exportFormatFailed", { label }));
    }
  };

  return (
    <div className="export-menu relative" ref={menuRef}>
      <button className="btn btn-secondary" type="button" onClick={() => setOpen((value) => !value)}>
        <Download size={17} />
        {t(language, "export")}
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="export-menu-popover surface absolute right-0 top-12 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl p-3">
          <div className="mb-3">
            <div className="text-sm font-semibold">{t(language, "exportBackupTitle")}</div>
            <p className="muted mt-1 text-xs leading-5">{t(language, "exportTrustMessage")}</p>
          </div>
          <button
            className="btn btn-primary mb-2 h-auto w-full items-start justify-start px-3 py-2 text-left"
            type="button"
            onClick={() => runExport(fullBackupJsonLabel, exportJsonBackup)}
          >
            <Download className="mt-0.5 shrink-0" size={16} />
            <span>
              <span className="block text-sm font-semibold">{t(language, "exportAllData")}</span>
              <span className="block text-xs font-normal leading-5 opacity-90">
                {fullBackupJsonLabel}: {t(language, "exportJsonDescription")}
              </span>
            </span>
          </button>
          <div className="space-y-1">
            {exportOptions.map((option) => (
              <button
                className="btn btn-ghost h-auto w-full flex-col items-start justify-start gap-1 px-3 py-2 text-left"
                key={option.label}
                type="button"
                onClick={() => runExport(option.label, option.action)}
              >
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="muted text-xs leading-5">{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
