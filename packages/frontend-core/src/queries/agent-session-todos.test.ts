import { describe, expect, test } from "bun:test";
import type { AgentSessionTodoItem, PolicyBoundSessionRef } from "@openducktor/core";
import { QueryClient, skipToken } from "@tanstack/react-query";
import { SKIPPED_QUERY_KEY_SEGMENT } from "./skipped-query";
import {
  agentSessionTodosQueryKeys,
  sessionTodosQueryOptions,
  skippedSessionTodosQueryOptions,
  updateSessionTodosQueryData,
} from "./agent-session-todos";

const sessionRefFixture: PolicyBoundSessionRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  runtimePolicy: { kind: "opencode" },
};

const todoFixture: AgentSessionTodoItem = {
  id: "todo-1",
  content: "Wire the runtime data query",
  status: "pending",
  priority: "medium",
};

describe("agent session todos queries", () => {
  test("an event prevents an older pending read from replacing its todos", async () => {
    const client = new QueryClient();
    const read = Promise.withResolvers<AgentSessionTodoItem[]>();
    const pending = client
      .fetchQuery(sessionTodosQueryOptions(sessionRefFixture, () => read.promise))
      .catch(() => undefined);
    updateSessionTodosQueryData(client, sessionRefFixture, () => [
      { ...todoFixture, status: "completed" },
    ]);
    read.resolve([todoFixture]);
    await pending;
    expect(
      client.getQueryData<AgentSessionTodoItem[]>(
        agentSessionTodosQueryKeys.todos(sessionRefFixture),
      ),
    ).toEqual([{ ...todoFixture, status: "completed" }]);
  });
  test("keeps the skipped todos read off live session keys", () => {
    const skippedOptions = skippedSessionTodosQueryOptions();
    const skippedKey = Array.from(skippedOptions.queryKey);
    const liveKey = Array.from(agentSessionTodosQueryKeys.todos(sessionRefFixture));

    expect(skippedOptions.queryFn).toBe(skipToken);
    expect(skippedKey).toEqual(["agent-session-todos", SKIPPED_QUERY_KEY_SEGMENT]);
    expect(liveKey[1]).not.toBe(SKIPPED_QUERY_KEY_SEGMENT);
  });

  test("loads each task scope separately and applies transcript updates to every cached scope", async () => {
    const queryClient = new QueryClient();
    const refs: PolicyBoundSessionRef[] = [
      sessionRefFixture,
      { ...sessionRefFixture, sessionScope: { kind: "repository", workspaceId: "workspace-1" } },
      {
        ...sessionRefFixture,
        sessionScope: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "build",
        },
      },
    ];
    const readTodos = async (ref: PolicyBoundSessionRef) => [
      { ...todoFixture, content: ref.sessionScope?.kind ?? "unscoped" },
    ];
    const reads = await Promise.all(
      refs.map((ref) => queryClient.fetchQuery(sessionTodosQueryOptions(ref, readTodos))),
    );
    expect(reads.map((todos) => todos[0]?.content)).toEqual(["unscoped", "repository", "workflow"]);

    const otherSession = { ...sessionRefFixture, externalSessionId: "session-2" };
    await queryClient.fetchQuery(sessionTodosQueryOptions(otherSession, readTodos));
    updateSessionTodosQueryData(queryClient, sessionRefFixture, (current) =>
      current.map((todo) => ({ ...todo, status: "completed" })),
    );

    const cachedTodos = (ref: PolicyBoundSessionRef) =>
      queryClient.getQueryData<AgentSessionTodoItem[]>(agentSessionTodosQueryKeys.todos(ref));
    expect(refs.map((ref) => cachedTodos(ref)?.[0]?.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(cachedTodos(otherSession)?.[0]?.status).toBe("pending");
  });
});
