import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical, LinkIcon, Pencil, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { AuraStartGroup, AuraStartLink, AuraStartSettings } from "../types";
import { searchResultId } from "../utils/search";
import { BookmarkLinkItem } from "./BookmarkLinkItem";
import { HighlightedText } from "./HighlightedText";
import { SortableLinkItem } from "./SortableLinkItem";

type BookmarkGroupCardProps = {
  group: AuraStartGroup;
  settings: AuraStartSettings;
  searchMode: boolean;
  editMode: boolean;
  activeLinkId?: string | null;
  highlightTerms?: string[];
  selectedSearchResultId?: string | null;
  sortable?: {
    setNodeRef: (node: HTMLElement | null) => void;
    attributes: React.HTMLAttributes<HTMLElement>;
    listeners: React.HTMLAttributes<HTMLElement> | undefined;
    transform: string | null;
    transition?: string;
    isDragging: boolean;
    isDropPending: boolean;
  };
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
  activeLinkId,
  highlightTerms = [],
  selectedSearchResultId,
  sortable,
  onAddLink,
  onEditGroup,
  onDeleteGroup,
  onToggle,
  onEditLink,
  onDeleteLink
}: BookmarkGroupCardProps) {
  const droppable = useDroppable({
    id: `group-drop:${group.id}`,
    data: { type: "group-drop", groupId: group.id },
    disabled: searchMode || !editMode
  });
  const collapsed = group.collapsed && !searchMode;
  const sortedLinks = group.links.slice().sort((a, b) => a.order - b.order);
  const language = settings.language;
  const stopDragActivation = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };
  const content = (
    <section
      className={`bookmark-group ${editMode ? "bookmark-group-editing" : ""} ${sortable?.isDragging || sortable?.isDropPending ? "group-placeholder" : ""}`}
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
        {...(editMode ? sortable?.attributes ?? {} : {})}
        {...(editMode ? sortable?.listeners ?? {} : {})}
      >
        {editMode ? (
          <button
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
          <HighlightedText terms={highlightTerms} text={group.title} />
        </h2>
        {editMode ? (
          <>
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
        <div className="bookmark-list" ref={droppable.setNodeRef}>
          {sortedLinks.length ? (
            searchMode ? (
              <div>
                {sortedLinks.map((link) => (
                  <BookmarkLinkItem
                    groupId={group.id}
                    editMode={editMode}
                    key={link.id}
                    link={link}
                    highlightTerms={highlightTerms}
                    selected={selectedSearchResultId === searchResultId(group.id, link.id)}
                    settings={settings}
                    onDelete={onDeleteLink}
                    onEdit={onEditLink}
                  />
                ))}
              </div>
            ) : (
              <SortableContext items={sortedLinks.map((link) => `link:${link.id}`)} strategy={verticalListSortingStrategy}>
                <div>
                  {sortedLinks.map((link) => (
                    <SortableLinkItem
                      isDropPending={activeLinkId === link.id}
                      disabled={searchMode || !editMode}
                      editMode={editMode}
                      groupId={group.id}
                      highlightTerms={highlightTerms}
                      key={link.id}
                      link={link}
                      selected={selectedSearchResultId === searchResultId(group.id, link.id)}
                      settings={settings}
                      onDelete={onDeleteLink}
                      onEdit={onEditLink}
                    />
                  ))}
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
    </section>
  );

  if (!sortable) {
    return content;
  }

  return (
    <div
      className="sortable-group-shell"
      ref={sortable.setNodeRef}
      style={{ transform: sortable.transform ?? undefined, transition: sortable.transition }}
    >
      {content}
    </div>
  );
}
