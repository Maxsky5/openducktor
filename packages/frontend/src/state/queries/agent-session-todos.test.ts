import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionTodoItem, PolicyBoundSessionRef } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import {
  agentSessionTodosQueryKeys,
  sessionTodosQueryOptions,
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
  test("keeps absent, repository, and workflow session scopes distinct", () => {
    expect(agentSessionTodosQueryKeys.todos(sessionRefFixture)).toEqual([
      "agent-session-todos",
      "/repo",
      "opencode",
      "/repo/worktree",
      "session-1",
      null,
      null,
      null,
    ]);
    expect(
      agentSessionTodosQueryKeys.todos({
        ...sessionRefFixture,
        sessionScope: { kind: "repository" },
      }),
    ).toEqual([
      "agent-session-todos",
      "/repo",
      "opencode",
      "/repo/worktree",
      "session-1",
      "repository",
      null,
      null,
    ]);
    expect(
      agentSessionTodosQueryKeys.todos({
        ...sessionRefFixture,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    ).toEqual([
      "agent-session-todos",
      "/repo",
      "opencode",
      "/repo/worktree",
      "session-1",
      "workflow",
      "task-1",
      "build",
    ]);
  });

  test("loads todos only for a concrete session ref", async () => {
    const queryClient = new QueryClient();
    const readSessionTodos = mock(async () => [todoFixture]);

    const todos = await queryClient.fetchQuery(
      sessionTodosQueryOptions(sessionRefFixture, readSessionTodos),
    );

    expect(todos).toEqual([todoFixture]);
    expect(readSessionTodos).toHaveBeenCalledWith(sessionRefFixture);
  });

  test("applies transcript updates to every cached scope for the session", () => {
    const queryClient = new QueryClient();
    const refs: PolicyBoundSessionRef[] = [
      sessionRefFixture,
      { ...sessionRefFixture, sessionScope: { kind: "repository" } },
      {
        ...sessionRefFixture,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
    ];
    for (const ref of refs) {
      queryClient.setQueryData(agentSessionTodosQueryKeys.todos(ref), [todoFixture]);
    }

    updateSessionTodosQueryData(queryClient, sessionRefFixture, (current) =>
      current.map((todo) => ({ ...todo, status: "completed" })),
    );

    for (const ref of refs) {
      expect(
        queryClient.getQueryData<AgentSessionTodoItem[]>(agentSessionTodosQueryKeys.todos(ref)),
      ).toEqual([{ ...todoFixture, status: "completed" }]);
    }
  });
});
