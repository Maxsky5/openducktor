import { describe, expect, mock, test } from "bun:test";
import type { RunSessionStartWorkflow } from "../../sessions/start/session-start-orchestration";
import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import { createFeedbackFake } from "../../test-support/feedback-fake";
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
  feedback: createFeedbackFake(),
  onPostStartMessageFailure: mock((_result: SessionStartWorkflowResult) => {}),
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
    expect(input.feedback.shown).toEqual([]);
  });

  test("keeps a background start out of view", async () => {
    const input = startInput(runnerReturning({ ...session, postStartActionError: null }));

    await startKanbanSessionFlow({ ...input, startInBackground: true });

    expect(input.openStartedSession).not.toHaveBeenCalled();
  });

  test("reports a first message failure that has no retry", async () => {
    const input = startInput(
      runnerReturning({ ...session, postStartActionError: new Error("Runtime rejected it.") }),
    );

    await startKanbanSessionFlow(input);

    expect(input.feedback.shownOf("error")).toEqual([
      {
        kind: "error",
        message: "Session started, but the first message failed for TASK-1.",
        options: { description: "Runtime rejected it." },
      },
    ]);
  });

  test("leaves a retryable first message to the platform retry", async () => {
    const runSessionStartWorkflow = runnerReturning({
      ...session,
      postStartActionError: new Error("Runtime rejected it."),
      retryPostStartMessage: async () => null,
    });
    const input = startInput(runSessionStartWorkflow);

    await startKanbanSessionFlow(input);

    const runInput = runSessionStartWorkflow.mock.calls[0]?.[0];
    expect(runInput?.onPostStartMessageFailure).toBe(input.onPostStartMessageFailure);
    expect(input.feedback.shown).toEqual([]);
  });
});
