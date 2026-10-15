import type { CollisionDetection, KeyboardCoordinateGetter } from "@dnd-kit/core";

export type DropPlacement = {
  kind: "link" | "group";
  targetId: string;
  containerId: string | null;
  beforeId?: string;
  markerId: string;
  edge: "before" | "after" | "inside";
  axis?: "x" | "y";
};

type Point = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };
export type DropTarget = {
  id: string;
  rect: Rect;
  groupId?: string;
  parentId?: string | null;
  order?: number;
  hasChildren?: boolean;
};

const contains = (rect: Rect, point: Point, leftMargin = 0) => point.x >= rect.left - leftMargin && point.x <= rect.left + rect.width
  && point.y >= rect.top && point.y <= rect.top + rect.height;
const center = (rect: Rect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const ordered = (targets: DropTarget[]) => targets.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function pointerHits(targets: DropTarget[], point: Point, leftMargin: number, nested = false): DropTarget[] {
  const hits = targets.filter((target) => contains(target.rect, point, leftMargin));
  // A child's grip may lie within its enclosing parent's real rectangle.
  // That ancestor is not an adjacent card and must not swallow the child's hit.
  const deepest = nested ? hits.filter((target) => !hits.some((child) => child.parentId === target.groupId)) : hits;
  return deepest.sort((a, b) => Number(contains(b.rect, point)) - Number(contains(a.rect, point))
    || Math.max(0, a.rect.left - point.x) - Math.max(0, b.rect.left - point.x));
}

/** Resolve against stationary layout rectangles. The same intent drives the marker and the committed move. */
export function resolveDragPlacement(activeId: string, point: Point, targets: DropTarget[], leftHandleMargin = 0): DropPlacement | null {
  const leftMargin = Number.isFinite(leftHandleMargin) ? Math.max(0, leftHandleMargin) : 0;
  if (activeId.startsWith("link:")) {
    const container = pointerHits(targets.filter((target) => target.id.startsWith("group-drop:")), point, leftMargin)[0];
    if (!container) return null;
    const links = ordered(targets.filter((target) => target.id.startsWith("link:") && target.id !== activeId
      && target.groupId === container.groupId));
    const before = links.find((target) => point.y < center(target.rect).y);
    const last = links.at(-1);
    return {
      kind: "link", targetId: before?.id ?? last?.id ?? container.id,
      containerId: container.groupId!, beforeId: before?.id.slice(5),
      markerId: before?.id ?? last?.id ?? container.id, edge: before ? "before" : last ? "after" : "inside", axis: "y"
    };
  }
  if (!activeId.startsWith("group:")) return null;
  const active = targets.find((target) => target.id === activeId);
  if (!active) return null;
  const activeGroupId = active.groupId ?? active.id.slice(6);
  const hasChildren = active.hasChildren || targets.some((target) => target.id.startsWith("group:")
    && target.parentId === activeGroupId);
  const explicit = targets.find((target) => (target.id === "group-root-drop" || target.id.startsWith("group-child-drop:"))
    && contains(target.rect, point));
  if (explicit) {
    if (explicit.id === "group-root-drop") {
      if (!active.parentId) return null;
    } else {
      const destination = targets.find((target) => target.id === `group:${explicit.groupId}`);
      if (!destination || destination.parentId || hasChildren || explicit.groupId === activeGroupId
        || explicit.groupId === active.parentId) return null;
    }
    return {
      kind: "group", targetId: explicit.id, containerId: explicit.groupId ?? null,
      markerId: explicit.id, edge: "inside"
    };
  }
  // Include the source while choosing hits, so its original grip cannot fall
  // through to an ancestor. An adjacent card's real rectangle still wins over
  // the source's extended grip area.
  const over = pointerHits(targets.filter((target) => target.id.startsWith("group:")
    && target.parentId !== activeGroupId && !(hasChildren && target.parentId)), point, leftMargin, true)[0];
  if (!over || over.id === activeId) return null;
  const siblings = ordered(targets.filter((target) => target.id.startsWith("group:")
    && (target.parentId ?? null) === (over.parentId ?? null)));
  const horizontal = !over.parentId && siblings.some((target) => Math.abs(target.rect.left - over.rect.left) > 1);
  const after = horizontal ? point.x >= center(over.rect).x : point.y >= center(over.rect).y;
  const remaining = siblings.filter((target) => target.id !== activeId);
  const index = remaining.findIndex((target) => target.id === over.id);
  return {
    kind: "group", targetId: over.id, containerId: over.parentId ?? null,
    beforeId: remaining[index + (after ? 1 : 0)]?.groupId,
    markerId: over.id, edge: after ? "after" : "before", axis: horizontal ? "x" : "y"
  };
}

export const stableDropCollision: CollisionDetection = (args) => {
  const targets: DropTarget[] = args.droppableContainers.flatMap((container) => {
    const rect = args.droppableRects.get(container.id);
    return rect ? [{ id: String(container.id), rect, ...container.data.current }] : [];
  });
  const point = args.pointerCoordinates ?? center(args.collisionRect);
  // Handles and the group rail extend up to 1.65rem left of their card. Include
  // that small gutter (plus hover scaling), not the rest of the page.
  const rootFontSize = typeof document !== "undefined" && typeof getComputedStyle === "function"
    ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize) : 16;
  const handleMargin = args.pointerCoordinates ? (Number.isFinite(rootFontSize) ? rootFontSize : 16) * 1.75 : 0;
  const placement = resolveDragPlacement(String(args.active.id), point, targets, handleMargin);
  if (!placement) return [];
  return [{ id: placement.targetId, data: { value: 1, placement } }];
};

/** A preview spacer can move a following group after it was selected. Layout
 * alone must not change that pointer intent. Scroll/resize and gesture boundaries
 * explicitly invalidate the cache; a new pointer position always resolves anew. */
export function createPointerStableCollision(detect: CollisionDetection = stableDropCollision) {
  let last: { activeId: string; point: Point; measuredIds: Set<string | number>; collisions: ReturnType<CollisionDetection> } | null = null;
  const reset = () => { last = null; };
  const collisionDetection: CollisionDetection = (args) => {
    const activeId = String(args.active.id);
    const point = args.pointerCoordinates;
    if (!point || !activeId.startsWith("link:")) return detect(args);
    const measuredIds = new Set(args.droppableContainers.filter((container) => args.droppableRects.has(container.id)).map((container) => container.id));
    if (last?.activeId === activeId && last.point.x === point.x && last.point.y === point.y
      && measuredIds.size === last.measuredIds.size && [...measuredIds].every((id) => last!.measuredIds.has(id))
      && last.collisions.every((hit) => args.droppableContainers.some((container) => container.id === hit.id))) {
      return last.collisions;
    }
    const collisions = detect(args);
    last = { activeId, point: { ...point }, measuredIds, collisions };
    return collisions;
  };
  return { collisionDetection, reset };
}

export function placementFromCollisions(collisions: { data?: Record<string, unknown> }[] | null | undefined): DropPlacement | null {
  return (collisions?.[0]?.data?.placement as DropPlacement | undefined) ?? null;
}

/** Arrows navigate matching items. Alt+Right nests at the indicated/nearest
 * valid child zone; Alt+Left promotes a nested group to the root zone. */
export const stableKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const direction = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.code];
  if (!direction || !context.active || !context.collisionRect) return;
  event.preventDefault();
  const activeId = String(context.active.id);
  const prefix = activeId.startsWith("link:") ? "link:" : "group:";
  const origin = center(context.collisionRect);
  const [dx, dy] = direction;
  const enabled = context.droppableContainers.getEnabled();
  if (prefix === "group:" && event.altKey && (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
    const targets: DropTarget[] = enabled.flatMap((container) => {
      const rect = context.droppableRects.get(container.id);
      return rect ? [{ id: String(container.id), rect, ...container.data.current }] : [];
    });
    const currentPlacement = resolveDragPlacement(activeId, origin, targets);
    const preferredParent = currentPlacement?.containerId ?? currentPlacement?.targetId.slice(6);
    const zone = targets.filter((target) => event.code === "ArrowLeft" ? target.id === "group-root-drop"
      : target.id.startsWith("group-child-drop:"))
      .filter((target) => resolveDragPlacement(activeId, center(target.rect), targets)?.targetId === target.id)
      .sort((a, b) => Number(b.groupId === preferredParent) - Number(a.groupId === preferredParent)
        || Math.hypot(center(a.rect).x - origin.x, center(a.rect).y - origin.y)
          - Math.hypot(center(b.rect).x - origin.x, center(b.rect).y - origin.y))[0];
    if (!zone) return;
    const target = center(zone.rect);
    return { x: currentCoordinates.x + target.x - origin.x, y: currentCoordinates.y + target.y - origin.y };
  }
  const candidates = enabled.flatMap((container) => {
    const id = String(container.id);
    const rect = context.droppableRects.get(container.id);
    if (!rect || id === activeId || !(id.startsWith(prefix) || (prefix === "link:" && id.startsWith("group-drop:")
      && (container.data.current?.empty || container.data.current?.collapsed)))) return [];
    if (prefix === "group:" && container.data.current?.parentId === context.active?.data.current?.groupId) return [];
    const target = center(rect);
    const along = dx ? (target.x - origin.x) * dx : (target.y - origin.y) * dy;
    // A direction reversal must first cross the current item's midpoint.
    // Skipping this nearby center would jump over a slot on the way back.
    if (along <= 0.5) return [];
    const across = dx ? Math.abs(target.y - origin.y) : Math.abs(target.x - origin.x);
    return [{ target, score: along + across * 3 }];
  }).sort((a, b) => a.score - b.score);
  const target = candidates[0]?.target;
  if (!target) return;
  // Group grids use horizontal slot edges, even when an arrow moves to the
  // previous/next row. Bias both axes so Up/Left still select "before".
  const groupDirection = prefix === "group:" ? dx || dy : 0;
  return {
    x: currentCoordinates.x + target.x - origin.x + (groupDirection || dx) * 2,
    y: currentCoordinates.y + target.y - origin.y + (groupDirection || dy) * 2
  };
};
