import { Upload } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartData, ImportMode } from "../types";
import { parseAFineStartExportWithReport } from "../utils/importAFineStart";
import { parseJsonBackup } from "../utils/importJson";
import { Modal } from "./Modal";

type ImportDialogProps = {
  language: AuraLanguage;
  open: boolean;
  onClose: () => void;
  onImport: (data: AuraStartData, mode: ImportMode) => Promise<void>;
  onError: (message: string) => void;
};

export function ImportDialog({ language, open, onClose, onImport, onError }: ImportDialogProps) {
  const [format, setFormat] = useState<"aura_json" | "a_fine_start">("aura_json");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<AuraStartData | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  function parseText(text: string, nextFormat = format): { data: AuraStartData; warnings: string[] } {
    if (nextFormat === "a_fine_start") {
      const result = parseAFineStartExportWithReport(text);
      return {
        ...result,
        data: {
          ...result.data,
          settings: {
            ...result.data.settings,
            language
          }
        }
      };
    }

    return { data: parseJsonBackup(text), warnings: [] };
  }

  function validateText(text: string, nextFormat = format) {
    setLocalError(null);
    setParsed(null);
    setImportWarnings([]);
    if (!text.trim()) return;

    try {
      const result = parseText(text, nextFormat);
      setParsed(result.data);
      setImportWarnings(result.warnings);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t(language, "couldNotParseImportData"));
    }
  }

  async function handleFile(file: File | undefined) {
    setLocalError(null);
    setParsed(null);
    setFileName(file?.name ?? "");
    if (!file) return;

    try {
      const text = await file.text();
      setRawText(text);
      const result = parseText(text);
      setParsed(result.data);
      setImportWarnings(result.warnings);
    } catch (error) {
      setImportWarnings([]);
      setLocalError(error instanceof Error ? error.message : t(language, "couldNotReadImportFile"));
    }
  }

  return (
    <Modal
      open={open}
      title={t(language, "importBackup")}
      description={t(language, "importBackupDescription")}
      closeLabel={t(language, "closeDialog")}
      onClose={onClose}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!rawText.trim()) {
            setLocalError(t(language, "pickImportData"));
            return;
          }

          let dataToImport: AuraStartData;
          try {
            const result = parseText(rawText);
            dataToImport = result.data;
            setParsed(dataToImport);
            setImportWarnings(result.warnings);
            setLocalError(null);
          } catch (error) {
            setParsed(null);
            setImportWarnings([]);
            setLocalError(error instanceof Error ? error.message : t(language, "couldNotParseImportData"));
            return;
          }

          void onImport(dataToImport, mode)
            .then(onClose)
            .catch((error: unknown) => onError(error instanceof Error ? error.message : t(language, "importFailed")));
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{t(language, "importFormat")}</span>
          <select
            className="field"
            value={format}
            onChange={(event) => {
              const nextFormat = event.target.value as "aura_json" | "a_fine_start";
              setFormat(nextFormat);
              validateText(rawText, nextFormat);
            }}
          >
            <option value="aura_json">{t(language, "auraStartBackupJson")}</option>
            <option value="a_fine_start">{t(language, "aFineStartExportCode")}</option>
          </select>
        </label>
        <label className="block rounded-xl border border-dashed border-[var(--border)] p-5 text-center">
          <Upload className="mx-auto text-[var(--accent)]" size={28} />
          <span className="mt-3 block text-sm font-semibold">{fileName || t(language, "chooseImportFile")}</span>
          <span className="muted mt-1 block text-xs">{t(language, "noUploadHappens")}</span>
          <input
            accept="application/json,text/plain,.json,.txt"
            className="sr-only"
            type="file"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
            }}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">
            {format === "a_fine_start" ? t(language, "pasteAFineStartCode") : t(language, "pasteAuraJson")}
          </span>
          <textarea
            className="field min-h-32 resize-y"
            placeholder={
              format === "a_fine_start"
                ? t(language, "pasteAFineStartPlaceholder")
                : t(language, "pasteFullBackupJson")
            }
            value={rawText}
            onChange={(event) => {
              const text = event.target.value;
              setRawText(text);
              setFileName("");
              validateText(text);
            }}
          />
        </label>
        {parsed ? (
          <div className="rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent-strong)]">
            {t(language, "validImport", {
              groups: parsed.groups.length,
              links: parsed.groups.reduce((count, group) => count + group.links.length, 0)
            })}
          </div>
        ) : null}
        {importWarnings.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] p-3 text-sm">
            <div className="font-semibold text-[var(--warning)]">
              {t(language, "importWarnings", { count: importWarnings.length })}
            </div>
            <ul className="muted mt-2 list-disc space-y-1 pl-5">
              {importWarnings.slice(0, 4).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {importWarnings.length > 4 ? (
              <div className="muted mt-2">{t(language, "moreWarnings", { count: importWarnings.length - 4 })}</div>
            ) : null}
          </div>
        ) : null}
        {localError ? <div className="rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{localError}</div> : null}
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t(language, "importMode")}</legend>
          <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3">
            <input
              checked={mode === "merge"}
              className="mt-1"
              name="importMode"
              type="radio"
              value="merge"
              onChange={() => setMode("merge")}
            />
            <span>
              <span className="block text-sm font-semibold">{t(language, "mergeWithCurrentData")}</span>
              <span className="muted block text-sm">{t(language, "mergeDescription")}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3">
            <input
              checked={mode === "replace"}
              className="mt-1"
              name="importMode"
              type="radio"
              value="replace"
              onChange={() => setMode("replace")}
            />
            <span>
              <span className="block text-sm font-semibold">{t(language, "replaceCurrentData")}</span>
              <span className="muted block text-sm">{t(language, "replaceDescription")}</span>
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {t(language, "cancel")}
          </button>
          <button className="btn btn-primary" type="submit">
            {t(language, "import")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
