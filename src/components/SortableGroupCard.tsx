import { useSortable } from "@dnd-kit/sortable";
import type { ReactNode } from "react";
import type { AuraStartGroup, AuraStartLink, AuraStartSettings } from "../types";
import type { SearchHighlightMap } from "../utils/search";
import type { DropPlacement } from "../utils/dragPlacement";
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
  hasChildren?: boolean;
  placement?: DropPlacement | null;
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
    data: { type: "group", groupId: props.group.id, parentId: props.group.parentId, order: props.group.order, hasChildren: props.hasChildren },
    animateLayoutChanges: () => false,
    transition: {
      duration: 165,
      easing: "cubic-bezier(0.2, 0, 0, 1)"
    }
  });

  return (
    <div
      className={`sortable-group-shell group-tree-depth-${props.depth ?? 0} ${sortable.isDragging ? "group-shell-dragging" : ""}`}
      data-group-id={props.group.id}
      data-drop-edge={props.placement?.kind === "group" && props.placement.markerId === `group:${props.group.id}` ? props.placement.edge : undefined}
      data-drop-axis={props.placement?.axis}
      ref={sortable.setNodeRef}
    >
      <BookmarkGroupCard
        {...props}
        sortable={{
          setActivatorNodeRef: sortable.setActivatorNodeRef,
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
