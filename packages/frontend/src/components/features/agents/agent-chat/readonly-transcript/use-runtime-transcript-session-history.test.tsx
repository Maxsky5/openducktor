import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRuntimeTranscriptSessionHistory>[0];

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRuntimeTranscriptSessionHistory, initialProps, { wrapper });

const activeWorkspace: ActiveWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo-a",
};

const createSource = (
  overrides: Partial<RuntimeSessionTranscriptSource> = {},
): RuntimeSessionTranscriptSource => ({
  runtimeKind: "opencode",
  workingDirectory: "/repo-a/worktree",
  ...overrides,
});

const createHistoryMessage = (): AgentSessionHistoryMessage => ({
  messageId: "message-user-1",
  role: "user",
  timestamp: "2026-02-22T12:00:00.000Z",
  text: "Inspect this",
  displayParts: [],
  state: "read",
  parts: [],
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  isOpen: true,
  activeWorkspace,
  externalSessionId: "session-1",
  source: createSource(),
  liveSession: null,
  readSessionHistory: mock(async () => [createHistoryMessage()]),
  ...overrides,
});

describe("useRuntimeTranscriptSessionHistory", () => {
  test("loads history and builds a readonly transcript session", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const harness = createHookHarness(createBaseArgs({ readSessionHistory }));

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      });
      const session = harness.getLatest().session;
      expect(session?.externalSessionId).toBe("session-1");
      expect(session?.runtimeKind).toBe("opencode");
      expect(session?.workingDirectory).toBe("/repo-a/worktree");
      expect(session?.status).toBe("idle");
      expect(session ? getSessionMessageCount(session) : 0).toBeGreaterThan(0);
      expect(harness.getLatest().historyLoadState).toBe("loaded");
      expect(harness.getLatest().historyError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("prefers an already-live runtime session over history loading", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      status: "running",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a/worktree",
    });
    const harness = createHookHarness(
      createBaseArgs({
        liveSession,
        readSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().session).toEqual({
        externalSessionId: liveSession.externalSessionId,
        status: liveSession.status,
        runtimeKind: liveSession.runtimeKind,
        workingDirectory: liveSession.workingDirectory,
        messages: liveSession.messages,
        pendingApprovals: liveSession.pendingApprovals,
        pendingQuestions: liveSession.pendingQuestions,
        selectedModel: liveSession.selectedModel,
        todos: [],
      });
      expect(harness.getLatest().historyLoadState).toBe("loaded");
      expect(harness.getLatest().isHistoryLoading).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("loads history when a same-id live session belongs to another source", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const harness = createHookHarness(
      createBaseArgs({
        liveSession: createAgentSessionFixture({
          externalSessionId: "session-1",
          status: "running",
          runtimeKind: "opencode",
          workingDirectory: "/repo-b/worktree",
        }),
        readSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      });
      expect(harness.getLatest().session?.status).toBe("idle");
      expect(harness.getLatest().session?.workingDirectory).toBe("/repo-a/worktree");
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces history load failures", async () => {
    const readSessionHistory = mock(async () => {
      throw new Error("history unavailable");
    });
    const harness = createHookHarness(createBaseArgs({ readSessionHistory }));

    try {
      await harness.mount();
      await harness.waitFor((state) => state.historyError !== null);

      expect(harness.getLatest()).toEqual({
        session: null,
        historyLoadState: "failed",
        isHistoryLoading: false,
        historyError: "history unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });
});
