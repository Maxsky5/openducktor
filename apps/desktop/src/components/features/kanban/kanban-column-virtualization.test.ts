import { describe, expect, test } from "bun:test";
import {
  buildVirtualColumnLayout,
  findVirtualWindowRange,
  getVirtualWindowEdgeOffsets,
} from "@/components/features/kanban/kanban-column-virtualization";

describe("kanban-column virtualization helpers", () => {
  test("buildVirtualColumnLayout tracks offsets with inter-card gaps", () => {
    const layout = buildVirtualColumnLayout([100, 120, 140], 12);

    expect(layout.itemOffsets).toEqual([0, 112, 244]);
    expect(layout.totalHeight).toBe(384);
  });

  test("findVirtualWindowRange returns only intersecting items", () => {
    const itemHeights = [80, 90, 100, 110];
    const layout = buildVirtualColumnLayout(itemHeights, 12);

    const range = findVirtualWindowRange({
      itemOffsets: layout.itemOffsets,
      itemHeights,
      totalHeight: layout.totalHeight,
      viewportStart: 90,
      viewportEnd: 250,
    });

    expect(range).toEqual({ startIndex: 1, endIndex: 2 });
  });

  test("findVirtualWindowRange returns empty when viewport is outside the column", () => {
    const itemHeights = [80, 90, 100];
    const layout = buildVirtualColumnLayout(itemHeights, 12);

    const range = findVirtualWindowRange({
      itemOffsets: layout.itemOffsets,
      itemHeights,
      totalHeight: layout.totalHeight,
      viewportStart: -600,
      viewportEnd: -200,
    });

    expect(range).toEqual({ startIndex: 0, endIndex: -1 });
  });

  test("getVirtualWindowEdgeOffsets returns spacer heights around visible range", () => {
    const itemHeights = [100, 110, 120, 130];
    const layout = buildVirtualColumnLayout(itemHeights, 12);

    const offsets = getVirtualWindowEdgeOffsets({
      range: { startIndex: 1, endIndex: 2 },
      itemOffsets: layout.itemOffsets,
      itemHeights,
      totalHeight: layout.totalHeight,
    });

    expect(offsets).toEqual({
      topSpacerHeight: 112,
      bottomSpacerHeight: 142,
    });
  });
});
