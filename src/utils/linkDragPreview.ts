export type LinkPreviewRow = { id: string; top: number; height: number };

export type LinkDragPreview = {
  offsets: Record<string, number>;
  gapTop: number;
  gapHeight: number;
  extraHeight: number;
};

/** Project the committed insertion without moving the measured hit targets. */
export function projectLinkDragPreview(
  rows: LinkPreviewRow[], activeId: string, activeHeight: number, beforeId?: string
): LinkDragPreview | null {
  if (!Number.isFinite(activeHeight) || activeHeight <= 0 || beforeId === activeId
    || rows.some((row) => !Number.isFinite(row.top) || !Number.isFinite(row.height) || row.height <= 0)) return null;
  const source = rows.find((row) => row.id === activeId);
  const remaining = rows.filter((row) => row.id !== activeId);
  const index = beforeId ? remaining.findIndex((row) => row.id === beforeId) : remaining.length;
  if (index < 0) return null;
  const gaps = rows.slice(1).map((row, i) => Math.max(0, row.top - rows[i].top - rows[i].height));
  // Same-list moves retain the measured spacing by slot. An incoming row adds
  // only its own height; all existing spacing remains intact.
  if (!source) gaps.splice(index, 0, 0);
  const projected = remaining.slice();
  projected.splice(index, 0, { id: activeId, top: 0, height: source?.height ?? activeHeight });
  const result: LinkDragPreview = {
    offsets: {}, gapTop: 0, gapHeight: source?.height ?? activeHeight, extraHeight: source ? 0 : activeHeight
  };
  let top = rows[0]?.top ?? 0;
  projected.forEach((row, slot) => {
    if (row.id === activeId) result.gapTop = top;
    else result.offsets[row.id] = top - row.top;
    top += row.height + (gaps[slot] ?? 0);
  });
  return result;
}
