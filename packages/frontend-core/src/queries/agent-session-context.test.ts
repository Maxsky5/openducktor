import { expect, mock, test } from "bun:test";
import type { AgentSessionLiveLoadContextInput } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { loadAgentSessionContextFromQuery } from "./agent-session-context";

test("shares concurrent reads for equivalent paths and keeps session scopes separate", async () => {
  const client = new QueryClient();
  const session = {
    repoPath: "/repo/",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree/",
    externalSessionId: "session-1",
  } satisfies AgentSessionLiveLoadContextInput;
  const loadContext = mock(async ({ sessionScope }: AgentSessionLiveLoadContextInput) => ({
    totalTokens: sessionScope?.kind === "workflow" ? 300 : sessionScope ? 200 : 100,
  }));
  const read = (input: AgentSessionLiveLoadContextInput) =>
    loadAgentSessionContextFromQuery(client, input, loadContext);

  const results = await Promise.all([
    read(session),
    read({ ...session, repoPath: "/repo", workingDirectory: "/repo/worktree" }),
    read({ ...session, sessionScope: { kind: "repository", workspaceId: "workspace-1" } }),
    read({
      ...session,
      sessionScope: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "task-1",
        role: "build",
      },
    }),
  ]);

  expect(results.map((usage) => usage?.totalTokens)).toEqual([100, 100, 200, 300]);
  expect(loadContext).toHaveBeenCalledTimes(3);
});
