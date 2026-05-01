import { describe, expect, test } from "bun:test";
import {
  agentRoleSchema,
  agentRoleValues,
  agentSessionStartModeSchema,
  agentSessionStartModeValues,
  agentToolNameSchema,
  agentToolNameValues,
} from "./agent-workflow-schemas";

describe("agent-workflow-schemas", () => {
  test("exports the canonical agent roles", () => {
    expect(agentRoleValues).toEqual(["spec", "planner", "build", "qa"]);
    expect(agentRoleSchema.parse("build")).toBe("build");
  });

  test("exports the canonical start modes", () => {
    expect(agentSessionStartModeValues).toEqual(["fresh", "reuse", "fork"]);
    expect(agentSessionStartModeSchema.parse("reuse")).toBe("reuse");
  });

  test("exports the workflow tool name enum", () => {
    expect(agentToolNameValues.length).toBeGreaterThan(0);
    expect(agentToolNameSchema.parse(agentToolNameValues[0])).toBe(agentToolNameValues[0]);
  });
});
