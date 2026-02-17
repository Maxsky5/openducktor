import { describe, expect, test } from "bun:test";
import { repoConfigSchema, runEventSchema, taskCardSchema } from "./index";

describe("runtime schemas", () => {
  test("task card parses workflow status from host payloads", () => {
    const parsed = taskCardSchema.parse({
      id: "task-1",
      title: "Sample",
      description: "",
      status: "spec_ready",
      priority: 2,
      issueType: "task",
      labels: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.status).toBe("spec_ready");
    expect(parsed.aiReviewEnabled).toBe(true);
    expect(parsed.availableActions).toEqual([]);
    expect(parsed.notes).toBe("");
  });

  test("task card coerces unsupported issue types to task", () => {
    const parsed = taskCardSchema.parse({
      id: "task-2",
      title: "Legacy type",
      description: "",
      status: "open",
      priority: 2,
      issueType: "decision",
      labels: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.issueType).toBe("task");
  });

  test("permission_required event accepts null command", () => {
    const parsed = runEventSchema.parse({
      type: "permission_required",
      runId: "run-1",
      message: "permission prompt",
      command: null,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.type).toBe("permission_required");
    expect(parsed.command).toBeUndefined();
  });

  test("repo config accepts null worktree base path", () => {
    const parsed = repoConfigSchema.parse({
      worktreeBasePath: null,
      branchPrefix: "obp",
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
    });

    expect(parsed.worktreeBasePath).toBeUndefined();
  });
});
