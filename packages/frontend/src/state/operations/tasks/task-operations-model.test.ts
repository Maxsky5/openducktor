import { describe, expect, test } from "bun:test";
import {
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
  WORKSPACE_REQUIRED_ERROR,
} from "./task-operations-model";

describe("task-operations-model", () => {
  test("returns active repo or throws when missing", () => {
    expect(requireActiveRepo("/repo")).toBe("/repo");
    expect(() => requireActiveRepo(null)).toThrow(WORKSPACE_REQUIRED_ERROR);
  });

  test("normalizes titles and update descriptions", () => {
    expect(toNormalizedTitle("  Task title  ")).toBe("Task title");
    expect(toUpdateSuccessDescription("T-1", { title: "  New title  " })).toBe("New title");
    expect(toUpdateSuccessDescription("T-1", { title: "   " })).toBe("T-1");
  });
});
