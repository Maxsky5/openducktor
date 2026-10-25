import { describe, expect, test } from "bun:test";
import type { AutopilotOutcome, WorkflowLaunchResult } from "@openducktor/contracts";
import { buildAutopilotHeldOutcomeRows } from "./autopilot-outcome-copy";
import type { AutopilotFailedOutcome } from "./autopilot-recovery";

const fields = {
  workspaceId: "alpha",
  repoPath: "/repos/alpha",
  task: { id: "task-1", title: "Task" },
  eventId: "taskRejectedByQa" as const,
  actionId: "startReviewQaFeedbacks" as const,
  occurredAt: "2026-10-10T00:00:00.000Z",
};
const session = {
  externalSessionId: "session-1",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktrees/task-1",
  startedAt: "2026-10-10T00:00:00.000Z",
  status: "idle" as const,
};
const launch = (patch: Partial<WorkflowLaunchResult> = {}): WorkflowLaunchResult => ({
  workspaceId: "alpha",
  repoPath: "/repos/alpha",
  taskId: "task-1",
  role: "build",
  status: "failed",
  ...patch,
});
const failed = (outcomeId: string, launchResult?: WorkflowLaunchResult): AutopilotFailedOutcome => {
  const outcome: AutopilotFailedOutcome = {
    ...fields,
    outcomeId,
    kind: "failed",
    message: "The model is not available.",
  };
  if (launchResult) outcome.launch = launchResult;
  return outcome;
};
const skipped = (outcomeId: string, taskId = "task-1"): AutopilotOutcome => ({
  ...fields,
  task: { id: taskId, title: "Task" },
  outcomeId,
  kind: "skipped",
  reason: "The task moved to Blocked / Needs Input before the action started.",
});

describe("buildAutopilotHeldOutcomeRows", () => {
  test("lists the failed and skipped outcomes of the task in host order", () => {
    const rows = buildAutopilotHeldOutcomeRows(
      {
        outcomes: [
          skipped("skipped-1"),
          skipped("skipped-other", "task-2"),
          failed("failed-plain"),
          failed("failed-session", launch({ session })),
          failed(
            "failed-recoverable",
            launch({ session, unsentInstruction: [{ kind: "text", text: "Kickoff" }] }),
          ),
        ],
        failure: null,
      },
      "task-1",
    );

    expect(
      rows.map(({ outcome, title, description, canRetry }) => ({
        id: outcome.outcomeId,
        title,
        description,
        canRetry,
      })),
    ).toEqual([
      {
        id: "skipped-1",
        title: "Autopilot skipped Start Review QA Feedbacks for task-1.",
        description: "The task moved to Blocked / Needs Input before the action started.",
        canRetry: false,
      },
      {
        id: "failed-plain",
        title: "Autopilot could not start Start Review QA Feedbacks for task-1.",
        description:
          "The model is not available. Fix the cause, then start the action from the task.",
        canRetry: false,
      },
      {
        id: "failed-session",
        title: "Autopilot could not start Start Review QA Feedbacks for task-1.",
        description:
          "The model is not available. Open the session to check it, then start the action again if needed.",
        canRetry: false,
      },
      {
        id: "failed-recoverable",
        title:
          "Autopilot started Start Review QA Feedbacks for task-1, but the first message failed.",
        description: "The model is not available.",
        canRetry: true,
      },
    ]);
  });

  test("lists no row for a task without held outcomes", () => {
    expect(
      buildAutopilotHeldOutcomeRows({ outcomes: [skipped("skipped-1")], failure: null }, "task-9"),
    ).toEqual([]);
  });
});
