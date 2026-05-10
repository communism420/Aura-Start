import { Download, ExternalLink, Settings } from "lucide-react";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS } from "./constants";
import { t } from "./i18n";
import { useAuraStore } from "./store/useAuraStore";
import { exportJsonBackup } from "./utils/exportJson";
import "./styles.css";

function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime);
}

function PopupApp() {
  const data = useAuraStore((state) => state.data);
  const status = useAuraStore((state) => state.status);
  const error = useAuraStore((state) => state.error);
  const load = useAuraStore((state) => state.load);
  const addToast = useAuraStore((state) => state.addToast);
  const language = data?.settings.language ?? DEFAULT_SETTINGS.language;

  useEffect(() => {
    void load();
  }, [load]);

  const openNewTab = () => {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      void chrome.tabs.create({});
      window.close();
      return;
    }

    window.open("newtab.html", "_blank", "noopener");
  };

  const openSettings = () => {
    if (hasChromeRuntime() && chrome.runtime.openOptionsPage) {
      void chrome.runtime.openOptionsPage();
      window.close();
      return;
    }

    window.open("options.html", "_blank", "noopener");
  };

  const exportBackup = () => {
    if (!data) return;
    try {
      exportJsonBackup(data);
    } catch (caught) {
      addToast({
        type: "error",
        title: t(language, "exportFailed"),
        message: caught instanceof Error ? caught.message : t(language, "couldNotExportBackup")
      });
    }
  };

  return (
    <main className="w-80 bg-[var(--bg)] p-3 text-[var(--text)]">
      <section className="surface-flat rounded-xl p-4">
        <div className="mb-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <img className="aura-logo aura-logo-popup" src="/logo.png" alt="" aria-hidden="true" />
            <span>Aura Start</span>
          </div>
          <div className="muted mt-1 text-xs">
            {t(language, "brandSlogan")}
          </div>
          <div className="muted text-xs">
            {status === "ready" && data
              ? t(language, "groupsLinksCount", {
                  groups: data.groups.length,
                  links: data.groups.reduce((count, group) => count + group.links.length, 0)
                })
              : status === "corrupt"
                ? t(language, "storageNeedsRecovery")
                : t(language, "loadingLocalData")}
          </div>
          {error ? <div className="mt-2 text-xs text-[var(--danger)]">{error}</div> : null}
        </div>
        <div className="space-y-2">
          <button className="btn btn-primary w-full justify-start" type="button" onClick={openNewTab}>
            <ExternalLink size={17} />
            {t(language, "openNewTab")}
          </button>
          <button className="btn btn-secondary w-full justify-start" disabled={!data} type="button" onClick={exportBackup}>
            <Download size={17} />
            {t(language, "exportJsonBackup")}
          </button>
          <button className="btn btn-secondary w-full justify-start" type="button" onClick={openSettings}>
            <Settings size={17} />
            {t(language, "settings")}
          </button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("popup-root") as HTMLElement).render(<PopupApp />);
