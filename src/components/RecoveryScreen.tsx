import { AlertTriangle, Download, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";
import { dateForFile } from "../utils/dates";
import { downloadTextFile } from "../utils/download";

type RecoveryScreenProps = {
  language: AuraLanguage;
  message: string;
  raw: string | null;
  onReset: () => Promise<void>;
  onError: (message: string) => void;
};

export function RecoveryScreen({ language, message, raw, onReset, onError }: RecoveryScreenProps) {
  return (
    <main className="app-shell flex items-center justify-center">
      <section className="surface w-full max-w-2xl rounded-xl p-6">
        <div className="flex gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]">
            <AlertTriangle size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t(language, "recoveryTitle")}</h1>
            <p className="muted mt-2 text-sm leading-6">{t(language, "recoveryDescription")}</p>
            <div className="mt-4 rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{message}</div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() =>
              downloadTextFile(
                `aura-start-corrupt-storage-${dateForFile()}.json`,
                raw || "{}",
                "application/json;charset=utf-8"
              )
            }
          >
            <Download size={17} />
            {t(language, "exportRawData")}
          </button>
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => {
              void onReset().catch((error: unknown) =>
                onError(error instanceof Error ? error.message : t(language, "couldNotResetLocalData"))
              );
            }}
          >
            <RotateCcw size={17} />
            {t(language, "resetLocalData")}
          </button>
        </div>
      </section>
    </main>
  );
}
