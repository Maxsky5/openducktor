import { describe, expect, test } from "bun:test";
import {
  type WorkflowLaunchDecision,
  workflowLaunchRequestSchema,
} from "./workflow-launch-schemas";

/** Tests also send a target directory on decisions whose contract rejects it. */
type DecisionInput = WorkflowLaunchDecision & { targetWorkingDirectory?: string };

const sourceSession = {
  externalSessionId: "builder-1",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktrees/task-1",
};
const selectedModel = { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt" };
const conflictLaunch = (decision: DecisionInput) => ({
  workspaceId: "workspace-1",
  repoPath: "/repo",
  taskId: "task-1",
  policy: { kind: "manual", actionId: "build_rebase_conflict_resolution", decision },
  instruction: { kind: "message", parts: [{ kind: "text", text: "Resolve the conflict." }] },
});

describe("workflow launch contracts", () => {
  test("accepts a target working directory on a fresh decision", () => {
    const decision: DecisionInput = {
      startMode: "fresh",
      selectedModel,
      targetWorkingDirectory: "/worktrees/task-1",
    };
    expect(workflowLaunchRequestSchema.parse(conflictLaunch(decision)).policy).toMatchObject({
      decision,
    });
  });

  test("accepts a reuse decision that names only its source session", () => {
    expect(
      workflowLaunchRequestSchema.safeParse(conflictLaunch({ startMode: "reuse", sourceSession }))
        .success,
    ).toBe(true);
  });

  test.each<DecisionInput>([
    { startMode: "reuse", sourceSession },
    { startMode: "fork", sourceSession, selectedModel },
  ])("rejects a target working directory on a $startMode decision", (decision) => {
    expect(
      workflowLaunchRequestSchema.safeParse(
        conflictLaunch({ ...decision, targetWorkingDirectory: "/worktrees/task-1" }),
      ).success,
    ).toBe(false);
  });

  test("rejects unknown request fields", () => {
    const request = conflictLaunch({ startMode: "reuse", sourceSession });
    for (const extra of [{ launchAttemptId: "attempt" }, { queueIfBusy: true }])
      expect(workflowLaunchRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
});
