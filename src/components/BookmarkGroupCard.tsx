import { SortableContext } from "@dnd-kit/sortable";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { useLayoutEffect } from "react";
import { ChevronDown, ChevronRight, FolderPlus, GripVertical, LinkIcon, Pencil, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { AuraStartGroup, AuraStartLink, AuraStartSettings } from "../types";
import { searchResultId, type SearchHighlightMap } from "../utils/search";
import { BookmarkLinkItem } from "./BookmarkLinkItem";
import { HighlightedText } from "./HighlightedText";
import { SortableLinkItem } from "./SortableLinkItem";
import type { DropPlacement } from "../utils/dragPlacement";
import { projectLinkDragPreview } from "../utils/linkDragPreview";

const stationarySortingStrategy = () => null;

type BookmarkGroupCardProps = {
  group: AuraStartGroup;
  settings: AuraStartSettings;
  searchMode: boolean;
  editMode: boolean;
  overlay?: boolean;
  placement?: DropPlacement | null;
  activeGroupId?: string | null;
  activeLinkId?: string | null;
  canAcceptChildGroups?: boolean;
  depth?: number;
  highlightTerms?: string[];
  searchHighlights?: SearchHighlightMap;
  selectedSearchResultId?: string | null;
  sortable?: {
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    attributes: React.HTMLAttributes<HTMLElement>;
    listeners: React.HTMLAttributes<HTMLElement> | undefined;
    isDragging: boolean;
    isDropPending: boolean;
  };
  onAddGroup: (parentId?: string | null) => void;
  onAddLink: (groupId: string) => void;
  onEditGroup: (group: AuraStartGroup) => void;
  onDeleteGroup: (group: AuraStartGroup) => void;
  onToggle: (groupId: string) => void;
  onEditLink: (groupId: string, link: AuraStartLink) => void;
  onDeleteLink: (groupId: string, link: AuraStartLink) => void;
};

export function BookmarkGroupCard({
  group,
  settings,
  searchMode,
  editMode,
  overlay = false,
  placement,
  activeGroupId,
  activeLinkId,
  canAcceptChildGroups = false,
  depth = 0,
  highlightTerms = [],
  searchHighlights,
  selectedSearchResultId,
  sortable,
  onAddGroup,
  onAddLink,
  onEditGroup,
  onDeleteGroup,
  onToggle,
  onEditLink,
  onDeleteLink
}: BookmarkGroupCardProps) {
  const droppable = useDroppable({
    id: `${overlay ? "overlay-" : ""}group-drop:${group.id}`,
    data: { type: "group-drop", groupId: group.id, collapsed: group.collapsed, empty: group.links.length === 0 },
    disabled: overlay || searchMode || !editMode || Boolean(activeGroupId)
  });
  const childDroppable = useDroppable({
    id: `${overlay ? "overlay-" : ""}group-child-drop:${group.id}`,
    data: { type: "group-child-drop", groupId: group.id },
    disabled: overlay || searchMode || !editMode || !canAcceptChildGroups
  });
  const collapsed = group.collapsed && !searchMode;
  const sortedLinks = group.links.slice().sort((a, b) => a.order - b.order);
  const { active, droppableRects, measureDroppableContainers } = useDndContext();
  const previewRows = sortedLinks.flatMap((link) => {
    const rect = droppableRects.get(`link:${link.id}`);
    return rect ? [{ id: link.id, top: rect.top, height: rect.height }] : [];
  });
  const firstTop = previewRows[0]?.top ?? 0;
  const preview = !overlay && !collapsed && activeLinkId && placement?.kind === "link"
    && placement.containerId === group.id && previewRows.length === sortedLinks.length && previewRows.length > 0
    ? projectLinkDragPreview(previewRows.map((row) => ({ ...row, top: row.top - firstTop })),
      activeLinkId, active?.rect.current.initial?.height ?? 0, placement.beforeId)
    : null;
  const extraHeight = preview?.extraHeight ?? 0;
  // The end spacer makes room for incoming links and moves following groups.
  // Remeasure their real layout once; inner-row transforms never affect hits.
  useLayoutEffect(() => {
    if (activeLinkId) measureDroppableContainers([]);
  }, [activeLinkId, extraHeight, measureDroppableContainers]);
  const language = settings.language;
  const stopDragActivation = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };
  const content = (
    <section
      className={`bookmark-group ${editMode ? "bookmark-group-editing" : ""} ${sortable?.isDragging || sortable?.isDropPending ? "group-placeholder" : ""}`}
      ref={droppable.setNodeRef}
      data-drop-edge={placement?.kind === "link" && placement.markerId === `group-drop:${group.id}` ? "inside" : undefined}
    >
      {editMode && sortable?.listeners ? (
        <div
          aria-hidden="true"
          className="group-drag-rail"
          {...sortable.listeners}
        />
      ) : null}
      <div
        className="group-name-row"
        onPointerDown={editMode ? sortable?.listeners?.onPointerDown : undefined}
      >
        {editMode ? (
          <button
            {...sortable?.attributes}
            {...sortable?.listeners}
            ref={sortable?.setActivatorNodeRef}
            aria-label={t(language, "dragGroup", { title: group.title })}
            className="group-handle"
            type="button"
          >
            <GripVertical size={13} />
          </button>
        ) : null}
        {editMode ? (
          <span aria-hidden="true" className="group-fold group-fold-disabled">
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </span>
        ) : (
          <button
            aria-label={collapsed ? t(language, "expandGroup", { title: group.title }) : t(language, "collapseGroup", { title: group.title })}
            className="group-fold"
            type="button"
            onPointerDown={stopDragActivation}
            onClick={() => onToggle(group.id)}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
        <h2 className="group-name" title={t(language, "linksCount", { count: group.links.length })}>
          <HighlightedText ranges={searchHighlights?.groups[group.id]} terms={highlightTerms} text={group.title} />
        </h2>
        {editMode ? (
          <>
            {depth === 0 ? (
              <button
                aria-label={t(language, "addNestedGroupTo", { title: group.title })}
                className="group-action"
                type="button"
                onPointerDown={stopDragActivation}
                onClick={() => onAddGroup(group.id)}
              >
                <FolderPlus size={13} />
              </button>
            ) : null}
            <button
              aria-label={t(language, "addLinkTo", { title: group.title })}
              className="group-action"
              type="button"
              onPointerDown={stopDragActivation}
              onClick={() => onAddLink(group.id)}
            >
              <LinkIcon size={13} />
            </button>
            <button
              aria-label={t(language, "renameGroupAria", { title: group.title })}
              className="group-action"
              type="button"
              onPointerDown={stopDragActivation}
              onClick={() => onEditGroup(group)}
            >
              <Pencil size={13} />
            </button>
            <button
              aria-label={t(language, "deleteGroupAria", { title: group.title })}
              className="group-action danger-action"
              type="button"
              onPointerDown={stopDragActivation}
              onClick={() => onDeleteGroup(group)}
            >
              <Trash2 size={13} />
            </button>
          </>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="bookmark-list">
          {sortedLinks.length ? (
            searchMode || overlay ? (
              <div>
                {sortedLinks.map((link) => (
                  <BookmarkLinkItem
                    groupId={group.id}
                    editMode={editMode}
                    key={link.id}
                    link={link}
                    highlightTerms={highlightTerms}
                    highlights={searchHighlights?.links[link.id]}
                    selected={selectedSearchResultId === searchResultId(group.id, link.id)}
                    settings={settings}
                    onDelete={onDeleteLink}
                    onEdit={onEditLink}
                  />
                ))}
              </div>
            ) : (
              <SortableContext items={sortedLinks.map((link) => `link:${link.id}`)} strategy={stationarySortingStrategy}>
                <div className="bookmark-link-preview-list">
                  {sortedLinks.map((link) => (
                    <SortableLinkItem
                      placement={placement}
                      previewOffset={preview?.offsets[link.id] ?? 0}
                      linkDragActive={Boolean(activeLinkId)}
                      isDropPending={activeLinkId === link.id}
                      disabled={searchMode || !editMode}
                      editMode={editMode}
                      groupId={group.id}
                      highlightTerms={highlightTerms}
                      highlights={searchHighlights?.links[link.id]}
                      key={link.id}
                      link={link}
                      selected={selectedSearchResultId === searchResultId(group.id, link.id)}
                      settings={settings}
                      onDelete={onDeleteLink}
                      onEdit={onEditLink}
                    />
                  ))}
                  {preview ? (
                    <div aria-hidden="true" className="link-insertion-gap"
                      style={{ top: preview.gapTop, height: preview.gapHeight }} />
                  ) : null}
                  <div aria-hidden="true" className="link-insertion-space" style={{ height: extraHeight }} />
                </div>
              </SortableContext>
            )
          ) : editMode ? (
            <button
              className="empty-group-button"
              type="button"
              onClick={() => onAddLink(group.id)}
            >
              {t(language, "emptyGroupButton")}
            </button>
          ) : null}
        </div>
      ) : null}
      {canAcceptChildGroups && activeGroupId ? (
        <div
          aria-label={t(language, "dropGroupInside", { title: group.title })}
          title={t(language, "dropGroupInside", { title: group.title })}
          className={`group-child-drop-zone ${childDroppable.isOver ? "group-drop-zone-active" : ""}`}
          ref={childDroppable.setNodeRef}
          role="button"
        >
          <FolderPlus aria-hidden="true" size={12} />
          <span className="sr-only">{t(language, "dropGroupInside", { title: group.title })}</span>
        </div>
      ) : null}
    </section>
  );

  return content;
}
