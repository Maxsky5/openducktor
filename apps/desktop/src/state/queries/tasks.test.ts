import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, RunSummary, TaskCard } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { taskQueryKeys, upsertAgentSessionInRepoTaskData } from "./tasks";

const DONE_VISIBLE_DAYS = 1;

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
  status: "in_progress",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-22T12:00:00.000Z",
  createdAt: "2026-03-22T12:00:00.000Z",
};

const sessionFixture: AgentSessionRecord = {
  sessionId: "session-1",
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

describe("tasks query cache helpers", () => {
  test("upsertAgentSessionInRepoTaskData inserts a persisted session into the repo task cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
      tasks: [taskFixture],
      runs: [] satisfies RunSummary[],
    });
    queryClient.setQueryData(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS), [
      taskFixture,
    ] satisfies TaskCard[]);

    upsertAgentSessionInRepoTaskData(queryClient, "/repo", "task-1", sessionFixture);

    const repoTaskData = queryClient.getQueryData<{
      tasks: TaskCard[];
      runs: RunSummary[];
    }>(taskQueryKeys.repoData("/repo"));
    const kanbanTasks = queryClient.getQueryData<TaskCard[]>(
      taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS),
    );

    expect(repoTaskData?.tasks[0]?.agentSessions).toEqual([sessionFixture]);
    expect(kanbanTasks?.[0]?.agentSessions).toEqual([sessionFixture]);
  });

  test("upsertAgentSessionInRepoTaskData replaces the existing persisted session for the same id", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
      tasks: [
        {
          ...taskFixture,
          agentSessions: [sessionFixture],
        },
      ],
      runs: [] satisfies RunSummary[],
    });
    queryClient.setQueryData(taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS), [
      {
        ...taskFixture,
        agentSessions: [sessionFixture],
      },
    ] satisfies TaskCard[]);

    const updatedSession: AgentSessionRecord = {
      ...sessionFixture,
      workingDirectory: "/tmp/repo/worktree-2",
    };

    upsertAgentSessionInRepoTaskData(queryClient, "/repo", "task-1", updatedSession);

    const repoTaskData = queryClient.getQueryData<{
      tasks: TaskCard[];
      runs: RunSummary[];
    }>(taskQueryKeys.repoData("/repo"));
    const kanbanTasks = queryClient.getQueryData<TaskCard[]>(
      taskQueryKeys.kanbanData("/repo", DONE_VISIBLE_DAYS),
    );

    expect(repoTaskData?.tasks[0]?.agentSessions).toEqual([updatedSession]);
    expect(kanbanTasks?.[0]?.agentSessions).toEqual([updatedSession]);
  });
});
