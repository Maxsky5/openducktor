import { describe, expect, test } from "bun:test";
import { resolveTaskLabelOverflow } from "./kanban-task-label-overflow";

describe("resolveTaskLabelOverflow", () => {
  test("keeps all labels visible when they fit", () => {
    expect(
      resolveTaskLabelOverflow(["frontend", "ux"], {
        availableWidthPx: 200,
        measureLabelWidth: () => 40,
        measureOverflowWidth: () => 24,
        gapPx: 6,
      }),
    ).toEqual({
      visibleLabels: ["frontend", "ux"],
      hiddenLabels: [],
    });
  });

  test("only shows full labels that fit before the overflow chip", () => {
    expect(
      resolveTaskLabelOverflow(["quality-gate", "queued-review", "ops"], {
        availableWidthPx: 170,
        measureLabelWidth: (label) => {
          if (label === "quality-gate") {
            return 96;
          }
          if (label === "queued-review") {
            return 104;
          }
          return 40;
        },
        measureOverflowWidth: (hiddenCount) => (hiddenCount === 2 ? 36 : 30),
        gapPx: 6,
      }),
    ).toEqual({
      visibleLabels: ["quality-gate"],
      hiddenLabels: ["queued-review", "ops"],
    });
  });

  test("falls back to overflow only when no label fits without truncation", () => {
    expect(
      resolveTaskLabelOverflow(["very-long-label"], {
        availableWidthPx: 30,
        measureLabelWidth: () => 80,
        measureOverflowWidth: () => 26,
        gapPx: 6,
      }),
    ).toEqual({
      visibleLabels: [],
      hiddenLabels: ["very-long-label"],
    });
  });
});
