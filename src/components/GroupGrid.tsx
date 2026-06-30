import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  pointerWithin,
  PointerSensor,
  rectIntersection,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates, SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { CSSProperties } from "react";
import { useState } from "react";
import { t } from "../i18n";
import type { AuraStartData, AuraStartGroup, AuraStartLink, GroupTreeNode } from "../types";
import { buildGroupTree, flattenGroupTree } from "../utils/groupTree";
import type { SearchHighlightMap } from "../utils/search";
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
  onReorderGroups: (orderedGroupIds: string[], parentId?: string | null) => Promise<void> | void;
  onMoveGroup: (groupId: string, targetParentId: string | null) => Promise<void> | void;
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

function findGroup(groups: AuraStartGroup[], groupId: string): AuraStartGroup | undefined {
  return groups.find((group) => group.id === groupId);
}

function siblingGroupIds(groups: AuraStartGroup[], parentId: string | null): string[] {
  return groups
    .filter((group) => group.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((group) => group.id);
}

function isActiveAfterOver(event: DragEndEvent): boolean {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const overRect = event.over?.rect;

  if (!activeRect || !overRect) return false;

  return activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2;
}

function beforeLinkIdForDrop(
  activeLinkId: string,
  targetGroup: AuraStartGroup,
  overLinkId: string,
  insertAfter: boolean
): string | undefined {
  const targetLinks = targetGroup.links
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((link) => link.id !== activeLinkId);
  const overIndex = targetLinks.findIndex((link) => link.id === overLinkId);

  if (overIndex < 0) {
    return undefined;
  }

  return targetLinks[insertAfter ? overIndex + 1 : overIndex]?.id;
}

const responsiveCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);

  if (stripPrefix(activeId, "group:")) {
    const groupDropContainers = args.droppableContainers.filter((container) => {
      const containerId = String(container.id);
      return containerId.startsWith("group-child-drop:") || containerId === "group-root-drop";
    });
    const groupContainers = args.droppableContainers.filter((container) => {
      const containerId = String(container.id);
      return containerId.startsWith("group:");
    });

    const dropIntersections = rectIntersection({
      ...args,
      droppableContainers: groupDropContainers
    });
    if (dropIntersections.length) {
      return dropIntersections;
    }

    const intersections = rectIntersection({
      ...args,
      droppableContainers: groupContainers
    });

    if (intersections.length) {
      return intersections;
    }

    const pointerCollisions = pointerWithin({
      ...args,
      droppableContainers: [...groupContainers, ...groupDropContainers]
    });

    return pointerCollisions.length
      ? pointerCollisions
      : closestCenter({
          ...args,
          droppableContainers: [...groupContainers, ...groupDropContainers]
        });
  }

  if (stripPrefix(activeId, "link:")) {
    const linkContainers = args.droppableContainers.filter((container) => {
      const containerId = String(container.id);
      return containerId.startsWith("link:");
    });
    const groupDropContainers = args.droppableContainers.filter((container) =>
      String(container.id).startsWith("group-drop:")
    );
    const containers = [...linkContainers, ...groupDropContainers];

    for (const droppableContainers of [linkContainers, containers]) {
      const intersections = rectIntersection({ ...args, droppableContainers });
      if (intersections.length) return intersections;

      const pointerCollisions = pointerWithin({ ...args, droppableContainers });
      if (pointerCollisions.length) return pointerCollisions;
    }

    return closestCenter({
      ...args,
      droppableContainers: containers
    });
  }

  return closestCenter(args);
};

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
      <span className="sr-only">{t(language, "moveGroupToTopLevel")}</span>
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
  onReorderGroups,
  onMoveGroup,
  onMoveLink
}: GroupGridProps) {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const groupTree = buildGroupTree(groups);
  const flatGroupNodes = flattenGroupTree(groupTree);
  const groupIds = flatGroupNodes.map((group) => group.id);
  const activeGroup = activeGroupId ? flatGroupNodes.find((group) => group.id === activeGroupId) : undefined;
  const activeGroupHasChildren = Boolean(activeGroupId && groups.some((group) => group.parentId === activeGroupId));
  const activeLink = activeLinkId ? findLink(data.groups, activeLinkId) : undefined;
  const language = data.settings.language;

  function handleDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    const groupId = stripPrefix(activeId, "group:");
    const linkId = stripPrefix(activeId, "link:");

    setActiveGroupId(groupId ?? null);
    setActiveLinkId(linkId ?? null);
  }

  function clearGroupDragState() {
    setActiveGroupId(null);
    setActiveLinkId(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";

    const activeGroupId = stripPrefix(activeId, "group:");
    const overGroupId = stripPrefix(overId, "group:");
    if (activeGroupId) {
      try {
        const rootDrop = overId === "group-root-drop";
        if (rootDrop) {
          await onMoveGroup(activeGroupId, null);
          return;
        }

        const childDropGroupId = stripPrefix(overId, "group-child-drop:");
        if (childDropGroupId && childDropGroupId !== activeGroupId) {
          await onMoveGroup(activeGroupId, childDropGroupId);
          return;
        }

        const activeIndex = groupIds.indexOf(activeGroupId);
        const overIndex = overGroupId ? groupIds.indexOf(overGroupId) : -1;

        if (activeIndex >= 0 && overIndex >= 0 && activeIndex !== overIndex) {
          const activeGroup = findGroup(groups, activeGroupId);
          const overGroup = overGroupId ? findGroup(groups, overGroupId) : undefined;
          if (!activeGroup || !overGroup) return;

          const targetParentId = overGroup.parentId ?? null;
          if ((activeGroup.parentId ?? null) !== targetParentId) {
            await onMoveGroup(activeGroupId, targetParentId);
            return;
          }

          const siblings = siblingGroupIds(groups, targetParentId);
          const activeSiblingIndex = siblings.indexOf(activeGroupId);
          const overSiblingIndex = siblings.indexOf(overGroup.id);
          if (activeSiblingIndex >= 0 && overSiblingIndex >= 0 && activeSiblingIndex !== overSiblingIndex) {
            const finalOrder = arrayMove(siblings, activeSiblingIndex, overSiblingIndex);
            await onReorderGroups(finalOrder, targetParentId);
          }
        }
      } finally {
        clearGroupDragState();
      }
      return;
    }

    const activeLinkId = stripPrefix(activeId, "link:");
    if (!activeLinkId) {
      clearGroupDragState();
      return;
    }

    try {
      if (!overId) return;

      const overLinkId = stripPrefix(overId, "link:");
      if (overLinkId) {
        if (overLinkId === activeLinkId) return;

        const targetGroup = findGroupForLink(data.groups, overLinkId);
        if (targetGroup) {
          await onMoveLink(
            activeLinkId,
            targetGroup.id,
            beforeLinkIdForDrop(activeLinkId, targetGroup, overLinkId, isActiveAfterOver(event))
          );
        }
        return;
      }

      const dropGroupId = stripPrefix(overId, "group-drop:");
      if (dropGroupId) {
        await onMoveLink(activeLinkId, dropGroupId);
      }
    } finally {
      clearGroupDragState();
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
    return children.length ? <div className="nested-group-list">{children}</div> : null;
  }

  function renderStaticNode(group: GroupTreeNode) {
    return (
      <div className={`group-tree-node group-tree-depth-${group.depth}`} key={group.id}>
        <BookmarkGroupCard
          group={group}
          depth={group.depth}
          highlightTerms={highlightTerms}
          searchHighlights={searchHighlights}
          selectedSearchResultId={selectedSearchResultId}
          searchMode={searchMode}
          editMode={false}
          settings={data.settings}
          onAddGroup={onAddGroup}
          onAddLink={(groupId) => onAddLink(groupId)}
          onDeleteGroup={onDeleteGroup}
          onDeleteLink={onDeleteLink}
          onEditGroup={onEditGroup}
          onEditLink={onEditLink}
          onToggle={onToggle}
        />
        {renderChildren(group, false)}
      </div>
    );
  }

  function renderSortableNode(group: GroupTreeNode) {
    return (
      <SortableGroupCard
        activeGroupId={activeGroupId}
        activeLinkId={activeLinkId}
        canAcceptChildGroups={canNestInto(group)}
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
      collisionDetection={responsiveCollisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      sensors={sensors}
      onDragCancel={clearGroupDragState}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <SortableContext items={flatGroupNodes.map((group) => `group:${group.id}`)} strategy={rectSortingStrategy}>
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
          <div className="group-drag-overlay" style={gridStyle(1)}>
            <div className="bookmark-group">
              <div className="group-name-row">
                <h2 className="group-name">{activeGroup.title}</h2>
              </div>
              {!activeGroup.collapsed ? (
                <div className="bookmark-list">
                  {activeGroup.links
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((link) => (
                      <div className="bookmark-row" key={link.id}>
                        <div className="bookmark-row-inner">
                          <span className="bookmark-link">
                            <span className="bookmark-title">{link.title}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : activeLink ? (
          <div className="link-drag-overlay">
            <div className="bookmark-row">
              <div className="bookmark-row-inner">
                <span className="bookmark-link">
                  <span className="bookmark-title">{activeLink.title}</span>
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
