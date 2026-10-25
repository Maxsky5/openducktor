import { describe, expect, test } from "bun:test";
import { normalizeTaskLabel, toDisplayTaskLabels } from "./task-labels";

describe("task-labels", () => {
  test("returns every stored label for display", () => {
    expect(toDisplayTaskLabels(["phase:open", "phase:open-source", "backend"])).toEqual([
      "phase:open",
      "phase:open-source",
      "backend",
    ]);
  });

  test("stores a typed label in lower case with dashes for spaces", () => {
    expect(normalizeTaskLabel("  Needs   Review ")).toBe("needs-review");
    expect(normalizeTaskLabel("API")).toBe("api");
    expect(normalizeTaskLabel("   ")).toBe("");
  });
});
