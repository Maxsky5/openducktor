import { describe, expect, test } from "bun:test";
import { normalizeLabels } from "./index";

describe("normalizeLabels", () => {
  test("trims, de-duplicates, and sorts labels", () => {
    expect(normalizeLabels([" backend ", "ui", "", "backend", " ops "])).toEqual([
      "backend",
      "ops",
      "ui",
    ]);
  });
});
