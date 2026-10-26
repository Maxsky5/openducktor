import "../test-support/dom-environment";
import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createAgentSessionFixture } from "../test-support/shared-test-fixtures";
import { createAgentSessionsStore } from "./agent-sessions-store";
import { AgentSessionsContext } from "./session-contexts";
import { useAgentSessionSummaries } from "./session-store-hooks";

test("renders the readers of task session summaries only when those summaries change", () => {
  const store = createAgentSessionsStore("/repo");
  const build = createAgentSessionFixture({
    externalSessionId: "build",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    status: "idle",
  });
  const chat = createAgentSessionFixture({
    externalSessionId: "chat",
    sessionAssociation: { kind: "repository" },
    status: "idle",
  });
  store.replaceSession(build);
  store.replaceSession(chat);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AgentSessionsContext.Provider value={store}>{children}</AgentSessionsContext.Provider>
  );
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
