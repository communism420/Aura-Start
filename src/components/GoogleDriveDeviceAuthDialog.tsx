import { Clipboard, ExternalLink } from "lucide-react";
import { Modal } from "./Modal";
import { t } from "../i18n";
import type { AuraLanguage } from "../types";
import type { GoogleDriveDeviceAuthPrompt } from "../services/googleDriveSync";

type GoogleDriveDeviceAuthDialogProps = {
  language: AuraLanguage;
  prompt: GoogleDriveDeviceAuthPrompt | null;
  onClose: () => void;
};

export function GoogleDriveDeviceAuthDialog({ language, prompt, onClose }: GoogleDriveDeviceAuthDialogProps) {
  if (!prompt) return null;

  const openUrl = prompt.verificationUrlComplete ?? prompt.verificationUrl;
  const expiresAt = new Date(prompt.expiresAt);

  async function copyCode() {
    await navigator.clipboard?.writeText(prompt?.userCode ?? "").catch(() => undefined);
  }

  return (
    <Modal
      open={Boolean(prompt)}
      title={t(language, "googleDriveDeviceAuthTitle")}
      description={t(language, "googleDriveDeviceAuthDescription")}
      closeLabel={t(language, "closeDialog")}
      onClose={onClose}
      size="sm"
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
          <div className="muted text-xs font-semibold uppercase tracking-wide">{t(language, "googleDriveDeviceAuthCodeLabel")}</div>
          <div className="mt-2 select-all rounded-lg bg-[var(--surface)] px-3 py-2 font-mono text-2xl font-semibold tracking-[0.2em]">
            {prompt.userCode}
          </div>
          <div className="muted mt-2">{t(language, "googleDriveDeviceAuthExpires", { time: expiresAt.toLocaleTimeString() })}</div>
        </div>
        <p className="muted leading-6">{t(language, "googleDriveDeviceAuthInstructions")}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" type="button" onClick={() => void copyCode()}>
            <Clipboard size={16} />
            {t(language, "copy")}
          </button>
          <a className="btn btn-primary" href={openUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            {t(language, "googleDriveDeviceAuthOpenGoogle")}
          </a>
        </div>
      </div>
    </Modal>
  );
}
