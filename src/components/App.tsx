import { useEffect, useMemo, useRef, useState } from "react";
import { AddEditGroupDialog } from "./AddEditGroupDialog";
import { AddEditLinkDialog, type EditingLink } from "./AddEditLinkDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { GroupGrid } from "./GroupGrid";
import { Header } from "./Header";
import { ImportDialog } from "./ImportDialog";
import { RecoveryScreen } from "./RecoveryScreen";
import { RestorePointsDialog } from "./RestorePointsDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Toasts } from "./Toasts";
import { DEFAULT_SETTINGS } from "../constants";
import { t } from "../i18n";
import { useAuraStore } from "../store/useAuraStore";
import type { AuraStartGroup, AuraStartLink } from "../types";

type AppProps = {
  initialSettingsOpen?: boolean;
};

type PendingDanger =
  | { type: "deleteGroup"; group: AuraStartGroup }
  | { type: "resetAll" }
  | null;

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function matchesSearch(link: AuraStartLink, query: string): boolean {
  const haystack = [link.title, link.url, link.description ?? "", ...(link.tags ?? [])].join(" ").toLowerCase();
  return haystack.includes(query);
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
    load,
    resetCorruptData,
    updateSettings,
    addGroup,
    updateGroupTitle,
    toggleGroupCollapsed,
    deleteGroup,
    addLink,
    updateLink,
    deleteLink,
    reorderGroups,
    moveLink,
    importBackup,
    resetAllData,
    createManualRestorePoint,
    restoreRestorePoint,
    deleteRestorePoint,
    connectGoogleDrive,
    disconnectGoogleDrive,
    backupToGoogleDrive,
    restoreFromGoogleDrive,
    syncNow,
    setSyncMode,
    deleteGoogleDriveSyncFile,
    resolveSyncConflict,
    addToast
  } = useAuraStore();

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<AuraStartGroup | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [initialLinkGroupId, setInitialLinkGroupId] = useState<string | undefined>();
  const [editingLink, setEditingLink] = useState<EditingLink | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [importOpen, setImportOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [pendingDanger, setPendingDanger] = useState<PendingDanger>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackLanguage = DEFAULT_SETTINGS.language;

  useEffect(() => {
    void load();
  }, [load]);

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
    function handleKeyDown(event: KeyboardEvent) {
      const modalOpen = groupDialogOpen || linkDialogOpen || settingsOpen || importOpen || restoreOpen || pendingDanger;
      if ((event.key === "/" || (event.ctrlKey && event.key.toLowerCase() === "k")) && !isTextInput(event.target)) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.key === "Escape" && search && !modalOpen) {
        setSearch("");
        setSearchOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [groupDialogOpen, importOpen, linkDialogOpen, pendingDanger, restoreOpen, search, settingsOpen]);

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    const sortedGroups = data.groups.slice().sort((a, b) => a.order - b.order);
    if (!query) return sortedGroups;

    return sortedGroups
      .map((group) => ({
        ...group,
        collapsed: false,
        links: group.links.filter((link) => matchesSearch(link, query))
      }))
      .filter((group) => group.links.length > 0 || group.title.toLowerCase().includes(query));
  }, [data, search]);

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
    setImportOpen(true);
  };

  const closeSettingsAndOpenRestore = () => {
    setSettingsOpen(false);
    setRestoreOpen(true);
  };

  if (status === "loading" || status === "idle") {
    return (
      <main className="app-shell flex items-center justify-center">
        <div className="surface rounded-xl px-5 py-4 text-sm font-semibold">{t(fallbackLanguage, "loadingAuraStart")}</div>
      </main>
    );
  }

  if (status === "corrupt") {
    return (
      <>
        <RecoveryScreen language={fallbackLanguage} message={error ?? t(fallbackLanguage, "storageCorrupt")} raw={corruptRaw} onError={showError} onReset={resetCorruptData} />
        <Toasts />
      </>
    );
  }

  if (!data) {
    return (
      <main className="app-shell flex items-center justify-center">
        <div className="surface rounded-xl p-6">
          <h1 className="text-xl font-semibold">{t(fallbackLanguage, "unavailableTitle")}</h1>
          <p className="muted mt-2 text-sm">{error ?? t(fallbackLanguage, "couldNotLoadLocalData")}</p>
        </div>
      </main>
    );
  }

  const hasLinks = data.groups.some((group) => group.links.length > 0);
  const searchMode = search.trim().length > 0;
  const language = data.settings.language;

  return (
    <div className={`afs-like ${data.settings.compactMode ? "compact" : ""}`}>
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
            onOpenImport={() => setImportOpen(true)}
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
              searchMode={searchMode}
              onAddLink={openAddLink}
              onDeleteGroup={(group) => setPendingDanger({ type: "deleteGroup", group })}
              onDeleteLink={(groupId, link) => {
                void deleteLink(groupId, link.id).catch((caught: unknown) =>
                  showError(caught instanceof Error ? caught.message : t(language, "couldNotDeleteLink"))
                );
              }}
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
              onAddLink={() => openAddLink()}
              onImport={() => setImportOpen(true)}
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
        onBackupToGoogleDrive={() => backupToGoogleDrive()}
        onConnectGoogleDrive={connectGoogleDrive}
        onClose={() => setSettingsOpen(false)}
        onDeleteGoogleDriveSyncFile={deleteGoogleDriveSyncFile}
        onDisconnectGoogleDrive={disconnectGoogleDrive}
        onError={showError}
        onOpenImport={closeSettingsAndOpenImport}
        onOpenRestorePoints={closeSettingsAndOpenRestore}
        onResolveSyncConflict={resolveSyncConflict}
        onRestoreFromGoogleDrive={restoreFromGoogleDrive}
        onReset={() => setPendingDanger({ type: "resetAll" })}
        onSetSyncMode={setSyncMode}
        onSyncGoogleDriveNow={syncNow}
        onUpdateSettings={updateSettings}
      />
      <ImportDialog
        language={language}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onError={showError}
        onImport={importBackup}
      />
      <RestorePointsDialog
        language={language}
        open={restoreOpen}
        restorePoints={data.restorePoints}
        onClose={() => setRestoreOpen(false)}
        onCreate={createManualRestorePoint}
        onDelete={deleteRestorePoint}
        onError={showError}
        onRestore={restoreRestorePoint}
      />
      <ConfirmDialog
        cancelLabel={t(language, "cancel")}
        confirmLabel={pendingDanger?.type === "resetAll" ? t(language, "resetAllData") : t(language, "deleteGroup")}
        message={
          pendingDanger?.type === "resetAll"
            ? t(language, "resetAllDataMessage")
            : t(language, "deleteThisGroupMessage", { title: pendingDanger?.group.title ?? t(language, "deleteThisGroupFallback") })
        }
        open={pendingDanger !== null}
        title={pendingDanger?.type === "resetAll" ? t(language, "resetAuraStart") : t(language, "deleteThisGroup")}
        onCancel={() => setPendingDanger(null)}
        onConfirm={async () => {
          try {
            if (pendingDanger?.type === "resetAll") {
              await resetAllData();
            }
            if (pendingDanger?.type === "deleteGroup") {
              await deleteGroup(pendingDanger.group.id);
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
