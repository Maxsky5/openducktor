import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRuntimeRef, AgentSessionTodoItem } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionTodosQueryKeys, sessionTodosQueryOptions } from "./agent-session-todos";

const sessionRefFixture: AgentSessionRuntimeRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  taskId: "task-1",
  role: "build",
};

const todoFixture: AgentSessionTodoItem = {
  id: "todo-1",
  content: "Wire the runtime data query",
  status: "pending",
  priority: "medium",
};

describe("agent session todos queries", () => {
  test("keys todos by the concrete runtime session identity", () => {
    expect(agentSessionTodosQueryKeys.todos(sessionRefFixture)).toEqual([
      "agent-session-todos",
      "/repo",
      "opencode",
      "/repo/worktree",
      "session-1",
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
});
