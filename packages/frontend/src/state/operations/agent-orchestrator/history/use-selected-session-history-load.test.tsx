import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren, ReactElement } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { createSessionMessagesState } from "../support/messages";
import {
  resolveSelectedSessionHistoryLoadTarget,
  useSelectedSessionHistoryLoad,
} from "./use-selected-session-history-load";

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
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>,
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
  loadSessionHistory: (session: AgentSessionIdentity) => Promise<void>,
) =>
  createHookHarness(useSelectedSessionHistoryLoad, props, {
    wrapper: createHistoryLoadWrapper(loadSessionHistory),
  });

describe("resolveSelectedSessionHistoryLoadTarget", () => {
  test("returns a target only for ready sessions with unrequested history", () => {
    expect(
      resolveSelectedSessionHistoryLoadTarget({
        session: createSession(),
        repoReadinessState: "ready",
      }),
    ).toEqual(selectedSessionIdentity);
    expect(
      resolveSelectedSessionHistoryLoadTarget({
        session: createSession({ historyLoadState: "loaded" }),
        repoReadinessState: "ready",
      }),
    ).toBeNull();
    expect(
      resolveSelectedSessionHistoryLoadTarget({
        session: createSession(),
        repoReadinessState: "checking",
      }),
    ).toBeNull();
    expect(
      resolveSelectedSessionHistoryLoadTarget({
        session: null,
        repoReadinessState: "ready",
      }),
    ).toBeNull();
  });

  test("does not request history when the selected session already has visible messages", () => {
    expect(
      resolveSelectedSessionHistoryLoadTarget({
        session: createSession({
          messages: createSessionMessagesState(selectedSessionIdentity.externalSessionId, [
            {
              id: "live-user-message",
              role: "user",
              content: "Continue after QA rejection",
              timestamp: "2026-06-12T08:00:01.000Z",
            },
          ]),
        }),
        repoReadinessState: "ready",
      }),
    ).toBeNull();
  });

  test("uses the selected session state as the history load identity", () => {
    expect(
      resolveSelectedSessionHistoryLoadTarget({
        session: createSession({
          externalSessionId: "session-from-state",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex-worktree",
        }),
        repoReadinessState: "ready",
      }),
    ).toEqual({
      externalSessionId: "session-from-state",
      runtimeKind: "codex",
      workingDirectory: "/repo/codex-worktree",
    });
  });
});

describe("useSelectedSessionHistoryLoad", () => {
  test("loads the selected session history when the runtime is ready", async () => {
    const loadSessionHistory = mock(async () => undefined);
    const harness = createHistoryLoadHarness(createProps(), loadSessionHistory);

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledWith(selectedSessionIdentity);
    } finally {
      await harness.unmount();
    }
  });

  test("waits for runtime readiness before loading selected session history", async () => {
    const loadSessionHistory = mock(async () => undefined);
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
    const loadSessionHistory = mock(async () => undefined);
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

  test("does not load when the selected session transcript is already visible", async () => {
    const loadSessionHistory = mock(async () => undefined);
    const harness = createHistoryLoadHarness(
      createProps({
        session: createSession({
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

      expect(loadSessionHistory).not.toHaveBeenCalled();
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
