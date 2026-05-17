import { Check, FileUp, Palette, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { AuraStartData, AuraStartSettings } from "../types";
import { Modal } from "./Modal";

type OnboardingStep = "start" | "appearance" | "layout" | "finish";

type OnboardingDialogProps = {
  data: AuraStartData;
  open: boolean;
  onClose: () => void;
  onComplete: () => Promise<void>;
  onImportAFineStart: () => void;
  onImportBackup: () => void;
  onUpdateSettings: (settings: Partial<AuraStartSettings>) => Promise<void>;
  onError: (message: string) => void;
};

export function OnboardingDialog({
  data,
  open,
  onClose,
  onComplete,
  onImportAFineStart,
  onImportBackup,
  onUpdateSettings,
  onError
}: OnboardingDialogProps) {
  const [step, setStep] = useState<OnboardingStep>("start");
  const language = data.settings.language;

  useEffect(() => {
    if (open) {
      setStep("start");
    }
  }, [open]);

  async function finish() {
    try {
      await onComplete();
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotUpdateSettings"));
    }
  }

  async function chooseTheme(theme: AuraStartSettings["theme"]) {
    try {
      await onUpdateSettings({ theme });
      setStep("layout");
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotUpdateSettings"));
    }
  }

  async function chooseLayout(compactMode: boolean) {
    try {
      await onUpdateSettings({ compactMode });
      setStep("finish");
    } catch (error) {
      onError(error instanceof Error ? error.message : t(language, "couldNotUpdateSettings"));
    }
  }

  async function completeAndOpenImport(action: () => void) {
    await finish();
    action();
  }

  return (
    <Modal
      open={open}
      title={t(language, "welcomeToAuraStart")}
      description={t(language, "onboardingDescription")}
      closeLabel={t(language, "closeDialog")}
      onClose={onClose}
      size="lg"
    >
      {step === "start" ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{t(language, "chooseHowToStart")}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <button className="surface-flat rounded-lg border border-[var(--border)] p-4 text-left" type="button" onClick={() => setStep("appearance")}>
              <Sparkles className="mb-3 text-[var(--accent)]" size={22} />
              <div className="font-semibold">{t(language, "startFresh")}</div>
            </button>
            <button className="surface-flat rounded-lg border border-[var(--border)] p-4 text-left" type="button" onClick={() => void completeAndOpenImport(onImportAFineStart)}>
              <FileUp className="mb-3 text-[var(--accent)]" size={22} />
              <div className="font-semibold">{t(language, "importFromAFineStart")}</div>
            </button>
            <button className="surface-flat rounded-lg border border-[var(--border)] p-4 text-left" type="button" onClick={() => void completeAndOpenImport(onImportBackup)}>
              <FileUp className="mb-3 text-[var(--accent)]" size={22} />
              <div className="font-semibold">{t(language, "importBackupFile")}</div>
            </button>
          </div>
        </div>
      ) : null}

      {step === "appearance" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Palette className="text-[var(--accent)]" size={22} />
            <h3 className="text-lg font-semibold">{t(language, "chooseAppearance")}</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["system", "light", "dark"] as const).map((theme) => (
              <button
                className={`btn ${data.settings.theme === theme ? "btn-primary" : "btn-secondary"} w-full`}
                key={theme}
                type="button"
                onClick={() => void chooseTheme(theme)}
              >
                {t(language, theme)}
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <button className="btn btn-ghost" type="button" onClick={() => setStep("start")}>
              {t(language, "back")}
            </button>
          </div>
        </div>
      ) : null}

      {step === "layout" ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{t(language, "optionalLayout")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className={`btn ${!data.settings.compactMode ? "btn-primary" : "btn-secondary"} w-full`} type="button" onClick={() => void chooseLayout(false)}>
              {t(language, "comfortable")}
            </button>
            <button className={`btn ${data.settings.compactMode ? "btn-primary" : "btn-secondary"} w-full`} type="button" onClick={() => void chooseLayout(true)}>
              {t(language, "compact")}
            </button>
          </div>
          <div className="flex justify-between">
            <button className="btn btn-ghost" type="button" onClick={() => setStep("appearance")}>
              {t(language, "back")}
            </button>
          </div>
        </div>
      ) : null}

      {step === "finish" ? (
        <div className="space-y-5 text-center">
          <Check className="mx-auto text-[var(--accent)]" size={34} />
          <div>
            <h3 className="text-lg font-semibold">{t(language, "finish")}</h3>
            <p className="muted mt-1 text-sm">{t(language, "onboardingFinishDescription")}</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => void finish()}>
            {t(language, "finish")}
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
