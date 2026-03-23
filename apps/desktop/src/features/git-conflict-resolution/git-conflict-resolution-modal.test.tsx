import { beforeEach, describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { createElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { GitConflict } from "@/features/agent-studio-git";
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

const HookHarness = ({
  request,
}: {
  request: PendingGitConflictResolutionRequest;
}): ReactElement => {
  latestState = useGitConflictResolutionModalState(request);
  return createElement("div");
};

describe("git-conflict-resolution-modal", () => {
  beforeEach(() => {
    latestState = undefined;
  });

  test("disables confirm when the selected existing session is no longer available", async () => {
    const request = createRequest({
      defaultSessionId: " missing-session ",
    });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(HookHarness, { request }));
    });

    if (!renderer || !latestState) {
      throw new Error("Expected conflict-resolution modal harness to mount");
    }

    expect(latestState.confirmDisabled).toBe(true);

    await act(async () => {
      renderer?.unmount();
    });
  });

  test("reconciles state against the latest request before applying updates", async () => {
    const firstRequest = createRequest();
    const secondRequest = createRequest({
      requestId: "request-2",
      defaultMode: "new",
      defaultSessionId: "",
      builderSessions: [builderSession("session-3")],
    });

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(HookHarness, { request: firstRequest }));
    });

    if (!renderer || !latestState) {
      throw new Error("Expected conflict-resolution modal harness to mount");
    }

    await act(async () => {
      renderer?.update(createElement(HookHarness, { request: secondRequest }));
    });

    await act(async () => {
      latestState?.setSelectedSessionId("session-3");
      renderer?.update(createElement(HookHarness, { request: secondRequest }));
    });

    if (!latestState) {
      throw new Error("Expected latest conflict-resolution modal state");
    }

    expect(latestState.mode).toBe("new");
    expect(latestState.selectedSessionId).toBe("session-3");
    expect(latestState.confirmDisabled).toBe(false);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
