import { beforeEach, describe, expect, test } from "bun:test";
import type { GitConflict } from "@/features/agent-studio-git";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useGitConflictResolutionModalState } from "./git-conflict-resolution-modal";
import type { PendingGitConflictResolutionRequest } from "./use-git-conflict-resolution";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const builderSession = (sessionId: string): AgentSessionState => ({
  sessionId,
  externalSessionId: `external-${sessionId}`,
  taskId: "task-1",
  runtimeKind: "opencode",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-18T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

const conflictFixture: GitConflict = {
  operation: "rebase",
  currentBranch: "feature/test",
  targetBranch: "main",
  conflictedFiles: ["src/example.ts"],
  output: "CONFLICT",
  workingDir: "/tmp/repo/worktree",
};

const createRequest = (
  overrides: Partial<PendingGitConflictResolutionRequest> = {},
): PendingGitConflictResolutionRequest => ({
  requestId: "request-1",
  conflict: conflictFixture,
  currentWorktreePath: "/tmp/repo/worktree",
  currentViewSessionId: "session-1",
  defaultMode: "existing",
  defaultSessionId: "session-1",
  builderSessions: [builderSession("session-1"), builderSession("session-2")],
  ...overrides,
});

let latestState: ReturnType<typeof useGitConflictResolutionModalState> | undefined;

const createHarness = (request: PendingGitConflictResolutionRequest) =>
  createSharedHookHarness((currentRequest: PendingGitConflictResolutionRequest) => {
    latestState = useGitConflictResolutionModalState(currentRequest);
    return null;
  }, request);

describe("git-conflict-resolution-modal", () => {
  beforeEach(() => {
    latestState = undefined;
  });

  test("disables confirm when the selected existing session is no longer available", async () => {
    const request = createRequest({
      defaultSessionId: " missing-session ",
    });

    const harness = createHarness(request);
    await harness.mount();

    try {
      if (!latestState) {
        throw new Error("Expected conflict-resolution modal harness to mount");
      }

      expect(latestState.confirmDisabled).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("reconciles state against the latest request before applying updates", async () => {
    const firstRequest = createRequest();
    const secondRequest = createRequest({
      requestId: "request-2",
      defaultMode: "new",
      defaultSessionId: "",
      builderSessions: [builderSession("session-3")],
    });

    const harness = createHarness(firstRequest);
    await harness.mount();

    try {
      if (!latestState) {
        throw new Error("Expected conflict-resolution modal harness to mount");
      }

      await harness.update(secondRequest);
      await harness.run(() => {
        latestState?.setSelectedSessionId("session-3");
      });
      await harness.update(secondRequest);

      if (!latestState) {
        throw new Error("Expected latest conflict-resolution modal state");
      }

      expect(latestState.mode).toBe("new");
      expect(latestState.selectedSessionId).toBe("session-3");
      expect(latestState.confirmDisabled).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
