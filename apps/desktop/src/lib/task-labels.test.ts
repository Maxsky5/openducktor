import { describe, expect, test } from "bun:test";
import { toDisplayTaskLabels } from "./task-labels";

describe("task-labels", () => {
  test("returns every stored label for display", () => {
    expect(toDisplayTaskLabels(["phase:open", "phase:open-source", "backend"])).toEqual([
      "phase:open",
      "phase:open-source",
      "backend",
    ]);
  });
});
