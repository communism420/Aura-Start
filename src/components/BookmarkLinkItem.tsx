import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { AuraStartLink, AuraStartSettings } from "../types";
import { searchResultId } from "../utils/search";
import type { LinkSearchHighlights } from "../utils/search";
import { HighlightedText } from "./HighlightedText";

type BookmarkLinkItemProps = {
  link: AuraStartLink;
  groupId: string;
  settings: AuraStartSettings;
  editMode: boolean;
  dragging?: boolean;
  highlightTerms?: string[];
  highlights?: LinkSearchHighlights;
  selected?: boolean;
  dragAttributes?: React.HTMLAttributes<HTMLElement>;
  dragListeners?: React.HTMLAttributes<HTMLElement>;
  onEdit: (groupId: string, link: AuraStartLink) => void;
  onDelete: (groupId: string, link: AuraStartLink) => void;
};

export function BookmarkLinkItem({
  link,
  groupId,
  settings,
  editMode,
  dragging = false,
  highlightTerms = [],
  highlights,
  selected = false,
  dragAttributes,
  dragListeners,
  onEdit,
  onDelete
}: BookmarkLinkItemProps) {
  const language = settings.language;
  const stopDragActivation = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const content = (
    <>
      <span className="bookmark-title">
        <HighlightedText ranges={highlights?.title} terms={highlightTerms} text={link.title} />
      </span>
      <span className="bookmark-url">
        <HighlightedText ranges={highlights?.url} terms={highlightTerms} text={link.url} />
      </span>
      {settings.showDescriptions && link.description && !settings.compactMode ? (
        <span className="bookmark-description">
          <HighlightedText ranges={highlights?.description} terms={highlightTerms} text={link.description} />
        </span>
      ) : null}
      {link.tags?.length && !settings.compactMode ? (
        <span className="bookmark-tags">
          {link.tags.map((tag, index) => (
            <span className="bookmark-tag" key={tag}>
              <HighlightedText ranges={highlights?.tags?.[index]} terms={highlightTerms} text={tag} />
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={`bookmark-row group ${editMode ? "bookmark-row-editing" : ""} ${dragging ? "dragging" : ""} ${selected ? "bookmark-row-selected" : ""}`}
      data-search-result-id={searchResultId(groupId, link.id)}
    >
      <div className="bookmark-row-inner">
        {editMode ? (
          <div
            className="bookmark-drag-zone"
            {...dragAttributes}
            {...dragListeners}
          >
            <span
              aria-label={t(language, "dragLink", { title: link.title })}
              className="bookmark-handle"
            >
              <GripVertical size={13} />
            </span>
            <div className="bookmark-link bookmark-link-editing">
              {content}
            </div>
          </div>
        ) : (
          <a
            aria-current={selected ? "true" : undefined}
            className="bookmark-link"
            href={link.url}
            rel={settings.openLinksInNewTab ? "noopener noreferrer" : undefined}
            target={settings.openLinksInNewTab ? "_blank" : undefined}
          >
            {content}
          </a>
        )}
        {editMode ? (
          <div className="bookmark-actions">
            <button
              aria-label={t(language, "editLinkAria", { title: link.title })}
              className="bookmark-action"
              type="button"
              onPointerDown={stopDragActivation}
              onClick={() => onEdit(groupId, link)}
            >
              <Pencil size={13} />
            </button>
            <button
              aria-label={t(language, "deleteGroupAria", { title: link.title })}
              className="bookmark-action danger-action"
              type="button"
              onPointerDown={stopDragActivation}
              onClick={() => onDelete(groupId, link)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
