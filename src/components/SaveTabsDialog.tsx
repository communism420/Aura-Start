import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { AuraLanguage, AuraStartData } from "../types";
import { getCurrentWindowTabsPreview, type TabsCapturePreview } from "../utils/tabsCapture";
import { Modal } from "./Modal";

type SaveTabsDialogProps = {
  data: AuraStartData;
  language: AuraLanguage;
  open: boolean;
  onClose: () => void;
  onError: (message: string) => void;
  onSave: (title?: string) => Promise<unknown>;
};

export function SaveTabsDialog({ data, language, open, onClose, onError, onSave }: SaveTabsDialogProps) {
  const [title, setTitle] = useState(t(language, "openTabsDefaultGroupTitle"));
  const [preview, setPreview] = useState<TabsCapturePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const existingUrls = useMemo(
    () => data.groups.flatMap((group) => group.links.map((link) => link.url)),
    [data.groups]
  );

  useEffect(() => {
    if (!open) return;
    setTitle(t(language, "openTabsDefaultGroupTitle"));
    setPreview(null);
    setLoading(false);
    setSaving(false);
  }, [language, open]);

  async function loadPreview() {
    setLoading(true);
    try {
      setPreview(await getCurrentWindowTabsPreview(existingUrls));
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotCompleteAction"));
    } finally {
      setLoading(false);
    }
  }

  async function saveTabs() {
    setSaving(true);
    try {
      await onSave(title);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotCompleteAction"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t(language, "saveOpenTabs")}
      description={t(language, "saveOpenTabsDescription")}
      closeLabel={t(language, "closeDialog")}
      onClose={onClose}
      size="lg"
    >
      <div className="save-tabs-dialog">
        {!data.settings.captureOpenTabs ? (
          <div className="surface-flat rounded-xl p-4 text-sm">
            <p className="font-semibold">{t(language, "openTabsCaptureDisabled")}</p>
            <p className="muted mt-1">{t(language, "openTabsEnableInSettings")}</p>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">{t(language, "newGroupTitle")}</span>
              <input
                className="field"
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <div className="save-tabs-permission-note">
              <ShieldCheck size={18} />
              <span>{t(language, "saveOpenTabsPermissionNote")}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary" disabled={loading || saving} type="button" onClick={() => void loadPreview()}>
                <RefreshCw size={16} />
                {preview ? t(language, "refreshPreview") : t(language, "reviewOpenTabs")}
              </button>
              <button
                className="btn btn-primary"
                disabled={loading || saving || !preview?.links.length}
                type="button"
                onClick={() => void saveTabs()}
              >
                <Save size={16} />
                {saving ? t(language, "saving") : t(language, "saveOpenTabs")}
              </button>
            </div>

            {preview ? (
              <div className="save-tabs-preview">
                <div className="save-tabs-summary">
                  <span>{t(language, "openTabsPreviewCount", { count: preview.links.length })}</span>
                  <span>
                    {t(language, "openTabsSkippedSummary", {
                      duplicates: preview.duplicateCount,
                      existing: preview.existingCount,
                      skipped: preview.skippedCount
                    })}
                  </span>
                </div>
                {preview.links.length ? (
                  <div className="save-tabs-list">
                    {preview.links.map((link) => (
                      <div className="save-tabs-row" key={link.url}>
                        <div className="save-tabs-row-title">{link.title}</div>
                        <div className="save-tabs-row-url">{link.url}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="surface-flat rounded-xl p-5 text-center">
                    <p className="font-semibold">{t(language, "noOpenTabsToSave")}</p>
                    <p className="muted mt-1 text-sm">{t(language, "noOpenTabsToSaveDescription")}</p>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
