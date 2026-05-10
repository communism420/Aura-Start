import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AuraStartLink, AuraStartSettings } from "../types";
import { BookmarkLinkItem } from "./BookmarkLinkItem";

type SortableLinkItemProps = {
  link: AuraStartLink;
  groupId: string;
  settings: AuraStartSettings;
  disabled: boolean;
  editMode: boolean;
  isDropPending: boolean;
  onEdit: (groupId: string, link: AuraStartLink) => void;
  onDelete: (groupId: string, link: AuraStartLink) => void;
};

export function SortableLinkItem({
  link,
  groupId,
  settings,
  disabled,
  editMode,
  isDropPending,
  onEdit,
  onDelete
}: SortableLinkItemProps) {
  const sortable = useSortable({
    id: `link:${link.id}`,
    disabled,
    data: { type: "link", linkId: link.id, groupId },
    transition: {
      duration: 145,
      easing: "cubic-bezier(0.2, 0, 0, 1)"
    }
  });
  const transform = sortable.transform ? CSS.Translate.toString(sortable.transform) : undefined;

  return (
    <div
      className="sortable-link-shell"
      ref={sortable.setNodeRef}
      style={{ transform, transition: sortable.transition }}
    >
      <BookmarkLinkItem
        dragAttributes={sortable.attributes}
        dragListeners={sortable.listeners}
        dragging={sortable.isDragging || isDropPending}
        editMode={editMode}
        groupId={groupId}
        link={link}
        settings={settings}
        onDelete={onDelete}
        onEdit={onEdit}
      />
    </div>
  );
}
