import { describe, expect, it, vi } from "vitest";
import {
  createPointerStableCollision, placementFromCollisions, resolveDragPlacement, stableDropCollision, stableKeyboardCoordinates,
  type DropTarget
} from "./dragPlacement";

const rect = (left: number, top: number, width = 200, height = 30) => ({ left, top, width, height });
const item = (id: string, top: number, order: number, groupId = "list", height = 30, left = 0): DropTarget =>
  ({ id: `link:${id}`, groupId, order, rect: rect(left, top, 200, height) });
const list = (groupId = "list", left = 0, top = 0, height = 180): DropTarget =>
  ({ id: `group-drop:${groupId}`, groupId, rect: rect(left, top, 200, height) });
const group = (id: string, order: number, left: number, top: number, parentId: string | null = null, height = 100): DropTarget =>
  ({ id: `group:${id}`, groupId: id, order, parentId, rect: rect(left, top, 200, height) });
const childZone = (groupId: string, left = 0, top = 90): DropTarget =>
  ({ id: `group-child-drop:${groupId}`, groupId, rect: rect(left, top, 200, 10) });
const rootZone = (): DropTarget => ({ id: "group-root-drop", rect: rect(500, 0, 200, 30) });

describe("stationary link drop slots", () => {
  const targets = [list(), item("a", 0, 0), item("b", 30, 1), item("c", 60, 2), item("d", 90, 3)];

  it("uses the pointer side of a target midpoint and keeps the same exact commit anchor", () => {
    expect(resolveDragPlacement("link:a", { x: 100, y: 44.9 }, targets))
      .toMatchObject({ beforeId: "b", markerId: "link:b", edge: "before" });
    expect(resolveDragPlacement("link:a", { x: 100, y: 45 }, targets))
      .toMatchObject({ beforeId: "c", markerId: "link:c", edge: "before" });
    expect(resolveDragPlacement("link:a", { x: 100, y: 120 }, targets))
      .toMatchObject({ beforeId: undefined, markerId: "link:d", edge: "after" });
  });

  it("does not let the active source row hijack upward or downward insertion", () => {
    expect(resolveDragPlacement("link:b", { x: 100, y: 15 }, targets)?.beforeId).toBe("c");
    expect(resolveDragPlacement("link:b", { x: 100, y: 14 }, targets)?.beforeId).toBe("a");
    expect(resolveDragPlacement("link:b", { x: 100, y: 45 }, targets)?.beforeId).toBe("c");
    expect(resolveDragPlacement("link:b", { x: 100, y: 75 }, targets)?.beforeId).toBe("d");
  });

  it("resolves different row heights without depending on the dragged rectangle or grab offset", () => {
    const varied = [list(), item("a", 0, 0, "list", 15), item("b", 15, 1, "list", 80), item("c", 95, 2, "list", 40)];
    expect(resolveDragPlacement("link:a", { x: 5, y: 54.99 }, varied)?.beforeId).toBe("b");
    expect(resolveDragPlacement("link:a", { x: 195, y: 55 }, varied)?.beforeId).toBe("c");
    expect(resolveDragPlacement("link:a", { x: 100, y: 116 }, varied)?.edge).toBe("after");
  });

  it("finds an exact cross-group slot and never chooses a nearby source-group link", () => {
    const both = [...targets, list("other", 240), item("x", 0, 0, "other", 30, 240), item("y", 30, 1, "other", 30, 240)];
    expect(resolveDragPlacement("link:a", { x: 250, y: 20 }, both))
      .toMatchObject({ containerId: "other", beforeId: "y", markerId: "link:y" });
  });

  it("offers the container for an empty or collapsed list without visible link targets", () => {
    for (const target of [list("empty", 240), list("collapsed", 480, 0, 30)]) {
      expect(resolveDragPlacement("link:a", { x: target.rect.left + 10, y: 10 }, [...targets, target]))
        .toMatchObject({ containerId: target.groupId, targetId: target.id, markerId: target.id, edge: "inside", beforeId: undefined });
    }
  });

  it("cancels outside lists even if the pointer is near a link", () => {
    for (const point of [{ x: -1, y: 45 }, { x: 201, y: 45 }, { x: 100, y: -1 }, { x: 100, y: 181 }]) {
      expect(resolveDragPlacement("link:a", point, targets)).toBeNull();
    }
  });

  it("uses updated viewport rectangles after scrolling", () => {
    const scrolled = targets.map((target) => ({ ...target, rect: { ...target.rect, top: target.rect.top - 50 } }));
    expect(resolveDragPlacement("link:a", { x: 100, y: 26 }, scrolled)?.beforeId).toBe("d");
  });

  it("remains stable on a stationary pointer regardless of registry ordering", () => {
    const placement = resolveDragPlacement("link:a", { x: 100, y: 55 }, targets);
    for (let index = 0; index < 20; index++) {
      expect(resolveDragPlacement("link:a", { x: 100, y: 55 }, index % 2 ? targets.slice().reverse() : targets))
        .toEqual(placement);
    }
  });

  it("accepts vertical link dragging along the grip gutter but keeps its bounds finite", () => {
    expect(resolveDragPlacement("link:a", { x: -24, y: 60 }, targets, 28))
      .toMatchObject({ containerId: "list", beforeId: "c" });
    expect(resolveDragPlacement("link:a", { x: -28, y: 60 }, targets, 28)?.beforeId).toBe("c");
    expect(resolveDragPlacement("link:a", { x: -28.1, y: 60 }, targets, 28)).toBeNull();
    expect(resolveDragPlacement("link:a", { x: -24, y: -1 }, targets, 28)).toBeNull();
    expect(resolveDragPlacement("link:a", { x: 201, y: 60 }, targets, 28)).toBeNull();
  });

  it("prefers an adjacent list's real rectangle over an overlapping grip gutter", () => {
    const adjacent = [list("right", 216), item("x", 0, 0, "right", 30, 216), ...targets];
    expect(resolveDragPlacement("link:a", { x: 195, y: 40 }, adjacent, 28)?.containerId).toBe("list");
    expect(resolveDragPlacement("link:a", { x: 205, y: 40 }, adjacent, 28)?.containerId).toBe("right");
  });
});

describe("group slots and nesting", () => {
  it("uses vertical markers in a single column and horizontal markers across grid columns", () => {
    const vertical = [group("a", 0, 0, 0), group("b", 1, 0, 120), group("c", 2, 0, 240)];
    expect(resolveDragPlacement("group:a", { x: 100, y: 140 }, vertical))
      .toMatchObject({ containerId: null, beforeId: "b", markerId: "group:b", edge: "before", axis: "y" });
    expect(resolveDragPlacement("group:a", { x: 100, y: 180 }, vertical))
      .toMatchObject({ beforeId: "c", markerId: "group:b", edge: "after", axis: "y" });
    const grid = [group("a", 0, 0, 0), group("b", 1, 240, 0), group("c", 2, 0, 120)];
    expect(resolveDragPlacement("group:a", { x: 250, y: 40 }, grid))
      .toMatchObject({ beforeId: "b", axis: "x", edge: "before" });
    expect(resolveDragPlacement("group:a", { x: 400, y: 40 }, grid))
      .toMatchObject({ beforeId: "c", axis: "x", edge: "after" });
  });

  it("chooses a nested child before its encompassing parent shell", () => {
    const targets = [group("moving", 0, 0, 0), group("parent", 1, 240, 0, null, 300),
      group("one", 0, 240, 80, "parent"), group("two", 1, 240, 190, "parent")];
    expect(resolveDragPlacement("group:moving", { x: 250, y: 110 }, targets))
      .toMatchObject({ targetId: "group:one", containerId: "parent", beforeId: "one", axis: "y" });
  });

  it("does not promote a nested child merely because its own rectangle is inside the parent", () => {
    const targets = [group("parent", 0, 0, 0, null, 300), group("child", 0, 0, 80, "parent")];
    expect(resolveDragPlacement("group:child", { x: 100, y: 130 }, targets)).toBeNull();
  });

  it("does not target a descendant or nest a group that already has children", () => {
    const targets = [group("moving", 0, 0, 0, null, 300), group("own-child", 0, 0, 80, "moving"),
      group("other", 1, 240, 0, null, 300), group("other-child", 0, 240, 80, "other")];
    expect(resolveDragPlacement("group:moving", { x: 100, y: 120 }, targets)).toBeNull();
    expect(resolveDragPlacement("group:moving", { x: 250, y: 120 }, targets))
      .toMatchObject({ targetId: "group:other", containerId: null });
  });

  it("keeps the same nesting restriction when children are collapsed and unmounted", () => {
    const moving = { ...group("moving", 0, 0, 0), hasChildren: true };
    const targets = [moving, group("other", 1, 240, 0, null, 300), group("other-child", 0, 240, 80, "other")];
    expect(resolveDragPlacement("group:moving", { x: 250, y: 120 }, targets)?.containerId).toBeNull();
  });

  it("prioritizes an explicit root zone and appends only a nested group", () => {
    const targets = [group("parent", 0, 0, 0, null, 300), group("child", 0, 0, 80, "parent"), rootZone()];
    expect(resolveDragPlacement("group:child", { x: 550, y: 15 }, targets))
      .toMatchObject({ targetId: "group-root-drop", containerId: null, edge: "inside" });
    expect(resolveDragPlacement("group:parent", { x: 550, y: 15 }, targets)).toBeNull();
  });

  it("allows an explicit top-level nesting zone for a leaf group", () => {
    const targets = [group("moving", 0, 0, 0), group("parent", 1, 240, 0), childZone("parent", 240)];
    expect(resolveDragPlacement("group:moving", { x: 250, y: 95 }, targets))
      .toMatchObject({ targetId: "group-child-drop:parent", containerId: "parent", edge: "inside" });
  });

  it("rejects invalid explicit zones even if they were accidentally registered", () => {
    const parent = group("parent", 0, 0, 0, null, 300);
    const child = group("child", 0, 0, 80, "parent");
    const other = group("other", 1, 240, 0);
    const cases = [
      { active: "group:parent", targets: [parent, child, other, childZone("other", 240)], point: { x: 250, y: 95 } },
      { active: "group:child", targets: [parent, child, childZone("parent", 0, 280)], point: { x: 10, y: 285 } },
      { active: "group:other", targets: [parent, child, other, childZone("child", 0, 170)], point: { x: 10, y: 175 } },
      { active: "group:other", targets: [other, childZone("other", 240)], point: { x: 250, y: 95 } },
      { active: "group:other", targets: [other, childZone("missing", 0)], point: { x: 10, y: 95 } }
    ];
    for (const entry of cases) expect(resolveDragPlacement(entry.active, entry.point, entry.targets)).toBeNull();
  });

  it("cancels outside group cards instead of guessing the nearest group", () => {
    expect(resolveDragPlacement("group:a", { x: 500, y: 500 }, [group("a", 0, 0, 0), group("b", 1, 240, 0)]))
      .toBeNull();
  });

  it("accepts a vertical group-grip drag without extending the top or bottom hit area", () => {
    const targets = [group("a", 0, 0, 0), group("b", 1, 0, 120), group("c", 2, 0, 240)];
    expect(resolveDragPlacement("group:a", { x: -24, y: 190 }, targets, 28))
      .toMatchObject({ markerId: "group:b", beforeId: "c", edge: "after" });
    expect(resolveDragPlacement("group:a", { x: -28.1, y: 190 }, targets, 28)).toBeNull();
    expect(resolveDragPlacement("group:a", { x: -24, y: 110 }, targets, 28)).toBeNull();
  });

  it("keeps a nested group's own grip from falling through to its parent", () => {
    const targets = [group("parent", 0, 0, 0, null, 300), group("a", 0, 24, 60, "parent", 60),
      group("b", 1, 24, 140, "parent", 60)];
    expect(resolveDragPlacement("group:a", { x: 4, y: 90 }, targets, 28)).toBeNull();
    expect(resolveDragPlacement("group:a", { x: 4, y: 160 }, targets, 28))
      .toMatchObject({ containerId: "parent", markerId: "group:b", beforeId: "b" });
  });

  it("prefers an adjacent group's real rectangle over the source group's grip gutter", () => {
    const targets = [group("source", 1, 216, 0), group("other", 0, 0, 0)];
    expect(resolveDragPlacement("group:source", { x: 195, y: 50 }, targets, 28))
      .toMatchObject({ markerId: "group:other", containerId: null, edge: "after" });
  });
});

type KeyboardContext = Parameters<typeof stableKeyboardCoordinates>[1];
function keyboard(activeId: string, code: string, targets: DropTarget[], collisionRect = targets.find((target) => target.id === activeId)!.rect, altKey = false) {
  const containers = targets.map((target) => ({ id: target.id, data: { current: target } }));
  const event = { code, altKey, preventDefault: vi.fn() };
  const result = stableKeyboardCoordinates(event as unknown as KeyboardEvent, {
    currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
    context: {
      active: { id: activeId, data: { current: targets.find((target) => target.id === activeId) } },
      collisionRect,
      droppableContainers: { getEnabled: () => containers },
      droppableRects: new Map(targets.map((target) => [target.id, target.rect]))
    }
  } as unknown as KeyboardContext);
  return { result, event };
}

describe("keyboard and collision adapter", () => {
  it("moves links between adjacent slots and can reverse through the original active row", () => {
    const targets = [list(), item("a", 0, 0), item("b", 30, 1), item("c", 60, 2)];
    const down = keyboard("link:a", "ArrowDown", targets).result!;
    expect(resolveDragPlacement("link:a", { x: down.x + 100, y: down.y + 15 }, targets)?.beforeId).toBe("c");
    const reversed = keyboard("link:a", "ArrowUp", targets, rect(down.x, down.y)).result!;
    expect(resolveDragPlacement("link:a", { x: reversed.x + 100, y: reversed.y + 15 }, targets)?.beforeId).toBe("b");
  });

  it("does not let group-card targets steal a link keyboard move", () => {
    const targets = [list(), item("a", 0, 0), item("b", 60, 1), group("unrelated", 0, 0, 30, null, 10)];
    const next = keyboard("link:a", "ArrowDown", targets).result!;
    expect(next.y).toBe(62);
  });

  it("reverses one insertion slot at a time after several keyboard moves", () => {
    const targets = [list(), item("a", 0, 0), item("b", 30, 1), item("c", 60, 2), item("d", 90, 3)];
    let bounds = rect(0, 0);
    const anchors: (string | undefined)[] = [];
    for (const code of ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp", "ArrowDown"]) {
      const next = keyboard("link:a", code, targets, bounds).result!;
      bounds = rect(next.x, next.y);
      anchors.push(resolveDragPlacement("link:a", { x: next.x + 100, y: next.y + 15 }, targets)?.beforeId);
    }
    expect(anchors).toEqual(["c", "d", "c", "b", "c"]);
  });

  it("uses the correct before slot when moving upward in a multi-column grid", () => {
    const targets = [group("a", 0, 0, 0), group("b", 1, 240, 0), group("c", 2, 0, 120)];
    const next = keyboard("group:c", "ArrowUp", targets).result!;
    expect(resolveDragPlacement("group:c", { x: next.x + 100, y: next.y + 50 }, targets))
      .toMatchObject({ beforeId: "a", markerId: "group:a", edge: "before" });
  });

  it("can reach an empty or collapsed group from a link with the keyboard", () => {
    for (const state of [{ empty: true }, { collapsed: true }]) {
      const targets = [list(), item("a", 0, 0), { ...list("other", 240, 0, 30), ...state }];
      const next = keyboard("link:a", "ArrowRight", targets).result!;
      expect(resolveDragPlacement("link:a", { x: next.x + 100, y: next.y + 15 }, targets))
        .toMatchObject({ containerId: "other", edge: "inside" });
    }
  });

  it("uses Alt+Right for a valid nesting zone and Alt+Left for the root zone", () => {
    const targets = [group("leaf", 0, 0, 0), group("parent", 1, 240, 0), childZone("parent", 240)];
    const nested = keyboard("group:leaf", "ArrowRight", targets, undefined, true).result!;
    expect(resolveDragPlacement("group:leaf", { x: nested.x + 100, y: nested.y + 50 }, targets))
      .toMatchObject({ targetId: "group-child-drop:parent", containerId: "parent", edge: "inside" });

    const nestedTargets = [group("parent", 0, 0, 0, null, 300), group("leaf", 0, 0, 80, "parent"), rootZone()];
    const root = keyboard("group:leaf", "ArrowLeft", nestedTargets, undefined, true).result!;
    expect(resolveDragPlacement("group:leaf", { x: root.x + 100, y: root.y + 50 }, nestedTargets))
      .toMatchObject({ targetId: "group-root-drop", containerId: null, edge: "inside" });
  });

  it("never routes Alt nesting through an invalid zone", () => {
    const targets = [{ ...group("parent", 0, 0, 0), hasChildren: true }, group("other", 1, 240, 0), childZone("other", 240)];
    expect(keyboard("group:parent", "ArrowRight", targets, undefined, true).result).toBeUndefined();
    expect(keyboard("group:other", "ArrowLeft", targets, undefined, true).result).toBeUndefined();
  });

  it("leaves unrelated keys and missing directional destinations alone", () => {
    const targets = [list(), item("a", 0, 0)];
    const unrelated = keyboard("link:a", "KeyQ", targets);
    expect(unrelated.result).toBeUndefined();
    expect(unrelated.event.preventDefault).not.toHaveBeenCalled();
    expect(keyboard("link:a", "ArrowUp", targets).result).toBeUndefined();
  });

  it("uses pointer coordinates before the dragged rectangle and preserves the exact placement in collisions", () => {
    const targets = [list(), item("a", 0, 0), item("b", 30, 1), item("c", 60, 2)];
    const collisions = stableDropCollision({
      active: { id: "link:a" }, collisionRect: rect(0, 0), pointerCoordinates: { x: 100, y: 61 },
      droppableContainers: targets.map((target) => ({ id: target.id, data: { current: target } })),
      droppableRects: new Map(targets.map((target) => [target.id, target.rect]))
    } as unknown as Parameters<typeof stableDropCollision>[0]);
    expect(collisions.map((collision) => collision.id)).toEqual(["link:c"]);
    expect(placementFromCollisions(collisions))
      .toEqual(resolveDragPlacement("link:a", { x: 100, y: 61 }, targets));
    expect(placementFromCollisions([])).toBeNull();
    expect(placementFromCollisions(null)).toBeNull();
  });
});

type CollisionArgs = Parameters<typeof stableDropCollision>[0];
function collisionArgs(activeId: string, targets: DropTarget[], point: { x: number; y: number } | null = { x: 100, y: 45 }): CollisionArgs {
  return {
    active: { id: activeId }, collisionRect: rect(0, 30), pointerCoordinates: point,
    droppableContainers: targets.map((target) => ({ id: target.id, data: { current: target } })),
    droppableRects: new Map(targets.map((target) => [target.id, target.rect]))
  } as unknown as CollisionArgs;
}

describe("pointer collision stability across preview layout changes", () => {
  const targets = [list(), item("a", 0, 0), item("b", 30, 1), item("c", 60, 2)];
  const shifted = targets.map((target) => ({ ...target, rect: { ...target.rect, top: target.rect.top + 200 } }));

  it("keeps the exact selected placement while the same pointer sees a layout-only remeasurement", () => {
    const detect = vi.fn(stableDropCollision);
    const stable = createPointerStableCollision(detect);
    const first = stable.collisionDetection(collisionArgs("link:a", targets));
    const afterLayout = stable.collisionDetection(collisionArgs("link:a", shifted));
    expect(placementFromCollisions(first)?.beforeId).toBe("c");
    expect(afterLayout).toBe(first);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("resolves again on any actual pointer movement, including fractional movement", () => {
    const detect = vi.fn(stableDropCollision);
    const stable = createPointerStableCollision(detect);
    stable.collisionDetection(collisionArgs("link:a", targets));
    const moved = stable.collisionDetection(collisionArgs("link:a", shifted, { x: 100.25, y: 45 }));
    expect(moved).toEqual([]);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("rechecks the same pointer after an explicit scroll, resize, or gesture reset", () => {
    for (const cause of ["scroll", "resize", "new gesture"]) {
      const detect = vi.fn(stableDropCollision);
      const stable = createPointerStableCollision(detect);
      stable.collisionDetection(collisionArgs("link:a", targets));
      stable.reset();
      expect(stable.collisionDetection(collisionArgs("link:a", shifted)), cause).toEqual([]);
      expect(detect).toHaveBeenCalledTimes(2);
    }
  });

  it("invalidates a cached placement if its target disappeared", () => {
    const detect = vi.fn(stableDropCollision);
    const stable = createPointerStableCollision(detect);
    const first = stable.collisionDetection(collisionArgs("link:a", targets));
    expect(first[0].id).toBe("link:c");
    const remaining = targets.filter((target) => target.id !== "link:c");
    const changed = stable.collisionDetection(collisionArgs("link:a", remaining));
    expect(detect).toHaveBeenCalledTimes(2);
    expect(placementFromCollisions(changed)).toMatchObject({ targetId: "link:b", beforeId: undefined, edge: "after" });
  });

  it("does not cache group collisions or keyboard-based link collisions", () => {
    for (const [activeId, point] of [["group:one", { x: 100, y: 45 }], ["link:a", null]] as const) {
      const detect = vi.fn(stableDropCollision);
      const stable = createPointerStableCollision(detect);
      const firstArgs = collisionArgs(activeId, targets, point);
      stable.collisionDetection(firstArgs);
      stable.collisionDetection(firstArgs);
      expect(detect).toHaveBeenCalledTimes(2);
    }
  });

  it("resolves a different active link independently even at identical coordinates", () => {
    const detect = vi.fn(stableDropCollision);
    const stable = createPointerStableCollision(detect);
    const first = stable.collisionDetection(collisionArgs("link:a", targets));
    const second = stable.collisionDetection(collisionArgs("link:c", targets));
    expect(detect).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
    expect(placementFromCollisions(first)?.beforeId).toBe("c");
    expect(placementFromCollisions(second)?.beforeId).toBeUndefined();
  });

  it("copies pointer coordinates so mutation of the input cannot hide pointer movement", () => {
    const detect = vi.fn(stableDropCollision);
    const stable = createPointerStableCollision(detect);
    const point = { x: 100, y: 45 };
    stable.collisionDetection(collisionArgs("link:a", targets, point));
    point.y = 76;
    const moved = stable.collisionDetection(collisionArgs("link:a", targets, point));
    expect(detect).toHaveBeenCalledTimes(2);
    expect(placementFromCollisions(moved)?.beforeId).toBeUndefined();
  });

  it("resolves newly measured targets without requiring another pointer movement", () => {
    const stable = createPointerStableCollision();
    const unmeasured = collisionArgs("link:a", targets);
    unmeasured.droppableRects.clear();
    expect(stable.collisionDetection(unmeasured)).toEqual([]);
    expect(placementFromCollisions(stable.collisionDetection(collisionArgs("link:a", targets)))?.beforeId).toBe("c");
  });
});
