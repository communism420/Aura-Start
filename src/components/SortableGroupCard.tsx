import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AuraStartGroup, AuraStartLink, AuraStartSettings } from "../types";
import { BookmarkGroupCard } from "./BookmarkGroupCard";

type SortableGroupCardProps = {
  group: AuraStartGroup;
  editMode: boolean;
  activeLinkId?: string | null;
  isDropPending: boolean;
  settings: AuraStartSettings;
  searchMode: boolean;
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
    <BookmarkGroupCard
      {...props}
      sortable={{
        attributes: sortable.attributes,
        isDragging: sortable.isDragging,
        isDropPending: props.isDropPending,
        listeners: sortable.listeners,
        setNodeRef: sortable.setNodeRef,
        transform: sortable.transform ? CSS.Translate.toString(sortable.transform) ?? null : null,
        transition: sortable.transition
      }}
    />
  );
}
