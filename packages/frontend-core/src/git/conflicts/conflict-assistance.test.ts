import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { createAgentMessageSendReceipt } from "../../test-support/agent-message-send-fixture";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import type { GitConflict } from "../contracts";
import {
  buildTaskConflictPrompt,
  CHAT_CONFLICT_DIRECTORY_MISMATCH_REASON,
  chatConflictBlockedReason,
  conflictBuilderSessions,
  describeConflictRequestReceipt,
  workspaceConflictRecipientBlockedReason,
} from "./conflict-assistance";
import {
  detectedGitConflict,
  gitConflictDescription,
  UNIDENTIFIED_GIT_CONFLICT_DESCRIPTION,
} from "./conflict-copy";

const conflict: GitConflict = {
  operation: "rebase",
  currentBranch: "feature/task-1",
  targetBranch: "origin/main",
  conflictedFiles: ["src/conflict.ts"],
  output: "CONFLICT (content): Merge conflict in src/conflict.ts",
  workingDir: "/repo/worktrees/task-1",
};

const builder = (externalSessionId: string, workingDirectory: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory,
});

describe("conflict copy", () => {
  test("describes the paused operation and its target", () => {
    expect(gitConflictDescription(conflict)).toBe(
      "The rebase onto origin/main is still paused on conflicts.",
    );
    expect(gitConflictDescription({ ...conflict, targetBranch: "" })).toBe(
      "The rebase is still paused on conflicts.",
    );
    expect(gitConflictDescription({ ...conflict, operation: null })).toBe(
      UNIDENTIFIED_GIT_CONFLICT_DESCRIPTION,
    );
  });

  test("turns unmerged files into a conflict without an operation", () => {
    expect(
      detectedGitConflict({ branch: "feature", conflictedFiles: ["a.ts"], workingDir: "/repo" }),
    ).toMatchObject({ operation: null, currentBranch: "feature", conflictedFiles: ["a.ts"] });
    expect(
      detectedGitConflict({ branch: "feature", conflictedFiles: [], workingDir: "/repo" }),
    ).toBeNull();
  });
});

describe("conflict assistance", () => {
  test("picks the Builders in the conflict directory, preferring the current session", () => {
    const sessions = [
      builder("elsewhere", "/repo"),
      builder("first", "/repo/worktrees/task-1/"),
      builder("current", "/repo/worktrees/task-1"),
    ];
    const current = conflictBuilderSessions(
      conflict,
      sessions,
      builder("current", "/repo/worktrees/task-1"),
    );
    expect(current.matching.map((session) => session.externalSessionId)).toEqual([
      "first",
      "current",
    ]);
    expect(current.defaultBuilder?.externalSessionId).toBe("current");
    expect(
      conflictBuilderSessions(conflict, sessions, null).defaultBuilder?.externalSessionId,
    ).toBe("first");
  });

  test("builds the task conflict request with the task context", () => {
    const prompt = buildTaskConflictPrompt({
      conflict,
      taskId: "task-1",
      task: createTaskCardFixture({ id: "task-1", title: "Resolve the parser conflict" }),
      overrides: {},
    });
    expect(prompt).toContain("src/conflict.ts");
    expect(prompt).toContain("Use taskId task-1");
    expect(() =>
      buildTaskConflictPrompt({
        conflict: { ...conflict, operation: null },
        taskId: "task-1",
        task: null,
        overrides: {},
      }),
    ).toThrow("Restore the Git conflict operation and working directory");
  });

  test("describes the receipt of a conflict request", () => {
    const accepted = createAgentMessageSendReceipt();
    expect(describeConflictRequestReceipt(accepted, "Builder")).toEqual({
      kind: "sent",
      title: "Sent git conflict resolution request to Builder",
    });
    expect(
      describeConflictRequestReceipt({ outcome: "queued", recipient: accepted.recipient }, "agent"),
    ).toEqual({ kind: "sent", title: "Queued git conflict resolution request for agent" });
    expect(
      describeConflictRequestReceipt(
        { ...accepted, postAcceptanceFailure: "Hook failed." },
        "Builder",
      ),
    ).toMatchObject({ kind: "host_step_failed", detail: "Hook failed." });
    expect(
      describeConflictRequestReceipt(
        { outcome: "uncertain", recipient: accepted.recipient, submissionId: "s1" },
        "Builder",
      ).kind,
    ).toBe("uncertain");
  });

  test("blocks a chat that cannot receive a conflict request", () => {
    const record: WorkspaceSession = {
      id: "chat-1",
      runtimeKind: "opencode",
      externalSessionId: "ext-1",
      executionTarget: {
        kind: "local_worktree",
        workingDirectory: "/repo/worktrees/chat",
        branchName: "chat",
        worktreeState: "present",
      },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      targetBranch: null,
    };
    expect(workspaceConflictRecipientBlockedReason(record)).toBeNull();
    expect(workspaceConflictRecipientBlockedReason({ ...record, archivedAt: 2 })).toBe(
      "Restore the saved workspace chat before asking for assistance.",
    );
    expect(
      workspaceConflictRecipientBlockedReason({
        ...record,
        executionTarget: {
          kind: "local_worktree",
          workingDirectory: "/repo/worktrees/chat",
          branchName: "chat",
          worktreeState: "removed",
        },
      }),
    ).toBe("Restore this chat's saved working directory before asking for assistance.");
    expect(chatConflictBlockedReason(record, conflict)).toBe(
      CHAT_CONFLICT_DIRECTORY_MISMATCH_REASON,
    );
    expect(
      chatConflictBlockedReason(record, { ...conflict, workingDir: "/repo/worktrees/chat/" }),
    ).toBeNull();
    expect(chatConflictBlockedReason({ ...record, archivedAt: 2 }, conflict)).toBe(
      "Restore the saved workspace chat before asking for assistance.",
    );
  });
});
