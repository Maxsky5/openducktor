import { describe, expect, test } from "bun:test";
import { toDisplayTaskLabels } from "./task-labels";

describe("task-labels", () => {
  test("filters phase labels from display labels", () => {
    expect(toDisplayTaskLabels(["phase:open", "backend", "phase:ready_for_dev"])).toEqual([
      "backend",
    ]);
  });
});
