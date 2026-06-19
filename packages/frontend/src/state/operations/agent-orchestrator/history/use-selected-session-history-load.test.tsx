import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren, ReactElement } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { createSessionMessagesState } from "../support/messages";
import { useSelectedSessionHistoryLoad } from "./use-selected-session-history-load";

const selectedSessionIdentity: AgentSessionIdentity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => {
  const externalSessionId =
    overrides.externalSessionId ?? selectedSessionIdentity.externalSessionId;
  return {
    externalSessionId,
    taskId: "task-1",
    role: "build",
    status: "idle",
    startedAt: "2026-06-12T08:00:00.000Z",
    runtimeKind: selectedSessionIdentity.runtimeKind,
    workingDirectory: selectedSessionIdentity.workingDirectory,
    historyLoadState: "not_requested",
    messages: createSessionMessagesState(externalSessionId),
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...overrides,
  };
};

const createProps = ({
  session = createSession(),
  repoReadinessState = "ready",
}: {
  session?: AgentSessionState | null;
  repoReadinessState?: RepoRuntimeReadinessState;
} = {}) => ({
  session,
  repoReadinessState,
});

const createHistoryLoadWrapper = (
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>,
) => {
  const operations: AgentOperationsContextValue = {
    readSessionTodos: async () => [],
    readSessionHistory: async () => [],
    loadAgentSessionHistory,
    startAgentSession: async () => ({
      externalSessionId: "session-started",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    }),
    sendAgentMessage: async () => undefined,
    stopAgentSession: async () => undefined,
    updateAgentSessionModel: () => undefined,
    replyAgentApproval: async () => undefined,
    answerAgentQuestion: async () => undefined,
  };
  return function HistoryLoadWrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <AgentOperationsContext.Provider value={operations}>
        {children}
      </AgentOperationsContext.Provider>
    );
  };
};

const createHistoryLoadHarness = (
  props: ReturnType<typeof createProps>,
  loadSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>,
) =>
  createHookHarness(useSelectedSessionHistoryLoad, props, {
    wrapper: createHistoryLoadWrapper(loadSessionHistory),
  });

describe("useSelectedSessionHistoryLoad", () => {
  test("loads the selected session history when the runtime is ready", async () => {
    const loadSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(createProps(), loadSessionHistory);

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledWith(selectedSessionIdentity);
    } finally {
      await harness.unmount();
    }
  });

  test("does not restart history loading for unrelated selected-session changes", async () => {
    const loadSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(createProps(), loadSessionHistory);

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(
        createProps({
          session: createSession({
            status: "running",
            title: "Updated title",
          }),
        }),
      );

      expect(loadSessionHistory).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("waits for runtime readiness before loading selected session history", async () => {
    const loadSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps({ repoReadinessState: "checking" }),
      loadSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).not.toHaveBeenCalled();

      await harness.update(createProps({ repoReadinessState: "ready" }));

      expect(loadSessionHistory).toHaveBeenCalledWith(selectedSessionIdentity);
    } finally {
      await harness.unmount();
    }
  });

  test("does not load when selected history was already requested", async () => {
    const loadSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps({
        session: createSession({ historyLoadState: "loading" }),
      }),
      loadSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("uses the selected session state as the history load identity", async () => {
    const loadSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps({
        session: createSession({
          externalSessionId: "session-from-state",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex-worktree",
        }),
      }),
      loadSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledWith({
        externalSessionId: "session-from-state",
        runtimeKind: "codex",
        workingDirectory: "/repo/codex-worktree",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("loads baseline history when a live Codex message arrives before hydration", async () => {
    const loadSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps({
        session: createSession({
          runtimeKind: "codex",
          messages: createSessionMessagesState(selectedSessionIdentity.externalSessionId, [
            {
              id: "live-kickoff",
              role: "user",
              content: "Implement the requested changes",
              timestamp: "2026-06-12T08:00:01.000Z",
            },
          ]),
        }),
      }),
      loadSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledWith({
        externalSessionId: selectedSessionIdentity.externalSessionId,
        runtimeKind: "codex",
        workingDirectory: selectedSessionIdentity.workingDirectory,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("reports selected-session history load failures through the orchestrator side-effect owner", async () => {
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    const harness = createHistoryLoadHarness(createProps(), async () => {
      throw new Error("history failed");
    });

    try {
      await harness.mount();

      expect(errorCalls.length).toBe(1);
      expect(String(errorCalls[0]?.[1] ?? "")).toBe("selected-session-history-load");
      expect(errorCalls[0]?.[2]).toMatchObject({
        reason: "history failed",
        tags: {
          externalSessionId: selectedSessionIdentity.externalSessionId,
          runtimeKind: selectedSessionIdentity.runtimeKind,
          workingDirectory: selectedSessionIdentity.workingDirectory,
        },
      });
    } finally {
      console.error = originalError;
      await harness.unmount();
    }
  });
});
