import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren } from "react";
import type { RuntimeReadinessState } from "@/lib/runtime-readiness";
import {
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
} from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { AgentSessionHistoryLoadContextValue } from "@/types/state-slices";
import { useSelectedSessionHistoryLoad } from "./use-selected-session-history-load";

const identity = {
  externalSessionId: "session-1",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo/worktree",
};
const props = (
  session: AgentSessionState | null,
  runtimeReadinessState: RuntimeReadinessState = "ready",
) => ({ session, runtimeReadinessState });
const createHarness = (
  session: AgentSessionState | null,
  loadAgentSessionHistory: AgentSessionHistoryLoadContextValue["loadAgentSessionHistory"],
  readiness: { current: AgentSessionReadModelLoadState } = {
    current: { kind: "ready", workspaceRepoPath: "/repo" },
  },
  runtimeReadinessState: RuntimeReadinessState = "ready",
) =>
  createHookHarness(useSelectedSessionHistoryLoad, props(session, runtimeReadinessState), {
    wrapper: ({ children }: PropsWithChildren) => (
      <AgentSessionReadModelStateContext.Provider
        value={{
          sessionReadModelLoadState: readiness.current,
          workspaceSessionRecordsError: null,
          reloadSessionReadModel: () => {},
          getSessionFault: () => null,
        }}
      >
        <AgentSessionHistoryLoadContext.Provider value={{ loadAgentSessionHistory }}>
          {children}
        </AgentSessionHistoryLoadContext.Provider>
      </AgentSessionReadModelStateContext.Provider>
    ),
  });

describe("selected session history", () => {
  test.each(["claude", "codex", "opencode"] as const)(
    "%s navigation keeps a current transcript",
    async (runtimeKind) => {
      const load = mock(async () => null);
      const current = createAgentSessionFixture({
        ...identity,
        runtimeKind,
        historyLoadState: "loaded",
      });
      const harness = createHarness(current, load);
      try {
        await harness.mount();
        await harness.update(props(createAgentSessionFixture({ historyLoadState: "loaded" })));
        await harness.update(props(null));
        await harness.update(props({ ...current, status: "running" }));
        await harness.update(props({ ...current, status: "idle" }));
        expect(load).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );

  test("loads a baseline once and does not refresh it after completion", async () => {
    const load = mock(async () => null);
    const current = createAgentSessionFixture({ ...identity, historyLoadState: "not_requested" });
    const harness = createHarness(current, load);
    try {
      await harness.mount();
      await harness.update(props({ ...current, title: "New title", status: "running" }));
      await harness.update(props({ ...current, historyLoadState: "loading" }));
      await harness.update(props({ ...current, historyLoadState: "loaded" }));
      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith(identity);
    } finally {
      await harness.unmount();
    }
  });

  test("waits for runtime and live observation readiness", async () => {
    const load = mock(async () => null);
    const current = createAgentSessionFixture({ ...identity, historyLoadState: "not_requested" });
    let observerReady = false;
    const readiness = {
      get current(): AgentSessionReadModelLoadState {
        return { kind: observerReady ? "ready" : "loading", workspaceRepoPath: "/repo" };
      },
    };
    const harness = createHarness(current, load, readiness, "checking");
    try {
      await harness.mount();
      await harness.update(props(current));
      expect(load).not.toHaveBeenCalled();
      observerReady = true;
      await harness.update(props(current));
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes the same selected session after each coverage gap", async () => {
    const load = mock(async () => null);
    const current = createAgentSessionFixture({ ...identity, historyLoadState: "loaded" });
    const harness = createHarness(current, load);
    try {
      await harness.mount();
      for (let gap = 0; gap < 2; gap += 1) {
        await harness.update(props({ ...current, historyLoadState: "stale" }));
        await harness.update(props({ ...current, historyLoadState: "refreshing" }));
        await harness.update(props({ ...current, historyLoadState: "loaded" }));
      }
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });

  test("does not retry a failed refresh in a render loop", async () => {
    const load = mock(async () => null);
    const current = createAgentSessionFixture({ ...identity, historyLoadState: "stale" });
    const harness = createHarness(current, load);
    try {
      await harness.mount();
      await harness.update(props({ ...current, historyLoadState: "refreshing" }));
      await harness.update(
        props({
          ...current,
          historyLoadFailure: {
            code: "request_failed",
            summary: "History unavailable",
            detail: "Offline",
          },
        }),
      );
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("allows a failed baseline to retry on a new visit", async () => {
    const load = mock(async () => null);
    const current = createAgentSessionFixture({ ...identity, historyLoadState: "not_requested" });
    const harness = createHarness(current, load);
    try {
      await harness.mount();
      await harness.update(props({ ...current, historyLoadState: "loading" }));
      const failed = { ...current, historyLoadState: "failed" as const };
      await harness.update(props(failed));
      expect(load).toHaveBeenCalledTimes(1);
      await harness.update(props(null));
      await harness.update(props(failed));
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });

  test.each(["loaded", "stale"] as const)(
    "does not read a %s fresh Codex session before its first send",
    async (historyLoadState) => {
      const load = mock(async () => null);
      const current = createAgentSessionFixture({
        ...identity,
        runtimeKind: "codex",
        status: "starting",
        historyLoadState,
        messages: [],
      });
      const harness = createHarness(current, load);
      try {
        await harness.mount();
        await harness.update(
          props({ ...current, status: "running", pendingUserMessageStartedAt: 123 }),
        );
        expect(load).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );
});
