import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren, ReactElement } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { AgentSessionHistoryLoadContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionHistoryLoadContextValue } from "@/types/state-slices";
import { createSessionMessagesState } from "../support/messages";
import { useSelectedSessionHistoryLoad } from "./use-selected-session-history-load";

const selectedSessionIdentity: AgentSessionIdentity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

const createSession = (overrides: AgentSessionFixtureOverrides = {}): AgentSessionState => {
  return createAgentSessionFixture(
    {
      externalSessionId: selectedSessionIdentity.externalSessionId,
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

      status: "idle",
      runtimeStatusMessage: null,
      startedAt: "2026-06-12T08:00:00.000Z",
      runtimeKind: selectedSessionIdentity.runtimeKind,
      workingDirectory: selectedSessionIdentity.workingDirectory,
      historyLoadState: "not_requested",
    },
    overrides,
  );
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
  loadSelectedSessionBaselineHistory: AgentSessionHistoryLoadContextValue["loadSelectedSessionBaselineHistory"],
  revalidateAgentSessionHistory: AgentSessionHistoryLoadContextValue["revalidateAgentSessionHistory"],
) => {
  const historyLoadActions: AgentSessionHistoryLoadContextValue = {
    loadSelectedSessionBaselineHistory,
    revalidateAgentSessionHistory,
  };
  return function HistoryLoadWrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <AgentSessionHistoryLoadContext.Provider value={historyLoadActions}>
        {children}
      </AgentSessionHistoryLoadContext.Provider>
    );
  };
};

const createHistoryLoadHarness = (
  props: ReturnType<typeof createProps>,
  loadSelectedSessionBaselineHistory: AgentSessionHistoryLoadContextValue["loadSelectedSessionBaselineHistory"],
  revalidateAgentSessionHistory: AgentSessionHistoryLoadContextValue["revalidateAgentSessionHistory"] = mock(
    async () => null,
  ),
) =>
  createHookHarness(useSelectedSessionHistoryLoad, props, {
    wrapper: createHistoryLoadWrapper(
      loadSelectedSessionBaselineHistory,
      revalidateAgentSessionHistory,
    ),
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

  test("does not revalidate the history that a baseline load just delivered", async () => {
    const loadSessionHistory = mock(async () => null);
    const revalidateSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps(),
      loadSessionHistory,
      revalidateSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(
        createProps({
          session: createSession({ historyLoadState: "loaded" }),
        }),
      );

      expect(revalidateSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("does not revalidate the history that a baseline load delivered through loading", async () => {
    const loadSessionHistory = mock(async () => null);
    const revalidateSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps(),
      loadSessionHistory,
      revalidateSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(
        createProps({
          session: createSession({ historyLoadState: "loading" }),
        }),
      );
      await harness.update(
        createProps({
          session: createSession({ historyLoadState: "loaded" }),
        }),
      );

      expect(revalidateSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("revalidates a retained session after the selection clears and returns", async () => {
    const revalidateSessionHistory = mock(async () => null);
    const loadedSession = createSession({ historyLoadState: "loaded" });
    const harness = createHistoryLoadHarness(
      createProps({ session: loadedSession }),
      mock(async () => null),
      revalidateSessionHistory,
    );

    try {
      await harness.mount();

      expect(revalidateSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(createProps({ session: null }));
      await harness.update(createProps({ session: loadedSession }));

      expect(revalidateSessionHistory).toHaveBeenCalledTimes(2);
      expect(revalidateSessionHistory).toHaveBeenLastCalledWith(selectedSessionIdentity);
    } finally {
      await harness.unmount();
    }
  });

  test("requests a new baseline for a selected session whose baseline failed", async () => {
    const loadSessionHistory = mock(async () => null);
    const revalidateSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps({
        session: createSession({ historyLoadState: "failed" }),
      }),
      loadSessionHistory,
      revalidateSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledWith(selectedSessionIdentity);
      expect(revalidateSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("revalidates a loaded selected session once", async () => {
    const loadSessionHistory = mock(async () => null);
    const revalidateSessionHistory = mock(async () => null);
    const harness = createHistoryLoadHarness(
      createProps({
        session: createSession({ historyLoadState: "loaded" }),
      }),
      loadSessionHistory,
      revalidateSessionHistory,
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).not.toHaveBeenCalled();
      expect(revalidateSessionHistory).toHaveBeenCalledTimes(1);
      expect(revalidateSessionHistory).toHaveBeenCalledWith(selectedSessionIdentity);
    } finally {
      await harness.unmount();
    }
  });

  test("waits for the kickoff before revalidating a newly launched Codex session", async () => {
    const loadSessionHistory = mock(async () => null);
    const revalidateSessionHistory = mock(async () => null);
    const starting = createSession({
      runtimeKind: "codex",
      status: "starting",
      historyLoadState: "loaded",
      messages: createSessionMessagesState("session-1"),
    });
    const harness = createHistoryLoadHarness(
      createProps({ session: starting }),
      loadSessionHistory,
      revalidateSessionHistory,
    );

    try {
      await harness.mount();
      expect(loadSessionHistory).not.toHaveBeenCalled();
      expect(revalidateSessionHistory).not.toHaveBeenCalled();

      await harness.update(createProps({ session: { ...starting, status: "running" } }));
      expect(revalidateSessionHistory).toHaveBeenCalledTimes(1);
      expect(revalidateSessionHistory).toHaveBeenCalledWith({
        externalSessionId: "session-1",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("revalidates each selected session after the selection changes away and back", async () => {
    const revalidateSessionHistory = mock(async () => null);
    const firstSession = createSession({ historyLoadState: "loaded" });
    const secondSession = createSession({
      externalSessionId: "session-2",
      historyLoadState: "loaded",
    });
    const harness = createHistoryLoadHarness(
      createProps({ session: firstSession }),
      mock(async () => null),
      revalidateSessionHistory,
    );

    try {
      await harness.mount();

      expect(revalidateSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(createProps({ session: secondSession }));

      expect(revalidateSessionHistory).toHaveBeenCalledTimes(2);
      expect(revalidateSessionHistory).toHaveBeenLastCalledWith({
        externalSessionId: "session-2",
        runtimeKind: selectedSessionIdentity.runtimeKind,
        workingDirectory: selectedSessionIdentity.workingDirectory,
      });

      await harness.update(createProps({ session: firstSession }));

      expect(revalidateSessionHistory).toHaveBeenCalledTimes(3);
      expect(revalidateSessionHistory).toHaveBeenLastCalledWith(selectedSessionIdentity);
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

  test("loads baseline history after reload even when a live Codex message is visible", async () => {
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

  test("reports selected-session history load failures through the orchestrator side-effect runner", async () => {
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
