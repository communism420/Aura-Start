import { useSortable } from "@dnd-kit/sortable";
import type { AuraStartLink, AuraStartSettings } from "../types";
import type { LinkSearchHighlights } from "../utils/search";
import type { DropPlacement } from "../utils/dragPlacement";
import { BookmarkLinkItem } from "./BookmarkLinkItem";

type SortableLinkItemProps = {
  link: AuraStartLink;
  groupId: string;
  settings: AuraStartSettings;
  disabled: boolean;
  editMode: boolean;
  highlightTerms?: string[];
  highlights?: LinkSearchHighlights;
  isDropPending: boolean;
  placement?: DropPlacement | null;
  previewOffset?: number;
  linkDragActive?: boolean;
  selected?: boolean;
  onEdit: (groupId: string, link: AuraStartLink) => void;
  onDelete: (groupId: string, link: AuraStartLink) => void;
};

export function SortableLinkItem({
  link,
  groupId,
  settings,
  disabled,
  editMode,
  highlightTerms,
  highlights,
  isDropPending,
  placement,
  previewOffset = 0,
  linkDragActive = false,
  selected,
  onEdit,
  onDelete
}: SortableLinkItemProps) {
  const sortable = useSortable({
    id: `link:${link.id}`,
    disabled,
    data: { type: "link", linkId: link.id, groupId, order: link.order },
    animateLayoutChanges: () => false,
    transition: {
      duration: 145,
      easing: "cubic-bezier(0.2, 0, 0, 1)"
    }
  });

  return (
    <div
      className="sortable-link-shell"
      data-link-id={link.id}
      data-drop-edge={placement?.kind === "link" && placement.markerId === `link:${link.id}` ? placement.edge : undefined}
      data-drop-axis="y"
      ref={sortable.setNodeRef}
    >
      <div
        className="sortable-link-content"
        data-preview-active={linkDragActive || undefined}
        data-drag-source={sortable.isDragging || isDropPending || undefined}
        style={{ transform: previewOffset ? `translate3d(0, ${previewOffset}px, 0)` : undefined }}
      >
        <BookmarkLinkItem
          dragAttributes={sortable.attributes}
          dragListeners={sortable.listeners}
          dragging={sortable.isDragging || isDropPending}
          editMode={editMode}
          groupId={groupId}
          highlightTerms={highlightTerms}
          highlights={highlights}
          link={link}
          selected={selected}
          settings={settings}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
}
