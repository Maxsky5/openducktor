import { describe, expect, test } from "bun:test";
import { isReadOnlyAgentRole } from "./approval-policy";

describe("approval policy", () => {
  test("identifies read-only roles", () => {
    expect(isReadOnlyAgentRole("spec")).toBe(true);
    expect(isReadOnlyAgentRole("planner")).toBe(true);
    expect(isReadOnlyAgentRole("qa")).toBe(true);
    expect(isReadOnlyAgentRole("build")).toBe(false);
  });
});
