import { describe, expect, test } from "bun:test";
import type { PlannerTools } from "../types/planner";
import { PlannerSpecService } from "./planner-spec-service";

const createToolsMock = (): {
  tools: PlannerTools;
  calls: Array<{ taskId: string; markdown: string }>;
} => {
  const calls: Array<{ taskId: string; markdown: string }> = [];
  const tools: PlannerTools = {
    async setSpec(input) {
      calls.push({ taskId: input.taskId, markdown: input.markdown });
      return { updatedAt: "2026-02-17T12:00:00Z" };
    },
    async setPlan(_input) {
      return { updatedAt: "2026-02-17T12:00:00Z" };
    },
  };
  return { tools, calls };
};

describe("PlannerSpecService", () => {
  test("template contains required section headings", () => {
    const { tools } = createToolsMock();
    const service = new PlannerSpecService(tools);
    const template = service.template();

    expect(template).toContain("# Purpose");
    expect(template).toContain("# Problem");
    expect(template).toContain("# Test Plan");
  });

  test("save rejects invalid markdown and does not call setSpec", async () => {
    const { tools, calls } = createToolsMock();
    const service = new PlannerSpecService(tools);

    await expect(service.save("task-1", "# Purpose\n\nOnly one section")).rejects.toThrow(
      "Spec is missing required sections",
    );
    expect(calls).toHaveLength(0);
  });

  test("save delegates valid markdown to setSpec", async () => {
    const { tools, calls } = createToolsMock();
    const service = new PlannerSpecService(tools);
    const markdown = `
# Purpose

> Purpose: Why this exists.

# Problem

Current issue.

# Goals

Goal.

# Non-goals

Out of scope.

# Scope

Boundaries.

# API / Interfaces

Contracts.

# Risks

Risk and mitigation.

# Test Plan

Tests.
`.trim();

    const output = await service.save("task-42", markdown);
    expect(output.updatedAt).toBe("2026-02-17T12:00:00Z");
    expect(calls).toEqual([{ taskId: "task-42", markdown }]);
  });
});
