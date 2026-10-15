import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  type DragMoveEvent,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { AuraStartData, AuraStartGroup, AuraStartLink, GroupTreeNode } from "../types";
import { buildGroupTree, flattenGroupTree } from "../utils/groupTree";
import type { SearchHighlightMap } from "../utils/search";
import { createPointerStableCollision, stableKeyboardCoordinates, placementFromCollisions, type DropPlacement } from "../utils/dragPlacement";
import { BookmarkLinkItem } from "./BookmarkLinkItem";
import { BookmarkGroupCard } from "./BookmarkGroupCard";
import { SortableGroupCard } from "./SortableGroupCard";

type GroupGridProps = {
  data: AuraStartData;
  editMode: boolean;
  groups: AuraStartGroup[];
  highlightTerms?: string[];
  searchHighlights?: SearchHighlightMap;
  searchMode: boolean;
  selectedSearchResultId?: string | null;
  onAddGroup: (parentId?: string | null) => void;
  onAddLink: (groupId?: string) => void;
  onEditGroup: (group: AuraStartGroup) => void;
  onDeleteGroup: (group: AuraStartGroup) => void;
  onToggle: (groupId: string) => void;
  onEditLink: (groupId: string, link: AuraStartLink) => void;
  onDeleteLink: (groupId: string, link: AuraStartLink) => void;
  onMoveGroup: (groupId: string, targetParentId: string | null, beforeGroupId?: string) => Promise<void> | void;
  onMoveLink: (linkId: string, targetGroupId: string, overLinkId?: string) => Promise<void> | void;
};

function stripPrefix(value: string, prefix: string): string | undefined {
  return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

function findGroupForLink(groups: AuraStartGroup[], linkId: string): AuraStartGroup | undefined {
  return groups.find((group) => group.links.some((link) => link.id === linkId));
}

function findLink(groups: AuraStartGroup[], linkId: string): AuraStartLink | undefined {
  return groups.flatMap((group) => group.links).find((link) => link.id === linkId);
}

// Link presentation animates separately from these stable measured rows.
const stationarySortingStrategy = () => null;
const inertPreview = (node: HTMLDivElement | null) => { if (node) node.inert = true; };

function gridStyle(columns: AuraStartData["settings"]["columns"]): CSSProperties {
  if (columns === "auto") {
    return { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 23rem), 27rem))" };
  }

  return { gridTemplateColumns: `repeat(${columns}, minmax(0, 27rem))` };
}

function RootGroupDropZone({ enabled, language }: { enabled: boolean; language: AuraStartData["settings"]["language"] }) {
  const droppable = useDroppable({
    id: "group-root-drop",
    data: { type: "group-root-drop" },
    disabled: !enabled
  });

  if (!enabled) {
    return null;
  }

  return (
    <div
      aria-label={t(language, "moveGroupToTopLevel")}
      className={`group-root-drop-zone ${droppable.isOver ? "group-drop-zone-active" : ""}`}
      ref={droppable.setNodeRef}
      role="button"
    >
      <span>{t(language, "moveGroupToTopLevel")}</span>
    </div>
  );
}

export function GroupGrid({
  data,
  editMode,
  groups,
  highlightTerms = [],
  searchHighlights,
  searchMode,
  selectedSearchResultId,
  onAddGroup,
  onAddLink,
  onEditGroup,
  onDeleteGroup,
  onToggle,
  onEditLink,
  onDeleteLink,
  onMoveGroup,
  onMoveLink
}: GroupGridProps) {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<DropPlacement | null>(null);
  const collision = useMemo(() => createPointerStableCollision(), []);
  useEffect(() => {
    // Capture scrolls from any ancestor, including auto-scroll while the pointer
    // stays still. Spacer-driven layout changes are deliberately not inputs.
    window.addEventListener("scroll", collision.reset, true);
    window.addEventListener("resize", collision.reset);
    return () => {
      window.removeEventListener("scroll", collision.reset, true);
      window.removeEventListener("resize", collision.reset);
    };
  }, [collision]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stableKeyboardCoordinates, scrollBehavior: "auto" })
  );

  const groupTree = buildGroupTree(groups);
  const flatGroupNodes = flattenGroupTree(groupTree);
  const activeGroup = activeGroupId ? flatGroupNodes.find((group) => group.id === activeGroupId) : undefined;
  const activeGroupHasChildren = Boolean(activeGroupId && groups.some((group) => group.parentId === activeGroupId));
  const activeLink = activeLinkId ? findLink(data.groups, activeLinkId) : undefined;
  const language = data.settings.language;

  function handleDragStart(event: DragStartEvent) {
    collision.reset();
    const activeId = String(event.active.id);
    const groupId = stripPrefix(activeId, "group:");
    const linkId = stripPrefix(activeId, "link:");

    setPlacement(null);
    setActiveGroupId(groupId ?? null);
    setActiveLinkId(linkId ?? null);
  }

  function clearGroupDragState() {
    collision.reset();
    setActiveGroupId(null);
    setActiveLinkId(null);
    setPlacement(null);
  }

  function handleDragMove(event: DragMoveEvent) {
    const next = placementFromCollisions(event.collisions);
    setPlacement((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const target = placementFromCollisions(event.collisions);
    const activeId = String(event.active.id);
    // The store updates optimistically. End the visual gesture before awaiting disk I/O.
    clearGroupDragState();
    if (!target) return;
    if (target.kind === "group" && activeId.startsWith("group:")) {
      await onMoveGroup(activeId.slice(6), target.containerId, target.beforeId);
    } else if (target.kind === "link" && activeId.startsWith("link:") && target.containerId) {
      await onMoveLink(activeId.slice(5), target.containerId, target.beforeId);
    }
  }

  function canNestInto(group: GroupTreeNode): boolean {
    return Boolean(
      activeGroup &&
        activeGroup.id !== group.id &&
        group.depth === 0 &&
        activeGroup.parentId !== group.id &&
        !activeGroupHasChildren
    );
  }

  function renderChildren(node: GroupTreeNode, sortable: boolean) {
    if (node.collapsed && !searchMode) {
      return null;
    }

    const children = node.children.map((child) => (sortable ? renderSortableNode(child) : renderStaticNode(child)));
    if (!children.length) {
      return null;
    }

    const content = <div className="nested-group-list">{children}</div>;
    return sortable ? (
      <SortableContext items={node.children.map((child) => `group:${child.id}`)} strategy={stationarySortingStrategy}>
        {content}
      </SortableContext>
    ) : content;
  }

  function renderStaticNode(group: GroupTreeNode, overlay = false) {
    return (
      <div className={`group-tree-node group-tree-depth-${group.depth}`} key={group.id}>
        <BookmarkGroupCard
          group={group}
          depth={group.depth}
          highlightTerms={highlightTerms}
          searchHighlights={searchHighlights}
          selectedSearchResultId={selectedSearchResultId}
          searchMode={searchMode}
          editMode={overlay}
          overlay={overlay}
          settings={data.settings}
          onAddGroup={onAddGroup}
          onAddLink={(groupId) => onAddLink(groupId)}
          onDeleteGroup={onDeleteGroup}
          onDeleteLink={onDeleteLink}
          onEditGroup={onEditGroup}
          onEditLink={onEditLink}
          onToggle={onToggle}
        />
        {overlay && !group.collapsed ? <div className="nested-group-list">{group.children.map((child) => renderStaticNode(child, true))}</div> : renderChildren(group, false)}
      </div>
    );
  }

  function renderSortableNode(group: GroupTreeNode) {
    return (
      <SortableGroupCard
        placement={placement}
        activeGroupId={activeGroupId}
        activeLinkId={activeLinkId}
        canAcceptChildGroups={canNestInto(group)}
        hasChildren={groups.some((item) => item.parentId === group.id)}
        depth={group.depth}
        editMode={editMode}
        group={group}
        highlightTerms={highlightTerms}
        searchHighlights={searchHighlights}
        isDropPending={activeGroupId === group.id}
        key={group.id}
        searchMode={false}
        selectedSearchResultId={selectedSearchResultId}
        settings={data.settings}
        onAddGroup={onAddGroup}
        onAddLink={(groupId) => onAddLink(groupId)}
        onDeleteGroup={onDeleteGroup}
        onDeleteLink={onDeleteLink}
        onEditGroup={onEditGroup}
        onEditLink={onEditLink}
        onToggle={onToggle}
      >
        {renderChildren(group, true)}
      </SortableGroupCard>
    );
  }

  if (searchMode) {
    return (
      <div
        className={`aura-group-grid ${data.settings.columns === 1 ? "aura-group-grid-left" : ""}`}
        style={gridStyle(data.settings.columns)}
      >
        {groupTree.map((group) => renderStaticNode(group))}
      </div>
    );
  }

  if (!editMode) {
    return (
      <div
        className={`aura-group-grid ${data.settings.columns === 1 ? "aura-group-grid-left" : ""}`}
        style={gridStyle(data.settings.columns)}
      >
        {groupTree.map((group) => renderStaticNode(group))}
      </div>
    );
  }

  return (
    <DndContext
      collisionDetection={collision.collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      sensors={sensors}
      onDragCancel={clearGroupDragState}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <SortableContext items={groupTree.map((group) => `group:${group.id}`)} strategy={stationarySortingStrategy}>
        <div
          className={`aura-group-grid ${data.settings.columns === 1 ? "aura-group-grid-left" : ""}`}
          style={gridStyle(data.settings.columns)}
        >
          <RootGroupDropZone enabled={Boolean(activeGroup?.parentId)} language={language} />
          {groupTree.map((group) => renderSortableNode(group))}
        </div>
      </SortableContext>
      <DragOverlay adjustScale={false} dropAnimation={null}>
        {activeGroup ? (
          <div aria-hidden="true" className="group-drag-overlay" ref={inertPreview}>{renderStaticNode(activeGroup, true)}</div>
        ) : activeLink ? (
          <div aria-hidden="true" className="link-drag-overlay" ref={inertPreview}>
            <BookmarkLinkItem link={activeLink} groupId={findGroupForLink(data.groups, activeLink.id)!.id}
              settings={data.settings} editMode onEdit={() => {}} onDelete={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
