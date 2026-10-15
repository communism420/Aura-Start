import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { languageOptions, t } from "../i18n";
import type { AuraLanguage, AuraSyncSettings, AuraSyncStatus } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { GoogleDriveSyncPanel } from "./GoogleDriveSyncPanel";
import { Header } from "./Header";

function renderHeader(sync: Partial<AuraSyncSettings>) {
  const data = createEmptyData();
  data.settings.language = "en";
  Object.assign(data.settings.sync, { connected: true, mode: "auto", accountInfoUpdatedAt: "2026-10-15T09:00:00.000Z" }, sync);
  const noop = () => {};
  return renderToStaticMarkup(
    <Header
      data={data} search="" searchFilter="all" searchOpen={false} searchResultCount={0}
      editMode={false} syncStatus="idle" syncMessage={null} searchInputRef={{ current: null }}
      onSearchChange={noop} onSearchFilterChange={noop} onOpenSearch={noop} onOpenSaveTabs={noop}
      onToggleEditMode={noop} onOpenCommandPalette={noop} onAddGroup={noop} onAddLink={noop}
      onOpenSettings={noop} onOpenImport={noop} onExportError={noop}
    />
  );
}

function renderAccount(sync: Partial<AuraSyncSettings>, status: AuraSyncStatus = "idle", language: AuraLanguage = "en") {
  const data = createEmptyData();
  data.settings.language = language;
  Object.assign(data.settings.sync, { connected: true, mode: "auto", accountInfoUpdatedAt: "2026-10-15T09:00:00.000Z" }, sync);
  return renderToStaticMarkup(
    <GoogleDriveSyncPanel
      data={data}
      syncStatus={status}
      syncMessage={null}
      syncConflict={null}
      onConnect={async () => {}}
      onDisconnect={async () => {}}
      onDeleteBackupAndDisconnect={async () => {}}
      onUpdateSyncSettings={() => {}}
      onResolveConflict={async () => {}}
      onError={() => {}}
    />
  );
}

describe("connected Google account", () => {
  it("shows the email in the header marker even when the display name is available", () => {
    const html = renderHeader({ accountName: "Ada Lovelace", accountEmail: "ada@example.com" });
    expect(html).toContain("<span>ada@example.com</span>");
    expect(html).not.toContain("<span>Ada Lovelace</span>");
  });

  it("keeps the header identity visible while connected synchronization is paused", () => {
    const html = renderHeader({ mode: "off", accountEmail: "ada@example.com" });
    expect(html).toContain("<span>ada@example.com</span>");
    expect(html).toContain(t("en", "googleDriveSyncDisabled"));
  });

  it("never uses unverified legacy identity in the header or its tooltip", () => {
    const html = renderHeader({ accountInfoUpdatedAt: undefined, accountName: "Browser Profile", accountEmail: "browser-profile@example.com" });
    expect(html).not.toContain("Browser Profile");
    expect(html).not.toContain("browser-profile@example.com");
    expect(html).toContain("<span>Google Drive</span>");
  });

  it("shows the exact email alongside the account name without loading a remote avatar", () => {
    const html = renderAccount({ accountName: "Ada Lovelace", accountEmail: "ada@example.com", accountAvatarUrl: "https://example.com/avatar.png" });
    expect(html).toContain("Connected Google account");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).not.toContain("https://example.com/avatar.png");
    expect(html).not.toContain("<img");
    expect(html).not.toContain(t("en", "googleDriveAccountDetailsPending"));
  });

  it("shows an email even when Google does not return a display name", () => {
    const html = renderAccount({ accountName: undefined, accountEmail: "ada@example.com" });
    expect(html).toContain("ada@example.com");
    expect(html).not.toContain(t("en", "googleDriveAccountDetailsPending"));
  });

  it("keeps the identity visible when synchronization is paused or needs reconnecting", () => {
    for (const status of ["idle", "reconnect_required", "error"] as const) {
      const html = renderAccount({ mode: "off", accountName: "Ada Lovelace", accountEmail: "ada@example.com" }, status);
      expect(html).toContain("Connected Google account");
      expect(html).toContain("ada@example.com");
    }
  });

  it("does not show a stale saved identity after disconnection", () => {
    const html = renderAccount({ connected: false, accountName: "Ada Lovelace", accountEmail: "ada@example.com" });
    expect(html).not.toContain("Connected Google account");
    expect(html).not.toContain("Ada Lovelace");
    expect(html).not.toContain("ada@example.com");
  });

  it("does not misidentify a legacy browser-profile account as the connected Drive account", () => {
    const html = renderAccount({ accountInfoUpdatedAt: undefined, accountName: "Browser Profile", accountEmail: "browser-profile@example.com" });
    expect(html).not.toContain("Browser Profile");
    expect(html).not.toContain("browser-profile@example.com");
    expect(html).toContain(t("en", "googleDriveAccountDetailsPending"));
  });

  it("explains missing details without implying that the account is disconnected or perpetually loading", () => {
    const html = renderAccount({ accountEmail: undefined, accountName: undefined });
    expect(html).toContain("Connected Google account");
    expect(html).toContain(t("en", "googleDriveAccountDetailsPending"));
    expect(html).toContain(t("en", "googleDriveConnected"));
    expect(html).not.toContain('role="progressbar"');
  });

  it("treats whitespace-only email as unavailable instead of hiding account status", () => {
    const html = renderAccount({ accountEmail: "  ", accountName: "Ada Lovelace" });
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain(t("en", "googleDriveAccountDetailsPending"));
  });

  it("escapes account-provided text and wraps long email addresses", () => {
    const html = renderAccount({ accountName: '<img src="x">', accountEmail: "very-long-address@example.com" });
    expect(html).toContain("&lt;img src=&quot;x&quot;&gt;");
    expect(html).not.toContain('<img src="x">');
    expect(html).toContain('class="muted mt-1 break-all" dir="ltr">very-long-address@example.com');
  });

  it.each(languageOptions)("localizes account status for $label", ({ code }) => {
    const html = renderAccount({}, "idle", code);
    const title = t(code, "googleDriveConnectedAccount");
    const pending = t(code, "googleDriveAccountDetailsPending");
    expect(html).toContain(title);
    expect(html).toContain(pending);
    if (code !== "en") {
      expect(title).not.toBe(t("en", "googleDriveConnectedAccount"));
      expect(pending).not.toBe(t("en", "googleDriveAccountDetailsPending"));
    }
  });
});
