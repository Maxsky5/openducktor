import { describe, expect, test } from "bun:test";
import type {
  StartupAttempt,
  StartupAttemptStatus,
} from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { canOpenStartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-navigation";

const workspaceAttempt = (overrides: {
  phase?: StartupAttemptStatus["phase"];
  confirmation?: StartupAttemptStatus["confirmation"];
  presentation?: StartupAttempt["presentation"];
  externalSessionId?: string | null;
  saved?: boolean;
}): StartupAttempt => {
  const saved = overrides.saved ?? true;
  return {
    id: "attempt-1",
    origin: {
      workspaceId: "ws-1",
      repoPath: "/repo",
      scope: { kind: "workspace", draftId: "draft-1" },
    },
    label: "Start workspace session",
    presentation: overrides.presentation ?? "notification",
    status: {
      phase: overrides.phase ?? "failed",
      confirmation: overrides.confirmation ?? "current",
    },
    instructionRequired: true,
    operations: [],
    ownership: saved
      ? {
          state: "saved",
          target: {
            kind: "workspace",
            record: {
              id: "saved-1",
              runtimeKind: "codex",
              externalSessionId:
                overrides.externalSessionId === undefined ? null : overrides.externalSessionId,
              executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
              selectedModel: null,
              roleSnapshot: null,
              generatedTitle: null,
              manualTitle: null,
              targetBranch: null,
              createdAt: 1,
              updatedAt: 1,
              archivedAt: null,
            },
          },
        }
      : { state: "not_saved" },
    navigationTarget: saved
      ? { kind: "workspace_session", workspaceId: "ws-1", sessionId: "saved-1" }
      : { kind: "workspace_session_draft", workspaceId: "ws-1", draftId: "draft-1" },
  };
};

describe("canOpenStartupAttempt", () => {
  test("allows opening saved-unbound workspace notifications when failed, running, or unconfirmed", () => {
    expect(canOpenStartupAttempt(workspaceAttempt({ phase: "failed" }))).toBe(true);
    expect(canOpenStartupAttempt(workspaceAttempt({ phase: "running" }))).toBe(true);
    expect(
      canOpenStartupAttempt(workspaceAttempt({ phase: "failed", confirmation: "unconfirmed" })),
    ).toBe(true);
  });

  test("allows opening unsaved workspace draft notifications", () => {
    expect(canOpenStartupAttempt(workspaceAttempt({ saved: false, phase: "running" }))).toBe(true);
    expect(canOpenStartupAttempt(workspaceAttempt({ saved: false, phase: "failed" }))).toBe(true);
  });

  test("still blocks opening pending or unbound task notifications", () => {
    const taskAttempt: StartupAttempt = {
      id: "task-attempt",
      origin: {
        workspaceId: "ws-1",
        repoPath: "/repo",
        scope: { kind: "task", taskId: "task-1", role: "build" },
      },
      label: "Start build session",
      presentation: "notification",
      status: { phase: "running", confirmation: "current" },
      instructionRequired: false,
      operations: [],
      ownership: { state: "unknown" },
    };
    expect(canOpenStartupAttempt(taskAttempt)).toBe(false);
    expect(canOpenStartupAttempt(null)).toBe(false);
  });
});
