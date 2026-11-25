import "../test-support/dom-environment";
import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentSessionsStore } from "./agent-sessions-store";
import { createAgentSessionFixture } from "../test-support/shared-test-fixtures";
import { createAgentSessionsStore } from "./agent-sessions-store";
import type { AgentSessionReadModelLoadState } from "../types/agent-session-read-model";
import { AgentSessionReadModelStateContext, AgentSessionsContext } from "./session-contexts";
import { useAgentSessionSummaries } from "./session-store-hooks";

const READY: AgentSessionReadModelLoadState = { kind: "ready", workspaceRepoPath: "/repo" };

const createWrapper =
  (store: AgentSessionsStore, loadState: () => AgentSessionReadModelLoadState) =>
  ({ children }: { children: ReactNode }) => (
    <AgentSessionReadModelStateContext.Provider
      value={{
        sessionReadModelLoadState: loadState(),
        workspaceSessionRecordsError: null,
        reloadSessionReadModel: () => {},
        getSessionFault: () => null,
      }}
    >
      <AgentSessionsContext.Provider value={store}>{children}</AgentSessionsContext.Provider>
    </AgentSessionReadModelStateContext.Provider>
  );

test("renders the readers of task session summaries only when those summaries change", () => {
  const store = createAgentSessionsStore("/repo");
  const build = createAgentSessionFixture({
    externalSessionId: "build",
    sessionAssociation: {
      kind: "workflow",
      workspaceId: "workspace-1",
      taskId: "task-1",
      role: "build",
    },
    status: "idle",
  });
  const chat = createAgentSessionFixture({
    externalSessionId: "chat",
    sessionAssociation: { kind: "repository", workspaceId: "workspace-1" },
    status: "idle",
  });
  store.replaceSession(build);
  store.replaceSession(chat);
  const wrapper = createWrapper(store, () => READY);
  let renders = 0;
  const { result } = renderHook(
    () => {
      renders += 1;
      return useAgentSessionSummaries();
    },
    { wrapper },
  );
  const summaries = result.current;
  expect(summaries.map((summary) => summary.externalSessionId)).toEqual(["build"]);

  act(() => store.replaceSession({ ...chat, status: "running" }));
  expect(store.getActivitySnapshot().repositorySessions).toMatchObject([
    { externalSessionId: "chat", activityState: "running" },
  ]);
  expect(renders).toBe(1);
  expect(result.current).toBe(summaries);

  act(() => store.replaceSession({ ...build, status: "running" }));
  expect(renders).toBe(2);
  expect(result.current).toMatchObject([{ externalSessionId: "build", activityState: "running" }]);
});

test("keeps a running summary without its Background style while the live state is unknown", () => {
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(
    createAgentSessionFixture({
      externalSessionId: "build",
      sessionAssociation: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "task-1",
        role: "build",
      },
      status: "running",
      foregroundTurnActive: false,
      livePresence: "present",
      backgroundTasks: [
        { taskId: "shell-1", kind: "command", title: "bun run dev", stop: { allowed: true } },
      ],
    }),
  );
  let loadState: AgentSessionReadModelLoadState = READY;
  const { result, rerender } = renderHook(() => useAgentSessionSummaries(), {
    wrapper: createWrapper(store, () => loadState),
  });
  expect(result.current).toMatchObject([{ activityState: "running", waitingOnBackground: true }]);

  loadState = {
    kind: "failed",
    workspaceRepoPath: "/repo",
    message: "Live stream ended",
    source: "live-stream",
    failureKind: "other",
  };
  rerender();
  expect(result.current).toMatchObject([{ activityState: "running", waitingOnBackground: false }]);

  // A retry loads again, but the live state stays unknown until a new snapshot confirms it.
  loadState = {
    kind: "loading",
    workspaceRepoPath: "/repo",
    liveStreamFailure: "Live stream ended",
  };
  rerender();
  expect(result.current).toMatchObject([{ activityState: "running", waitingOnBackground: false }]);

  loadState = READY;
  rerender();
  expect(result.current).toMatchObject([{ activityState: "running", waitingOnBackground: true }]);
});
