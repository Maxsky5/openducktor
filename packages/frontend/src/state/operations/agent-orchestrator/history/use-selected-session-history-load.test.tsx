import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren, ReactElement } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { AgentSessionHistoryLoadContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: selectedSessionIdentity.externalSessionId,
  taskId: "task-1",
  role: "build",
  status: "idle",
  startedAt: "2026-06-12T08:00:00.000Z",
  runtimeKind: selectedSessionIdentity.runtimeKind,
  workingDirectory: selectedSessionIdentity.workingDirectory,
  historyLoadState: "not_requested",
  messages: createSessionMessagesState(selectedSessionIdentity.externalSessionId),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
});

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
  loadSessionHistory: (session: AgentSessionIdentity) => Promise<void>,
) => {
  return function HistoryLoadWrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <AgentSessionHistoryLoadContext.Provider value={{ loadSessionHistory }}>
        {children}
      </AgentSessionHistoryLoadContext.Provider>
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
