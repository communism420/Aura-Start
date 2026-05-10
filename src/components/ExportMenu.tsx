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
    <div className="relative" ref={menuRef}>
      <button className="btn btn-secondary" type="button" onClick={() => setOpen((value) => !value)}>
        <Download size={17} />
        {t(language, "export")}
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="surface absolute right-0 top-12 z-20 w-64 rounded-xl p-2">
          <button
            className="btn btn-ghost w-full justify-start"
            type="button"
            onClick={() => runExport(fullBackupJsonLabel, exportJsonBackup)}
          >
            {fullBackupJsonLabel}
          </button>
          <button
            className="btn btn-ghost w-full justify-start"
            type="button"
            onClick={() => runExport(htmlBookmarksLabel, exportHtmlBookmarks)}
          >
            {htmlBookmarksLabel}
          </button>
          <button
            className="btn btn-ghost w-full justify-start"
            type="button"
            onClick={() => runExport(markdownLabel, exportMarkdown)}
          >
            {markdownLabel}
          </button>
          <button
            className="btn btn-ghost w-full justify-start"
            type="button"
            onClick={() => runExport(csvLabel, exportCsv)}
          >
            {csvLabel}
          </button>
          <button
            className="btn btn-ghost w-full justify-start"
            type="button"
            onClick={() => runExport(aFineStartLabel, exportAFineStartCode)}
          >
            {aFineStartLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
