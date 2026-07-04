import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import type { AuraStartGroup, AuraStartLink, AuraStartSettings } from "../types";
import type { SearchHighlightMap } from "../utils/search";
import { BookmarkGroupCard } from "./BookmarkGroupCard";

type SortableGroupCardProps = {
  group: AuraStartGroup;
  editMode: boolean;
  activeGroupId?: string | null;
  activeLinkId?: string | null;
  canAcceptChildGroups?: boolean;
  children?: ReactNode;
  depth?: number;
  highlightTerms?: string[];
  searchHighlights?: SearchHighlightMap;
  isDropPending: boolean;
  selectedSearchResultId?: string | null;
  settings: AuraStartSettings;
  searchMode: boolean;
  onAddGroup: (parentId?: string | null) => void;
  onAddLink: (groupId: string) => void;
  onEditGroup: (group: AuraStartGroup) => void;
  onDeleteGroup: (group: AuraStartGroup) => void;
  onToggle: (groupId: string) => void;
  onEditLink: (groupId: string, link: AuraStartLink) => void;
  onDeleteLink: (groupId: string, link: AuraStartLink) => void;
};

export function SortableGroupCard(props: SortableGroupCardProps) {
  const sortable = useSortable({
    id: `group:${props.group.id}`,
    disabled: props.searchMode || !props.editMode,
    data: { type: "group", groupId: props.group.id },
    transition: {
      duration: 165,
      easing: "cubic-bezier(0.2, 0, 0, 1)"
    }
  });

  return (
    <div
      className={`sortable-group-shell group-tree-depth-${props.depth ?? 0}`}
      data-group-id={props.group.id}
      ref={sortable.setNodeRef}
      style={{
        transform: sortable.transform ? CSS.Translate.toString(sortable.transform) ?? undefined : undefined,
        transition: sortable.transition
      }}
    >
      <BookmarkGroupCard
        {...props}
        sortable={{
          attributes: sortable.attributes,
          isDragging: sortable.isDragging,
          isDropPending: props.isDropPending,
          listeners: sortable.listeners
        }}
      />
      {props.children}
    </div>
  );
}
