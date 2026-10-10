import { describe, expect, test } from "bun:test";
import type { ClientRect, DragEndEvent } from "@dnd-kit/core";
import type { PanelId } from "./panel-tab-kinds";
import {
  type ActiveDrag,
  dropFeedback,
  type PanelDragData,
  type PanelTabIds,
  resolvePanelDrop,
} from "./session-panel-drop";

const rect = (left: number, width = 100): ClientRect => ({
  left,
  width,
  right: left + width,
  top: 0,
  height: 28,
  bottom: 28,
});

const tabIds: PanelTabIds = {
  right: ["diffs", "files", "terminal:a"],
  bottom: ["terminal:b"],
};

/** A drag of a tab over a tab or a strip, with the dragged tab at `draggedLeft`. */
const dragOver = (
  entryId: string,
  from: PanelId,
  over: { id: string; data: PanelDragData; left?: number } | null,
  draggedLeft = 0,
): Pick<DragEndEvent, "active" | "over"> => ({
  active: {
    id: entryId,
    data: { current: { type: "tab", panel: from } },
    rect: { current: { initial: rect(0), translated: rect(draggedLeft) } },
  },
  over: over
    ? { id: over.id, rect: rect(over.left ?? 0), disabled: false, data: { current: over.data } }
    : null,
});

describe("resolvePanelDrop", () => {
  test("puts a tab in the place of the target in its own panel", () => {
    expect(
      resolvePanelDrop(
        dragOver("diffs", "right", { id: "terminal:a", data: { type: "tab", panel: "right" } }),
        tabIds,
      ),
    ).toEqual({
      entryId: "diffs",
      from: "right",
      to: "right",
      target: { id: "terminal:a", position: "after" },
    });
    expect(
      resolvePanelDrop(
        dragOver("terminal:a", "right", { id: "diffs", data: { type: "tab", panel: "right" } }),
        tabIds,
      )?.target,
    ).toEqual({ id: "diffs", position: "before" });
  });

  test("puts a tab before or after a tab of the other panel by the side of its center", () => {
    const overBottomTab = (draggedLeft: number) =>
      resolvePanelDrop(
        dragOver(
          "terminal:a",
          "right",
          { id: "terminal:b", data: { type: "tab", panel: "bottom" }, left: 200 },
          draggedLeft,
        ),
        tabIds,
      );

    expect(overBottomTab(120)?.target).toEqual({ id: "terminal:b", position: "before" });
    expect(overBottomTab(220)?.target).toEqual({ id: "terminal:b", position: "after" });
  });

  test("puts a tab at the end of a panel when it is over the strip", () => {
    expect(
      resolvePanelDrop(
        dragOver("terminal:a", "right", {
          id: "strip:bottom",
          data: { type: "strip", panel: "bottom" },
        }),
        tabIds,
      ),
    ).toEqual({ entryId: "terminal:a", from: "right", to: "bottom", target: null });
  });

  test("has no drop over the dragged tab itself or outside both strips", () => {
    expect(
      resolvePanelDrop(
        dragOver("diffs", "right", { id: "diffs", data: { type: "tab", panel: "right" } }),
        tabIds,
      ),
    ).toBeNull();
    expect(resolvePanelDrop(dragOver("diffs", "right", null), tabIds)).toBeNull();
  });
});

describe("dropFeedback", () => {
  const dragTo = (to: PanelId): ActiveDrag => ({
    entryId: "terminal:a",
    from: "right",
    drop: { entryId: "terminal:a", from: "right", to, target: { id: "x", position: "after" } },
  });

  test("shows where the tab lands in the other panel when that panel accepts it", () => {
    expect(dropFeedback(dragTo("bottom"), () => true)).toEqual({
      panel: "bottom",
      isAllowed: true,
      target: { id: "x", position: "after" },
    });
  });

  test("rejects a drop that the other panel does not allow, with no landing place", () => {
    expect(dropFeedback(dragTo("bottom"), () => false)).toEqual({
      panel: "bottom",
      isAllowed: false,
      target: null,
    });
  });

  test("gives no feedback for a reorder in the panel of the tab", () => {
    expect(dropFeedback(dragTo("right"), () => true)).toEqual({
      panel: null,
      isAllowed: false,
      target: null,
    });
    expect(dropFeedback(null, () => true).panel).toBeNull();
  });
});
