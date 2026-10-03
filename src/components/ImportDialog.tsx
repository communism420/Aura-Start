import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartData, ImportMode } from "../types";
import { parseAFineStartExportWithReport } from "../utils/importAFineStart";
import { parseJsonBackup } from "../utils/importJson";
import { MAX_ZIP_BACKUP_BYTES, parseZipBackup } from "../utils/zipBackup";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

type ImportDialogProps = {
  language: AuraLanguage;
  open: boolean;
  currentData: AuraStartData;
  initialFormat?: ImportDialogFormat;
  onClose: () => void;
  onImport: (data: AuraStartData, mode: ImportMode, source?: ImportDialogFormat) => Promise<void>;
  onError: (message: string) => void;
};

export type ImportDialogFormat = "aura_json" | "a_fine_start";

type ParsedImport = {
  data: AuraStartData;
  warnings: string[];
  rejectedLinks: number;
  sourceGroups: number;
  sourceLinks: number;
};

type PendingReplaceImport = {
  data: AuraStartData;
  format: ImportDialogFormat;
} | null;

function countLinks(data: AuraStartData): number {
  return data.groups.reduce((count, group) => count + group.links.length, 0);
}

function countPotentialDuplicates(current: AuraStartData, imported: AuraStartData): { groups: number; links: number } {
  const currentGroupTitles = new Set(current.groups.map((group) => group.title.trim().toLowerCase()).filter(Boolean));
  const currentLinkUrls = new Set(
    current.groups.flatMap((group) => group.links.map((link) => link.url.trim().toLowerCase())).filter(Boolean)
  );

  return {
    groups: imported.groups.filter((group) => currentGroupTitles.has(group.title.trim().toLowerCase())).length,
    links: imported.groups.flatMap((group) => group.links).filter((link) => currentLinkUrls.has(link.url.trim().toLowerCase())).length
  };
}

function importErrorMessage(language: AuraLanguage, format: ImportDialogFormat, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (format !== "a_fine_start") {
    return localizedKnownMessage(language, message) ?? (message || t(language, "couldNotParseImportData"));
  }

  if (/does not contain bookmarks|no valid links/i.test(message)) {
    return t(language, "noValidLinksFound");
  }

  if (/json|valid A Fine Start|look like|array|unsupported/i.test(message)) {
    return t(language, "invalidExportCode");
  }

  return message || t(language, "invalidExportCode");
}

function localizedKnownMessage(language: AuraLanguage, message: string): string | undefined {
  if (!message) return undefined;

  if (/^URL is required\.$/i.test(message)) return t(language, "urlRequired");
  if (/^Only http and https links are allowed\.$/i.test(message)) return t(language, "urlHttpOnly");
  if (/^URL must include a valid host\.$/i.test(message)) return t(language, "urlHostRequired");
  if (/^Enter a valid URL/i.test(message)) return t(language, "urlInvalidExample");
  if (/^Link title is required\.$/i.test(message)) return t(language, "linkTitleRequired");
  if (/^Group title is required\.$/i.test(message)) return t(language, "groupTitleRequired");
  if (/Every link must be an object|Every group must be an object|Backup root must be an object|backup version|not valid JSON/i.test(message)) {
    return t(language, "couldNotParseImportData");
  }

  return undefined;
}

function importWarningMessage(language: AuraLanguage, warning: string): string {
  const converted = warning.match(/^"(.+)" in "(.+)" used an internal A Fine Start URL, so it was converted to https:\/\/afinestart\.me\/bookmarks\/\.$/);
  if (converted) {
    return t(language, "aFineStartInternalUrlConverted", { title: converted[1], groupTitle: converted[2] });
  }

  const skipped = warning.match(/^"(.+)" in "(.+)" was skipped: (.+)$/);
  if (skipped) {
    return t(language, "aFineStartLinkSkipped", {
      title: skipped[1],
      groupTitle: skipped[2],
      reason: localizedKnownMessage(language, skipped[3]) ?? skipped[3]
    });
  }

  return localizedKnownMessage(language, warning) ?? warning;
}

export function ImportDialog({
  language,
  open,
  currentData,
  initialFormat = "aura_json",
  onClose,
  onImport,
  onError
}: ImportDialogProps) {
  const [format, setFormat] = useState<ImportDialogFormat>(initialFormat);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<AuraStartData | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [rejectedLinks, setRejectedLinks] = useState(0);
  const [sourceCounts, setSourceCounts] = useState({ groups: 0, links: 0 });
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<PendingReplaceImport>(null);
  const [zipImport, setZipImport] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const fileRequest = useRef(0);
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);

  function parseText(text: string, nextFormat = format): ParsedImport {
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

    const data = parseJsonBackup(text);
    return {
      data,
      warnings: [],
      rejectedLinks: 0,
      sourceGroups: data.groups.length,
      sourceLinks: countLinks(data)
    };
  }

  function setParsedResult(result: ParsedImport) {
    setParsed(result.data);
    setImportWarnings(result.warnings);
    setRejectedLinks(result.rejectedLinks);
    setSourceCounts({ groups: result.sourceGroups, links: result.sourceLinks });
  }

  function validateText(text: string, nextFormat = format) {
    setLocalError(null);
    setParsed(null);
    setImportWarnings([]);
    setRejectedLinks(0);
    setSourceCounts({ groups: 0, links: 0 });
    if (!text.trim()) return;

    try {
      const result = parseText(text, nextFormat);
      setParsedResult(result);
    } catch (error) {
      setLocalError(importErrorMessage(language, nextFormat, error));
    }
  }

  useEffect(() => {
    if (!open) return;
    fileRequest.current += 1;
    setReadingFile(false);
    setZipImport(false);
    setFormat(initialFormat);
    validateText(rawText, initialFormat);
  }, [initialFormat, open]);

  useEffect(() => {
    if (!open) {
      fileRequest.current += 1;
      setReadingFile(false);
      setPendingReplace(null);
    }
  }, [open]);

  useEffect(() => () => { fileRequest.current += 1; }, []);

  async function handleFile(file: File | undefined) {
    if (applyingRef.current) return;
    const request = ++fileRequest.current;
    setLocalError(null);
    setParsed(null);
    setPendingReplace(null);
    setImportWarnings([]);
    setRejectedLinks(0);
    setSourceCounts({ groups: 0, links: 0 });
    setFileName(file?.name ?? "");
    setRawText("");
    setZipImport(false);
    setReadingFile(Boolean(file));
    if (!file) return;

    try {
      if (file.size > MAX_ZIP_BACKUP_BYTES) throw new Error(t(language, "backupFileTooLarge"));
      const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const zip = /\.zip$/i.test(file.name) || (header[0] === 0x50 && header[1] === 0x4b);
      if (request !== fileRequest.current) return;
      if (zip) {
        setFormat("aura_json");
        setZipImport(true);
        const data = await parseZipBackup(new Uint8Array(await file.arrayBuffer()));
        if (request !== fileRequest.current) return;
        setParsedResult({ data, warnings: [], rejectedLinks: 0,
          sourceGroups: data.groups.length, sourceLinks: countLinks(data) });
        return;
      }
      const text = await file.text();
      if (request !== fileRequest.current) return;
      setRawText(text);
      const result = parseText(text);
      setParsedResult(result);
    } catch (error) {
      if (request !== fileRequest.current) return;
      setImportWarnings([]);
      setRejectedLinks(0);
      setSourceCounts({ groups: 0, links: 0 });
      setLocalError(importErrorMessage(language, format, error));
    } finally {
      if (request === fileRequest.current) setReadingFile(false);
    }
  }

  async function applyImport(data: AuraStartData, importMode: ImportMode, source: ImportDialogFormat) {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    const request = fileRequest.current;
    try {
      await onImport(data, importMode, source);
      if (request === fileRequest.current) {
        setPendingReplace(null);
        onClose();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "importFailed"));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }

  const validLinkCount = parsed ? countLinks(parsed) : 0;
  const potentialDuplicates = parsed ? countPotentialDuplicates(currentData, parsed) : { groups: 0, links: 0 };

  return (
    <>
      <Modal
        open={open}
        title={format === "a_fine_start" ? t(language, "importFromAFineStart") : t(language, "importBackup")}
        description={t(language, "importBackupDescription")}
        closeLabel={t(language, "closeDialog")}
        onClose={() => { if (!applyingRef.current) onClose(); }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (readingFile || applyingRef.current) return;
            if (!rawText.trim() && !(zipImport && parsed)) {
              setLocalError(t(language, "pickImportData"));
              return;
            }

            let dataToImport: AuraStartData;
            try {
              if (zipImport && parsed) {
                // Keep the verified object: its pending asset bundles are
                // attached outside JSON until the confirmed import saves them.
                dataToImport = parsed;
              } else {
                const result = parseText(rawText);
                dataToImport = result.data;
                setParsedResult(result);
              }
              setLocalError(null);
            } catch (error) {
              setParsed(null);
              setImportWarnings([]);
              setRejectedLinks(0);
              setSourceCounts({ groups: 0, links: 0 });
              setLocalError(importErrorMessage(language, format, error));
              return;
            }

            if (mode === "replace") {
              setPendingReplace({ data: dataToImport, format });
              return;
            }

            void applyImport(dataToImport, mode, format);
          }}
        >
          {format === "a_fine_start" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-sm">
            <div className="font-semibold">{t(language, "aFineStartImportStepsTitle")}</div>
            <ol className="muted mt-2 list-decimal space-y-1 pl-5">
              <li>{t(language, "aFineStartImportStepOpen")}</li>
              <li>{t(language, "aFineStartImportStepSettings")}</li>
              <li>{t(language, "aFineStartImportStepCopy")}</li>
              <li>{t(language, "aFineStartImportStepPaste")}</li>
              <li>{t(language, "aFineStartImportStepMode")}</li>
              <li>{t(language, "aFineStartImportStepReview")}</li>
            </ol>
          </div>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{t(language, "importFormat")}</span>
          <select
            className="field"
            disabled={applying}
            value={format}
            onChange={(event) => {
              fileRequest.current += 1;
              setReadingFile(false);
              setZipImport(false);
              setPendingReplace(null);
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
            accept="application/zip,application/x-zip-compressed,application/json,text/plain,.zip,.json,.txt"
            className="sr-only"
            type="file"
            disabled={applying}
            aria-label={t(language, "chooseImportFile")}
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
            }}
          />
        </label>
        {readingFile ? <p role="status" className="muted text-sm">{t(language, "readingBackup")}</p> : null}
        {zipImport ? <p className="muted text-sm">{t(language, "zipImportDescription")}</p> : <label className="block">
          <span className="mb-1 block text-sm font-semibold">
            {format === "a_fine_start" ? t(language, "pasteAFineStartCode") : t(language, "pasteAuraJson")}
          </span>
          <textarea
            disabled={applying}
            className="field min-h-32 resize-y"
            placeholder={
              format === "a_fine_start"
                ? t(language, "pasteAFineStartPlaceholder")
                : t(language, "pasteFullBackupJson")
            }
            value={rawText}
            onChange={(event) => {
              fileRequest.current += 1;
              setReadingFile(false);
              setPendingReplace(null);
              const text = event.target.value;
              setRawText(text);
              setFileName("");
              validateText(text);
            }}
          />
        </label>}
        {parsed ? (
          <div className="rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent-strong)]">
            <div className="font-semibold">{t(language, "reviewImport")}</div>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-75">{t(language, "importPreviewPayload")}</dt>
                <dd>{t(language, "importPreviewGroupsLinks", { groups: sourceCounts.groups, links: sourceCounts.links })}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-75">{t(language, "importPreviewValid")}</dt>
                <dd>{t(language, "importPreviewGroupsLinks", { groups: parsed.groups.length, links: validLinkCount })}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-75">{t(language, "importPreviewMode")}</dt>
                <dd>{mode === "merge" ? t(language, "merge") : t(language, "replace")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-75">{t(language, "importPreviewWillAdd")}</dt>
                <dd>{t(language, "importPreviewGroupsLinks", { groups: parsed.groups.length, links: validLinkCount })}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-75">{t(language, "importPreviewPotentialDuplicates")}</dt>
                <dd>{t(language, "importPreviewGroupsLinks", { groups: potentialDuplicates.groups, links: potentialDuplicates.links })}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-75">{t(language, "importPreviewRejected")}</dt>
                <dd>{t(language, "linksCount", { count: rejectedLinks })}</dd>
              </div>
            </dl>
            {mode === "replace" ? (
              <p className="mt-3 text-sm">{t(language, "exportBackupBeforeImport")}</p>
            ) : null}
          </div>
        ) : null}
        {importWarnings.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] p-3 text-sm">
            <div className="font-semibold text-[var(--warning)]">
              {t(language, "importWarnings", { count: importWarnings.length })}
            </div>
            <ul className="muted mt-2 list-disc space-y-1 pl-5">
              {importWarnings.slice(0, 4).map((warning) => (
                <li key={warning}>{importWarningMessage(language, warning)}</li>
              ))}
            </ul>
            {importWarnings.length > 4 ? (
              <div className="muted mt-2">{t(language, "moreWarnings", { count: importWarnings.length - 4 })}</div>
            ) : null}
          </div>
        ) : null}
        {localError ? <div className="rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{localError}</div> : null}
        <fieldset className="space-y-2" disabled={applying}>
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
            <button className="btn btn-secondary" type="button" disabled={applying} onClick={onClose}>
              {t(language, "cancel")}
            </button>
            <button className="btn btn-primary" type="submit" disabled={readingFile || applying || !parsed}>
              {t(language, "import")}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        cancelLabel={t(language, "cancel")}
        confirmLabel={t(language, "importReplaceConfirmAction")}
        message={t(language, "importReplaceConfirmMessage")}
        open={pendingReplace !== null}
        busy={applying}
        title={t(language, "importReplaceConfirmTitle")}
        onCancel={() => { if (!applyingRef.current) setPendingReplace(null); }}
        onConfirm={async () => {
          if (!pendingReplace) return;
          await applyImport(pendingReplace.data, "replace", pendingReplace.format);
        }}
      />
    </>
  );
}
