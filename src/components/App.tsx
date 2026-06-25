import { useEffect, useMemo, useRef, useState } from "react";
import { AddEditGroupDialog } from "./AddEditGroupDialog";
import { AddEditLinkDialog, type EditingLink } from "./AddEditLinkDialog";
import { CommandPalette, type CommandPaletteCommand } from "./CommandPalette";
import { ConfirmDialog } from "./ConfirmDialog";
import { DuplicateFinderDialog } from "./DuplicateFinderDialog";
import { EmptyState } from "./EmptyState";
import { GroupGrid } from "./GroupGrid";
import { Header } from "./Header";
import { ImportDialog, type ImportDialogFormat } from "./ImportDialog";
import { Modal } from "./Modal";
import { OnboardingDialog } from "./OnboardingDialog";
import { RecoveryScreen } from "./RecoveryScreen";
import { RestorePointsDialog } from "./RestorePointsDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Toasts } from "./Toasts";
import { DEFAULT_SETTINGS } from "../constants";
import { t } from "../i18n";
import { GOOGLE_DEVICE_AUTH_EVENT, type GoogleDeviceAuthEventDetail } from "../services/googleDriveSync";
import { useAuraStore } from "../store/useAuraStore";
import type { AuraStartGroup, AuraStartLink } from "../types";
import { exportJsonBackup } from "../utils/exportJson";
import {
  filterGroupsForSearch,
  flattenSearchResults,
  parseSearchQuery,
  searchHasQuery,
  searchHighlightTerms,
  searchResultId,
  type SearchResult
} from "../utils/search";

type AppProps = {
  initialSettingsOpen?: boolean;
};

const TOGGLE_COMMAND_PALETTE_MESSAGE = "aura-start:toggle-command-palette";

type PendingDanger =
  | { type: "deleteGroup"; group: AuraStartGroup }
  | { type: "deleteLink"; groupId: string; link: AuraStartLink }
  | { type: "removeDemoData" }
  | { type: "resetAll" }
  | null;

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.dataset.keyboardFocusTarget === "true") return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function isInteractiveControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("button,a,[role='button'],[role='link']"));
}

function resultIdentity(result: SearchResult): string {
  return searchResultId(result.groupId, result.link.id);
}

function scrollSearchResultIntoView(id: string): void {
  window.requestAnimationFrame(() => {
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-search-result-id]")).find(
      (candidate) => candidate.dataset.searchResultId === id
    );
    element?.scrollIntoView({ block: "nearest" });
  });
}

export function App({ initialSettingsOpen = false }: AppProps) {
  const {
    data,
    status,
    error,
    corruptRaw,
    usingFallbackStorage,
    syncStatus,
    syncMessage,
    syncConflict,
    onboardingCompleted,
    demoData,
    load,
    completeOnboarding,
    resetCorruptData,
    updateSettings,
    addGroup,
    updateGroupTitle,
    toggleGroupCollapsed,
    deleteGroup,
    addLink,
    updateLink,
    deleteLink,
    deleteLinksWithRestorePoint,
    reorderGroups,
    moveLink,
    addDemoData,
    removeDemoData,
    importBackup,
    resetAllData,
    createManualRestorePoint,
    restoreRestorePoint,
    deleteRestorePoint,
    deleteAllRestorePoints,
    connectGoogleDrive,
    disconnectGoogleDrive,
    deleteGoogleDriveBackupAndDisconnect,
    restoreFromGoogleDrive,
    resolveSyncConflict,
    addToast
  } = useAuraStore();

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedSearchResultId, setSelectedSearchResultId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<AuraStartGroup | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [initialLinkGroupId, setInitialLinkGroupId] = useState<string | undefined>();
  const [editingLink, setEditingLink] = useState<EditingLink | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportDialogFormat>("aura_json");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [duplicateFinderOpen, setDuplicateFinderOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [deviceAuth, setDeviceAuth] = useState<GoogleDeviceAuthEventDetail | null>(null);
  const [pendingDanger, setPendingDanger] = useState<PendingDanger>(null);
  const keyboardFocusRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autoOnboardingCheckedRef = useRef(false);
  const deviceAuthSawActiveSyncRef = useRef(false);
  const fallbackLanguage = DEFAULT_SETTINGS.language;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleDeviceAuth = (event: Event) => {
      const detail = (event as CustomEvent<GoogleDeviceAuthEventDetail>).detail;
      if (detail?.userCode && detail.verificationUrl) {
        deviceAuthSawActiveSyncRef.current = false;
        setDeviceAuth(detail);
      }
    };

    globalThis.addEventListener?.(GOOGLE_DEVICE_AUTH_EVENT, handleDeviceAuth);
    return () => globalThis.removeEventListener?.(GOOGLE_DEVICE_AUTH_EVENT, handleDeviceAuth);
  }, []);

  useEffect(() => {
    if (!deviceAuth) {
      deviceAuthSawActiveSyncRef.current = false;
      return;
    }

    if (syncStatus === "connecting" || syncStatus === "syncing") {
      deviceAuthSawActiveSyncRef.current = true;
      return;
    }

    if (deviceAuthSawActiveSyncRef.current) {
      setDeviceAuth(null);
    }
  }, [deviceAuth, syncStatus]);

  const hasUserGroupsOrLinks = Boolean(data && data.groups.length > 0);
  const hasTrackedDemoData = useMemo(() => {
    if (!data) return false;
    const demoGroupIds = new Set(demoData.groupIds);
    const demoLinkIds = new Set(demoData.linkIds);
    return data.groups.some((group) => demoGroupIds.has(group.id) || group.links.some((link) => demoLinkIds.has(link.id)));
  }, [data, demoData]);

  useEffect(() => {
    if (!data || onboardingCompleted || !hasUserGroupsOrLinks) return;
    void completeOnboarding().catch(() => undefined);
  }, [completeOnboarding, data, hasUserGroupsOrLinks, onboardingCompleted]);

  useEffect(() => {
    if (!data || autoOnboardingCheckedRef.current || onboardingCompleted || hasUserGroupsOrLinks) return;
    autoOnboardingCheckedRef.current = true;
    setOnboardingOpen(true);
  }, [data, hasUserGroupsOrLinks, onboardingCompleted]);

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const theme = data.settings.theme;
    root.lang = data.settings.language;

    function applyTheme() {
      const dark = theme === "dark" || (theme === "system" && systemDark.matches);
      root.classList.toggle("dark", dark);
    }

    applyTheme();
    systemDark.addEventListener("change", applyTheme);
    return () => systemDark.removeEventListener("change", applyTheme);
  }, [data]);

  useEffect(() => {
    if (searchOpen) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchOpen]);

  useEffect(() => {
    const focusKeyboardScope = () => {
      if (document.visibilityState !== "visible") return;
      if (isTextInput(document.activeElement) || isInteractiveControl(document.activeElement)) {
        return;
      }
      window.focus();
      keyboardFocusRef.current?.focus({ preventScroll: true });
    };

    window.requestAnimationFrame(focusKeyboardScope);
    const timeoutIds = [0, 50, 150, 300, 700, 1200].map((delay) => window.setTimeout(focusKeyboardScope, delay));
    window.addEventListener("pageshow", focusKeyboardScope);
    window.addEventListener("focus", focusKeyboardScope);
    document.addEventListener("visibilitychange", focusKeyboardScope);

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      window.removeEventListener("pageshow", focusKeyboardScope);
      window.removeEventListener("focus", focusKeyboardScope);
      document.removeEventListener("visibilitychange", focusKeyboardScope);
    };
  }, []);

  const parsedSearch = useMemo(() => parseSearchQuery(search), [search]);
  const searchMode = searchHasQuery(parsedSearch);
  const searchTerms = useMemo(() => searchHighlightTerms(parsedSearch), [parsedSearch]);
  const filteredGroups = useMemo(() => {
    if (!data) return [];
    const sortedGroups = data.groups.slice().sort((a, b) => a.order - b.order);
    return filterGroupsForSearch(sortedGroups, parsedSearch);
  }, [data, parsedSearch]);
  const searchResults = useMemo(() => (searchMode ? flattenSearchResults(filteredGroups) : []), [filteredGroups, searchMode]);

  useEffect(() => {
    if (!searchMode || !searchResults.length) {
      setSelectedSearchResultId(null);
      return;
    }

    setSelectedSearchResultId((current) => {
      if (current && searchResults.some((result) => resultIdentity(result) === current)) {
        return current;
      }

      return resultIdentity(searchResults[0]);
    });
  }, [searchMode, searchResults]);

  const openSearchResult = (result: SearchResult) => {
    if (!data) return;
    if (data.settings.openLinksInNewTab) {
      window.open(result.link.url, "_blank", "noopener");
      return;
    }

    window.location.assign(result.link.url);
  };

  const selectSearchResult = (offset: number) => {
    if (!searchResults.length) return;
    const currentIndex = selectedSearchResultId
      ? searchResults.findIndex((result) => resultIdentity(result) === selectedSearchResultId)
      : -1;
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + offset + searchResults.length) % searchResults.length;
    const nextId = resultIdentity(searchResults[nextIndex]);
    setSelectedSearchResultId(nextId);
    scrollSearchResultIntoView(nextId);
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const blockingModalOpen =
        groupDialogOpen ||
        linkDialogOpen ||
        settingsOpen ||
        importOpen ||
        restoreOpen ||
        duplicateFinderOpen ||
        onboardingOpen ||
        deviceAuth ||
        pendingDanger;
      const modalOpen = blockingModalOpen || commandPaletteOpen;
      const searchInputFocused = event.target === searchInputRef.current;
      const typingTarget = isTextInput(event.target);
      const key = event.key.toLowerCase();
      const code = event.code;
      const modified = event.altKey || event.metaKey || event.ctrlKey;
      const commandPaletteShortcut = (event.ctrlKey || event.metaKey) && (key === "k" || code === "KeyK");

      if (commandPaletteShortcut && !typingTarget) {
        if (event.cancelable) {
          event.preventDefault();
        }
        event.stopPropagation();
        setCommandPaletteOpen((open) => {
          if (open) return false;
          return blockingModalOpen ? open : true;
        });
        return;
      }

      if (event.defaultPrevented) return;

      if (modalOpen) {
        return;
      }

      if ((event.key === "/" || code === "Slash") && !typingTarget) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.key === "Escape" && (search || searchOpen)) {
        event.preventDefault();
        setSearch("");
        setSearchOpen(false);
        return;
      }

      if (typingTarget && !searchInputFocused) {
        return;
      }

      if (searchMode && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        selectSearchResult(event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (searchMode && event.key === "Enter" && selectedSearchResultId && (searchInputFocused || !isInteractiveControl(event.target))) {
        const selected = searchResults.find((result) => resultIdentity(result) === selectedSearchResultId);
        if (selected) {
          event.preventDefault();
          openSearchResult(selected);
        }
        return;
      }

      if (modified || typingTarget) {
        return;
      }

      if (key === "e" || code === "KeyE") {
        event.preventDefault();
        setEditMode((value) => !value);
        return;
      }

      if (key === "n" || code === "KeyN") {
        event.preventDefault();
        openAddLink();
        return;
      }

      if (key === "g" || code === "KeyG") {
        event.preventDefault();
        openAddGroup();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    groupDialogOpen,
    commandPaletteOpen,
    deviceAuth,
    duplicateFinderOpen,
    importOpen,
    linkDialogOpen,
    onboardingOpen,
    pendingDanger,
    restoreOpen,
    search,
    searchMode,
    searchOpen,
    searchResults,
    selectedSearchResultId,
    settingsOpen
  ]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;

    const blockingModalOpen = Boolean(
      groupDialogOpen ||
        linkDialogOpen ||
        settingsOpen ||
        importOpen ||
        restoreOpen ||
        duplicateFinderOpen ||
        onboardingOpen ||
        deviceAuth ||
        pendingDanger
    );

    const handleRuntimeMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== TOGGLE_COMMAND_PALETTE_MESSAGE) {
        return;
      }
      if (document.visibilityState !== "visible") return;

      setCommandPaletteOpen((open) => (open ? false : !blockingModalOpen));
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, [
    duplicateFinderOpen,
    deviceAuth,
    groupDialogOpen,
    importOpen,
    linkDialogOpen,
    onboardingOpen,
    pendingDanger,
    restoreOpen,
    settingsOpen
  ]);

  const showError = (message: string) => {
    addToast({ type: "error", title: t(data?.settings.language ?? fallbackLanguage, "actionFailed"), message });
  };

  const openAddGroup = () => {
    setEditingGroup(null);
    setGroupDialogOpen(true);
  };

  const openAddLink = (groupId?: string) => {
    setEditingLink(null);
    setInitialLinkGroupId(groupId);
    setLinkDialogOpen(true);
  };

  const toggleSearch = () => {
    if (searchOpen || search) {
      setSearch("");
      setSearchOpen(false);
      return;
    }

    setSearchOpen(true);
  };

  const closeSettingsAndOpenImport = () => {
    setSettingsOpen(false);
    openImport("aura_json");
  };

  const closeSettingsAndOpenAFineStartImport = () => {
    setSettingsOpen(false);
    openImport("a_fine_start");
  };

  const closeSettingsAndOpenRestore = () => {
    setSettingsOpen(false);
    setRestoreOpen(true);
  };

  const closeSettingsAndOpenDuplicateFinder = () => {
    setSettingsOpen(false);
    setDuplicateFinderOpen(true);
  };

  const openImport = (format: ImportDialogFormat) => {
    setImportFormat(format);
    setImportOpen(true);
  };

  const keyboardFocusTarget = (
    <input
      ref={keyboardFocusRef}
      data-keyboard-focus-target="true"
      tabIndex={-1}
      readOnly
      aria-label={t(data?.settings.language ?? fallbackLanguage, "keyboardShortcuts")}
      className="sr-only"
      autoFocus
    />
  );

  if (status === "loading" || status === "idle") {
    return (
      <>
        {keyboardFocusTarget}
        <main className="app-shell flex items-center justify-center">
          <div className="surface rounded-xl px-5 py-4 text-sm font-semibold">{t(fallbackLanguage, "loadingAuraStart")}</div>
        </main>
      </>
    );
  }

  if (status === "corrupt") {
    return (
      <>
        {keyboardFocusTarget}
        <RecoveryScreen language={fallbackLanguage} message={error ?? t(fallbackLanguage, "storageCorrupt")} raw={corruptRaw} onError={showError} onReset={resetCorruptData} />
        <Toasts />
      </>
    );
  }

  if (!data) {
    return (
      <>
        {keyboardFocusTarget}
        <main className="app-shell flex items-center justify-center">
          <div className="surface rounded-xl p-6">
            <h1 className="text-xl font-semibold">{t(fallbackLanguage, "unavailableTitle")}</h1>
            <p className="muted mt-2 text-sm">{error ?? t(fallbackLanguage, "couldNotLoadLocalData")}</p>
          </div>
        </main>
      </>
    );
  }

  const hasLinks = data.groups.some((group) => group.links.length > 0);
  const language = data.settings.language;
  const openSettingsSection = () => {
    setSettingsOpen(true);
  };
  const commands: CommandPaletteCommand[] = [
    {
      id: "search",
      title: t(language, "commandSearchLinks"),
      description: t(language, "pressSlashToSearch"),
      keywords: ["find", "links"],
      action: () => setSearchOpen(true)
    },
    {
      id: "new-group",
      title: t(language, "commandCreateNewGroup"),
      keywords: ["group", "create"],
      action: openAddGroup
    },
    {
      id: "new-link",
      title: t(language, "commandCreateNewLink"),
      keywords: ["link", "create"],
      action: () => openAddLink()
    },
    {
      id: "toggle-edit",
      title: t(language, "commandToggleEditMode"),
      keywords: ["edit"],
      action: () => setEditMode((value) => !value)
    },
    {
      id: "export-backup",
      title: t(language, "commandExportBackup"),
      description: t(language, "exportJsonDescription"),
      keywords: ["backup", "json", "export"],
      action: () => exportJsonBackup(data)
    },
    {
      id: "import-backup",
      title: t(language, "commandImportBackup"),
      keywords: ["backup", "json", "import"],
      action: () => openImport("aura_json")
    },
    {
      id: "import-afs",
      title: t(language, "commandImportFromAFineStart"),
      keywords: ["a fine start", "migration"],
      action: () => openImport("a_fine_start")
    },
    {
      id: "settings",
      title: t(language, "commandOpenSettings"),
      keywords: ["settings"],
      action: openSettingsSection
    },
    {
      id: "theme",
      title: t(language, "commandToggleTheme"),
      keywords: ["theme", "dark", "light"],
      action: async () => updateSettings({ theme: data.settings.theme === "dark" ? "light" : "dark" })
    },
    {
      id: "restore-points",
      title: t(language, "commandOpenRestorePoints"),
      keywords: ["restore", "backup"],
      action: () => setRestoreOpen(true)
    },
    {
      id: "privacy",
      title: t(language, "commandOpenPrivacyPromise"),
      description: t(language, "commandOpensSettingsSection"),
      keywords: ["privacy"],
      action: openSettingsSection
    },
    {
      id: "shortcuts",
      title: t(language, "commandOpenKeyboardShortcuts"),
      description: t(language, "commandOpensSettingsSection"),
      keywords: ["keyboard", "shortcuts"],
      action: openSettingsSection
    },
    {
      id: "duplicates",
      title: t(language, "commandOpenDuplicateFinder"),
      keywords: ["duplicate", "cleanup"],
      action: () => setDuplicateFinderOpen(true)
    },
    data.settings.sync.connected
      ? {
          id: "disconnect-drive",
          title: t(language, "commandDisconnectGoogleDrive"),
          description: t(language, "commandOpensSettingsSection"),
          keywords: ["google", "drive", "disconnect"],
          action: openSettingsSection
        }
      : {
          id: "connect-drive",
          title: t(language, "commandConnectGoogleDrive"),
          keywords: ["google", "drive", "sync"],
          action: connectGoogleDrive
        }
  ];
  const dangerTitle = (() => {
    switch (pendingDanger?.type) {
      case "resetAll":
        return t(language, "resetAuraStart");
      case "removeDemoData":
        return t(language, "removeDemoData");
      case "deleteGroup":
        return t(language, "deleteThisGroup");
      case "deleteLink":
        return t(language, "deleteThisLink");
      default:
        return "";
    }
  })();
  const dangerMessage = (() => {
    switch (pendingDanger?.type) {
      case "resetAll":
        return t(language, "resetAllDataMessage");
      case "removeDemoData":
        return t(language, "removeDemoDataMessage");
      case "deleteGroup":
        return t(language, "deleteThisGroupMessage", { title: pendingDanger.group.title });
      case "deleteLink":
        return t(language, "deleteThisLinkMessage", { title: pendingDanger.link.title });
      default:
        return "";
    }
  })();
  const dangerConfirmLabel = (() => {
    switch (pendingDanger?.type) {
      case "resetAll":
        return t(language, "resetAllData");
      case "removeDemoData":
        return t(language, "removeDemoData");
      case "deleteLink":
        return t(language, "delete");
      case "deleteGroup":
        return t(language, "deleteGroup");
      default:
        return t(language, "delete");
    }
  })();

  return (
    <div className={`afs-like ${data.settings.compactMode ? "compact" : ""}`}>
      {keyboardFocusTarget}
      <main className="app-shell">
        <div className="container-narrow">
          {usingFallbackStorage ? (
            <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-strong)]">
              {t(language, "storageFallbackNotice")}
            </div>
          ) : null}
          <Header
            data={data}
            editMode={editMode}
            search={search}
            searchInputRef={searchInputRef}
            syncMessage={syncMessage}
            syncStatus={syncStatus}
            onAddGroup={openAddGroup}
            onAddLink={() => openAddLink()}
            onExportError={showError}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onOpenImport={() => openImport("aura_json")}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={toggleSearch}
            onToggleEditMode={() => setEditMode((value) => !value)}
            onSearchChange={(value) => {
              setSearch(value);
              if (value) {
                setSearchOpen(true);
              }
            }}
            searchOpen={searchOpen}
          />
          {filteredGroups.length ? (
            <GroupGrid
              data={data}
              editMode={editMode}
              groups={filteredGroups}
              highlightTerms={searchTerms}
              searchMode={searchMode}
              selectedSearchResultId={selectedSearchResultId}
              onAddLink={openAddLink}
              onDeleteGroup={(group) => setPendingDanger({ type: "deleteGroup", group })}
              onDeleteLink={(groupId, link) => setPendingDanger({ type: "deleteLink", groupId, link })}
              onEditGroup={(group) => {
                setEditingGroup(group);
                setGroupDialogOpen(true);
              }}
              onEditLink={(groupId, link) => {
                setEditingLink({ groupId, link });
                setLinkDialogOpen(true);
              }}
              onMoveLink={(linkId, targetGroupId, overLinkId) => {
                return moveLink(linkId, targetGroupId, overLinkId).catch((caught: unknown) =>
                  showError(caught instanceof Error ? caught.message : t(language, "couldNotMoveLink"))
                );
              }}
              onReorderGroups={(orderedGroupIds) => {
                return reorderGroups(orderedGroupIds).catch((caught: unknown) =>
                  showError(caught instanceof Error ? caught.message : t(language, "couldNotReorderGroups"))
                );
              }}
              onToggle={(groupId) => {
                void toggleGroupCollapsed(groupId).catch((caught: unknown) =>
                  showError(caught instanceof Error ? caught.message : t(language, "couldNotUpdateGroup"))
                );
              }}
            />
          ) : (
            <EmptyState
              mode={searchMode || hasLinks ? "search" : "empty"}
              language={language}
              onAddGroup={openAddGroup}
              onAddDemoData={() => {
                void addDemoData().catch((caught: unknown) =>
                  showError(caught instanceof Error ? caught.message : t(language, "couldNotCompleteAction"))
                );
              }}
              onImportAFineStart={() => openImport("a_fine_start")}
              onImportBackup={() => openImport("aura_json")}
            />
          )}
        </div>
      </main>

      <AddEditGroupDialog
        group={editingGroup}
        language={language}
        open={groupDialogOpen}
        onClose={() => setGroupDialogOpen(false)}
        onError={showError}
        onSubmit={async (title) => {
          if (editingGroup) {
            await updateGroupTitle(editingGroup.id, title);
          } else {
            await addGroup(title);
          }
        }}
      />
      <AddEditLinkDialog
        editing={editingLink}
        groups={data.groups}
        initialGroupId={initialLinkGroupId}
        language={language}
        open={linkDialogOpen}
        onAdd={addLink}
        onClose={() => setLinkDialogOpen(false)}
        onCreateGroup={addGroup}
        onError={showError}
        onUpdate={updateLink}
      />
      <SettingsDialog
        data={data}
        open={settingsOpen}
        syncConflict={syncConflict}
        syncMessage={syncMessage}
        syncStatus={syncStatus}
        onConnectGoogleDrive={connectGoogleDrive}
        onClose={() => setSettingsOpen(false)}
        onDisconnectGoogleDrive={disconnectGoogleDrive}
        onDeleteGoogleDriveBackupAndDisconnect={deleteGoogleDriveBackupAndDisconnect}
        onError={showError}
        hasDemoData={hasTrackedDemoData}
        onOpenDuplicateFinder={closeSettingsAndOpenDuplicateFinder}
        onOpenImport={closeSettingsAndOpenImport}
        onOpenImportAFineStart={closeSettingsAndOpenAFineStartImport}
        onOpenOnboarding={() => {
          setSettingsOpen(false);
          setOnboardingOpen(true);
        }}
        onOpenRestorePoints={closeSettingsAndOpenRestore}
        onRemoveDemoData={() => setPendingDanger({ type: "removeDemoData" })}
        onResolveSyncConflict={resolveSyncConflict}
        onReset={() => setPendingDanger({ type: "resetAll" })}
        onUpdateSettings={updateSettings}
      />
      <ImportDialog
        currentData={data}
        initialFormat={importFormat}
        language={language}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onError={showError}
        onImport={importBackup}
      />
      <OnboardingDialog
        data={data}
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onComplete={completeOnboarding}
        onError={showError}
        onImportAFineStart={() => openImport("a_fine_start")}
        onImportBackup={() => openImport("aura_json")}
        onRestoreGoogleDrive={() => restoreFromGoogleDrive({ requireExistingFile: true })}
        onUpdateSettings={updateSettings}
      />
      <RestorePointsDialog
        language={language}
        open={restoreOpen}
        restorePoints={data.restorePoints}
        onClose={() => setRestoreOpen(false)}
        onCreate={createManualRestorePoint}
        onDeleteAll={deleteAllRestorePoints}
        onDelete={deleteRestorePoint}
        onError={showError}
        onRestore={restoreRestorePoint}
      />
      <DuplicateFinderDialog
        data={data}
        language={language}
        open={duplicateFinderOpen}
        onClose={() => setDuplicateFinderOpen(false)}
        onDeleteSelected={deleteLinksWithRestorePoint}
        onError={showError}
      />
      <CommandPalette
        commands={commands}
        language={language}
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onError={showError}
      />
      <Modal
        closeLabel={t(language, "closeDialog")}
        closeOnBackdrop={false}
        description={t(language, "googleDriveDeviceAuthDescription")}
        open={Boolean(deviceAuth)}
        size="sm"
        title={t(language, "googleDriveDeviceAuthTitle")}
        onClose={() => setDeviceAuth(null)}
      >
        <div className="space-y-4">
          <div>
            <div className="muted mb-2 text-sm font-semibold">{t(language, "googleDriveDeviceAuthCodeLabel")}</div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-center font-mono text-2xl font-semibold">
              {deviceAuth?.userCode}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              className="btn btn-primary flex-1"
              href={deviceAuth?.verificationUrlComplete ?? deviceAuth?.verificationUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t(language, "googleDriveDeviceAuthOpen")}
            </a>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                if (deviceAuth?.userCode) {
                  void navigator.clipboard?.writeText(deviceAuth.userCode);
                }
              }}
            >
              {t(language, "copy")}
            </button>
          </div>
          <p className="muted text-sm">{t(language, "googleDriveDeviceAuthWaiting")}</p>
        </div>
      </Modal>
      <ConfirmDialog
        cancelLabel={t(language, "cancel")}
        confirmLabel={dangerConfirmLabel}
        message={dangerMessage}
        open={pendingDanger !== null}
        title={dangerTitle}
        onCancel={() => setPendingDanger(null)}
        onConfirm={async () => {
          try {
            if (pendingDanger?.type === "resetAll") {
              await resetAllData();
            }
            if (pendingDanger?.type === "removeDemoData") {
              await removeDemoData();
            }
            if (pendingDanger?.type === "deleteGroup") {
              await deleteGroup(pendingDanger.group.id);
            }
            if (pendingDanger?.type === "deleteLink") {
              await deleteLink(pendingDanger.groupId, pendingDanger.link.id);
            }
            setPendingDanger(null);
          } catch (caught) {
            showError(caught instanceof Error ? caught.message : t(language, "couldNotCompleteAction"));
          }
        }}
      />
      <Toasts />
    </div>
  );
}
