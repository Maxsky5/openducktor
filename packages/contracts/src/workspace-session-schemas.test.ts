import { describe, expect, test } from "bun:test";
import {
  customAgentRoleInputSchema,
  workspaceSessionExecutionTargetSchema,
  workspaceSessionSchema,
} from "./workspace-session-schemas";

const session = () => ({
  id: "session-1",
  runtimeKind: "codex",
  externalSessionId: "runtime-session-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

describe("Workspace Session contracts", () => {
  test("represents a persisted draft with an explicit null runtime identity", () => {
    expect(
      workspaceSessionSchema.parse({ ...session(), externalSessionId: null }).externalSessionId,
    ).toBeNull();
    expect(workspaceSessionSchema.safeParse({ ...session(), externalSessionId: "" }).success).toBe(
      false,
    );
  });
  test("accepts an untitled session without a Role or selected model", () => {
    expect(workspaceSessionSchema.parse(session())).toEqual(session());
  });

  test("rejects a model from another Runtime", () => {
    expect(
      workspaceSessionSchema.safeParse({
        ...session(),
        selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "model" },
      }).success,
    ).toBe(false);
  });

  test("keeps live and Task-owned fields outside the durable record", () => {
    for (const field of [
      "taskId",
      "repoPath",
      "runtimeId",
      "runtimeRoute",
      "messages",
      "pendingQuestions",
      "status",
    ]) {
      expect(
        workspaceSessionSchema.safeParse({ ...session(), [field]: "unexpected" }).success,
      ).toBe(false);
    }
  });

  test("accepts local absolute targets and rejects relative paths, branches, and remote kinds", () => {
    for (const workingDirectory of ["/repo", "C:\\repo", "\\\\server\\repo"]) {
      expect(
        workspaceSessionExecutionTargetSchema.safeParse({
          kind: "local_worktree",
          workingDirectory,
          branchName: "feature/chat",
          worktreeState: "present",
        }).success,
      ).toBe(true);
    }
    for (const target of [
      { kind: "local_worktree", workingDirectory: "relative" },
      { kind: "local_worktree", workingDirectory: "/repo", branch: "main" },
      { kind: "ssh", workingDirectory: "/repo" },
    ])
      expect(workspaceSessionExecutionTargetSchema.safeParse(target).success).toBe(false);
  });

  test("requires explicit branch and removal metadata for worktree records", () => {
    const target = {
      kind: "local_worktree",
      workingDirectory: "/repo/chat",
      branchName: "feature/chat",
      worktreeState: "removed",
    };
    expect(workspaceSessionExecutionTargetSchema.parse(target)).toEqual(target);
    expect(
      workspaceSessionExecutionTargetSchema.safeParse({
        kind: "local_worktree",
        workingDirectory: "/repo/chat",
      }).success,
    ).toBe(false);
    expect(
      workspaceSessionExecutionTargetSchema.safeParse({ ...target, branchName: "" }).success,
    ).toBe(false);
    expect(
      workspaceSessionExecutionTargetSchema.safeParse({ ...target, worktreeState: "unknown" })
        .success,
    ).toBe(false);
  });

  test("validates title lengths and integer timestamps without cross-field ordering rules", () => {
    expect(
      workspaceSessionSchema.safeParse({ ...session(), generatedTitle: "a".repeat(41) }).success,
    ).toBe(false);
    expect(
      workspaceSessionSchema.safeParse({ ...session(), manualTitle: "a".repeat(121) }).success,
    ).toBe(true);
    expect(workspaceSessionSchema.safeParse({ ...session(), updatedAt: 1.5 }).success).toBe(false);
    expect(
      workspaceSessionSchema.safeParse({ ...session(), createdAt: 10, updatedAt: 1 }).success,
    ).toBe(true);
  });

  test("trims Role names without changing system prompt text", () => {
    expect(
      customAgentRoleInputSchema.parse({
        name: "  Reviewer  ",
        systemPrompt: "  Keep this prompt.\n",
      }),
    ).toEqual({ name: "Reviewer", systemPrompt: "  Keep this prompt.\n" });
    expect(
      customAgentRoleInputSchema.safeParse({ name: " ", systemPrompt: "prompt" }).success,
    ).toBe(false);
  });
});
