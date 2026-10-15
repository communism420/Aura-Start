import { describe, expect, it } from "vitest";
import { projectLinkDragPreview } from "./linkDragPreview";

const row = (id: string, top: number, height: number) => ({ id, top, height });
const rows = [row("a", 0, 20), row("b", 20, 40), row("c", 60, 15), row("d", 75, 30)];

describe("link drag presentation projection", () => {
  it("opens the exact selected downward slot with different row heights", () => {
    expect(projectLinkDragPreview(rows, "a", 20, "d")).toEqual({
      offsets: { b: -20, c: -20, d: 0 }, gapTop: 55, gapHeight: 20, extraHeight: 0
    });
  });

  it("moves taller and shorter preceding rows down by the inserted row height", () => {
    expect(projectLinkDragPreview(rows, "c", 15, "a")).toEqual({
      offsets: { a: 15, b: 15, d: 0 }, gapTop: 0, gapHeight: 15, extraHeight: 0
    });
  });

  it("uses the end of the projected list when appending within the same group", () => {
    expect(projectLinkDragPreview(rows, "b", 40)).toEqual({
      offsets: { a: 0, c: -40, d: -40 }, gapTop: 65, gapHeight: 40, extraHeight: 0
    });
  });

  it("does not shift any row for a no-op slot", () => {
    expect(projectLinkDragPreview(rows, "b", 40, "c")).toEqual({
      offsets: { a: 0, c: 0, d: 0 }, gapTop: 20, gapHeight: 40, extraHeight: 0
    });
    expect(projectLinkDragPreview(rows, "d", 30)).toEqual({
      offsets: { a: 0, b: 0, c: 0 }, gapTop: 75, gapHeight: 30, extraHeight: 0
    });
  });

  it("reverses preview directions without accumulating old transforms", () => {
    const downward = projectLinkDragPreview(rows, "b", 40);
    const upward = projectLinkDragPreview(rows, "b", 40, "a");
    const restored = projectLinkDragPreview(rows, "b", 40, "c");
    expect(downward?.offsets).toEqual({ a: 0, c: -40, d: -40 });
    expect(upward?.offsets).toEqual({ a: 40, c: 0, d: 0 });
    expect(restored?.offsets).toEqual({ a: 0, c: 0, d: 0 });
    expect(rows).toEqual([row("a", 0, 20), row("b", 20, 40), row("c", 60, 15), row("d", 75, 30)]);
  });

  it("preserves a list's leading space and uniform inter-row gaps", () => {
    const spaced = [row("a", 10, 20), row("b", 35, 40), row("c", 80, 15)];
    expect(projectLinkDragPreview(spaced, "a", 20, "c")).toEqual({
      offsets: { b: -25, c: 0 }, gapTop: 55, gapHeight: 20, extraHeight: 0
    });
    expect(projectLinkDragPreview(spaced, "c", 15, "a")).toEqual({
      offsets: { a: 20, b: 20 }, gapTop: 10, gapHeight: 15, extraHeight: 0
    });
  });

  it("preserves the measured gap sequence by destination slot when gaps differ", () => {
    const spaced = [row("a", 10, 20), row("b", 40, 40), row("c", 100, 15)];
    expect(projectLinkDragPreview(spaced, "c", 15, "a")).toEqual({
      offsets: { a: 25, b: 35 }, gapTop: 10, gapHeight: 15, extraHeight: 0
    });
    expect(projectLinkDragPreview(spaced, "a", 20, "c")).toEqual({
      offsets: { b: -30, c: 0 }, gapTop: 60, gapHeight: 20, extraHeight: 0
    });
  });

  it("handles a sole active row without moving the list origin", () => {
    expect(projectLinkDragPreview([row("only", 12, 27)], "only", 27)).toEqual({
      offsets: {}, gapTop: 12, gapHeight: 27, extraHeight: 0
    });
  });

  it("opens a cross-group slot by shifting only the selected target suffix", () => {
    expect(projectLinkDragPreview(rows, "external", 25, "c")).toEqual({
      offsets: { a: 0, b: 0, c: 25, d: 25 }, gapTop: 60, gapHeight: 25, extraHeight: 25
    });
  });

  it("can insert first or append last in another group", () => {
    expect(projectLinkDragPreview(rows, "external", 25, "a")).toEqual({
      offsets: { a: 25, b: 25, c: 25, d: 25 }, gapTop: 0, gapHeight: 25, extraHeight: 25
    });
    expect(projectLinkDragPreview(rows, "external", 25)).toEqual({
      offsets: { a: 0, b: 0, c: 0, d: 0 }, gapTop: 105, gapHeight: 25, extraHeight: 25
    });
  });

  it("retains existing target gaps without adding another gap for a cross-group row", () => {
    const spaced = [row("a", 10, 20), row("b", 40, 40), row("c", 100, 15)];
    expect(projectLinkDragPreview(spaced, "external", 25, "b")).toEqual({
      offsets: { a: 0, b: 25, c: 25 }, gapTop: 40, gapHeight: 25, extraHeight: 25
    });
    expect(projectLinkDragPreview(spaced, "external", 25)).toEqual({
      offsets: { a: 0, b: 0, c: 0 }, gapTop: 115, gapHeight: 25, extraHeight: 25
    });
  });

  it("reserves one active-height slot for an empty destination", () => {
    expect(projectLinkDragPreview([], "external", 25)).toEqual({
      offsets: {}, gapTop: 0, gapHeight: 25, extraHeight: 25
    });
  });

  it("rejects a missing or self-referencing anchor instead of previewing an unintended append", () => {
    expect(projectLinkDragPreview(rows, "a", 20, "missing")).toBeNull();
    expect(projectLinkDragPreview(rows, "a", 20, "a")).toBeNull();
    expect(projectLinkDragPreview([], "external", 25, "missing")).toBeNull();
  });

  it("does not emit invalid geometry for a missing or invalid active height", () => {
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(projectLinkDragPreview(rows, "a", height, "c")).toBeNull();
    }
  });

  it("keeps fractional measurements instead of rounding cumulative offsets", () => {
    const fractional = [row("a", 3.25, 19.5), row("b", 23.25, 28.75), row("c", 52.5, 10.25)];
    expect(projectLinkDragPreview(fractional, "c", 10.25, "a")).toEqual({
      offsets: { a: 10.75, b: 10.75 }, gapTop: 3.25, gapHeight: 10.25, extraHeight: 0
    });
  });
});
