import { describe, expect, test } from "bun:test";
import type { KanbanColumnId } from "@openducktor/workflows";
import type { BoardColumn } from "./board-columns";
import { nextLaneToMount } from "./board-lane-mounting";

const ids: readonly KanbanColumnId[] = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
];
// SAFETY: the lane order is the only field that the mounting order reads.
const columns = ids.map((id) => ({ id }) as BoardColumn);

describe("nextLaneToMount", () => {
  test("mounts the nearest lanes first, right before left", () => {
    expect(nextLaneToMount(columns, 2, new Set(["ready_for_dev"]))).toBe("in_progress");
    expect(nextLaneToMount(columns, 2, new Set(["ready_for_dev", "in_progress"]))).toBe(
      "spec_ready",
    );
    expect(
      nextLaneToMount(columns, 2, new Set(["ready_for_dev", "in_progress", "spec_ready"])),
    ).toBe("blocked");
  });

  test("returns null once every lane has its list", () => {
    expect(nextLaneToMount(columns, 0, new Set(ids))).toBeNull();
  });
});
