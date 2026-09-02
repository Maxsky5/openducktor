import { expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskWorkflowRootReader } from "./task-workflow-root-reader";

const session = (externalSessionId: string, workingDirectory: string): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  startedAt: "2026-09-02T10:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory,
  selectedModel: null,
});

test("reads unique workflow roots from every stored task session", async () => {
  const first = session("session-1", "/repo/worktree-1");
  const second = session("session-2", "/repo/worktree-2");
  const store: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks"> = {
    // SAFETY: The root reader uses task IDs only; this test omits unrelated task-card fields.
    listTasks: () => Effect.succeed([{ id: "task-1" }, { id: "task-2" }] as TaskCard[]),
    listAgentSessionsForTasks: () =>
      Effect.succeed([
        { taskId: "task-1", agentSessions: [first] },
        { taskId: "task-2", agentSessions: [first, second] },
      ]),
  };

  const roots = await Effect.runPromise(createTaskWorkflowRootReader(store)("/repo"));

  expect(roots).toEqual([
    {
      repoPath: "/repo",
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree-1",
    },
    {
      repoPath: "/repo",
      externalSessionId: "session-2",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree-2",
    },
  ]);
});
