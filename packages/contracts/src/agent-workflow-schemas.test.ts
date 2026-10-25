import { describe, expect, test } from "bun:test";
import {
  agentRoleSchema,
  agentSessionStartModeSchema,
  agentSessionStartModeValues,
  agentToolNameSchema,
  agentToolNameValues,
} from "./agent-workflow-schemas";

describe("agent-workflow-schemas", () => {
  test("accepts any non-blank role ID", () => {
    expect(agentRoleSchema.parse("reviewer")).toBe("reviewer");
    expect(agentRoleSchema.safeParse(" ").success).toBe(false);
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
