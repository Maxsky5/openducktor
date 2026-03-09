import { describe, expect, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useRebaseConflictResolutionModalState } from "./agents-page-rebase-conflict-modal";
import type { PendingRebaseConflictResolutionRequest } from "./use-agent-studio-rebase-conflict-resolution";

enableReactActEnvironment();

const createHookHarness = (initialProps: PendingRebaseConflictResolutionRequest) =>
  createSharedHookHarness(useRebaseConflictResolutionModalState, initialProps);

const builderSession = createAgentSessionFixture({
  runtimeKind: "opencode",
  sessionId: "build-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
});

const createRequest = (requestId: string): PendingRebaseConflictResolutionRequest => ({
  requestId,
  conflict: {
    operation: "rebase",
    currentBranch: "feature/task-1",
    targetBranch: "origin/main",
    conflictedFiles: ["src/conflict.ts"],
    output: "CONFLICT (content): Merge conflict in src/conflict.ts",
    workingDir: "/repo/worktrees/task-1",
  },
  builderSessions: [builderSession],
  currentWorktreePath: "/repo/worktrees/task-1",
  currentViewSessionId: null,
  defaultMode: "existing",
  defaultSessionId: "build-1",
});

describe("useRebaseConflictResolutionModalState", () => {
  test("resets local mode when a new request replaces the current one", async () => {
    const harness = createHookHarness(createRequest("rebase-conflict-0"));

    try {
      await harness.mount();

      await harness.run((state) => {
        state.setMode("new");
      });
      expect(harness.getLatest().mode).toBe("new");

      await harness.update(createRequest("rebase-conflict-1"));
      expect(harness.getLatest().mode).toBe("existing");
      expect(harness.getLatest().selectedSessionId).toBe("build-1");
    } finally {
      await harness.unmount();
    }
  });
});
