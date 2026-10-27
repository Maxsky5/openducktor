import { describe, expect, mock, test } from "bun:test";
import type { RunSessionStartWorkflow } from "../../sessions/start/session-start-orchestration";
import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { startKanbanSessionFlow } from "./kanban-session-start-actions";

const session = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
};

const runnerReturning = (result: SessionStartWorkflowResult) =>
  mock<RunSessionStartWorkflow>(async () => result);

const startInput = (runSessionStartWorkflow: RunSessionStartWorkflow) => ({
  request: {
    taskId: "TASK-1",
    role: "build" as const,
    launchActionId: "build_implementation_start" as const,
    postStartAction: "kickoff" as const,
  },
  decision: {
    startMode: "fresh" as const,
    selectedModel: { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" },
  },
  startInBackground: false,
  tasks: [createTaskCardFixture({}, { id: "TASK-1" })],
  workspaceId: "workspace-1",
  runSessionStartWorkflow,
  openStartedSession: mock(() => {}),
});

describe("startKanbanSessionFlow", () => {
  test("opens the started session", async () => {
    const input = startInput(runnerReturning({ ...session, postStartActionError: null }));

    await startKanbanSessionFlow(input);

    expect(input.openStartedSession).toHaveBeenCalledWith(
      input.request,
      expect.objectContaining(session),
    );
  });

  test("keeps a background start out of view", async () => {
    const input = startInput(runnerReturning({ ...session, postStartActionError: null }));

    await startKanbanSessionFlow({ ...input, startInBackground: true });

    expect(input.openStartedSession).not.toHaveBeenCalled();
  });
});
