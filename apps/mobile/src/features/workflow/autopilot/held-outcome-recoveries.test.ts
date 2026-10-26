import { describe, expect, test } from "bun:test";
import type { AutopilotFailedOutcome } from "@openducktor/frontend-core/autopilot/autopilot-recovery";
import { buildAutopilotHeldOutcomeRows } from "@openducktor/frontend-core/autopilot/autopilot-outcome-copy";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createHeldOutcomeRecoveries, heldOutcomeRecoveriesOf } from "./held-outcome-recoveries";

const failed = ({
  outcomeId = "outcome-1",
  taskId = "TASK-1",
  recoverable = true,
}: { outcomeId?: string; taskId?: string; recoverable?: boolean } = {}): AutopilotFailedOutcome => {
  const outcome: AutopilotFailedOutcome = {
    kind: "failed",
    outcomeId,
    workspaceId: "ws-1",
    repoPath: "/repo",
    task: { id: taskId, title: "Export" },
    eventId: "taskRejectedByQa",
    actionId: "startReviewQaFeedbacks",
    occurredAt: "2026-10-10T00:00:00.000Z",
    message: "The first message did not reach the session.",
  };
  if (recoverable) {
    outcome.launch = {
      workspaceId: "ws-1",
      repoPath: "/repo",
      taskId,
      role: "build",
      status: "failed",
      session: {
        externalSessionId: "s-1",
        runtimeKind: "opencode",
        workingDirectory: "/wt/task-1",
        startedAt: "2026-10-10T00:00:00.000Z",
        status: "idle",
      },
      unsentInstruction: [{ kind: "text", text: "Start the build." }],
    };
  }
  return outcome;
};

describe("held outcome recoveries", () => {
  test("keeps one recovery for each failed launch with an unsent first message", () => {
    const recoveries = createHeldOutcomeRecoveries();
    const outcome = failed();
    const first = recoveries.recoveryOf(outcome);
    expect(first?.session.externalSessionId).toBe("s-1");
    expect(recoveries.recoveryOf(outcome)).toBe(first);
    expect(
      recoveries.recoveryOf(failed({ outcomeId: "outcome-2", recoverable: false })),
    ).toBeNull();
  });

  test("keeps the recoveries of a connection apart from other connections", () => {
    const connection = createTestClientConnection({});
    expect(heldOutcomeRecoveriesOf(connection)).toBe(heldOutcomeRecoveriesOf(connection));
    expect(heldOutcomeRecoveriesOf(createTestClientConnection({}))).not.toBe(
      heldOutcomeRecoveriesOf(connection),
    );
  });

  test("lists the held rows of one task with Retry message only when recovery is possible", () => {
    const rows = buildAutopilotHeldOutcomeRows(
      {
        failure: null,
        outcomes: [
          failed(),
          failed({ outcomeId: "outcome-2", recoverable: false }),
          failed({ outcomeId: "outcome-3", taskId: "TASK-2" }),
        ],
      },
      "TASK-1",
    );
    expect(rows.map((row) => [row.outcome.outcomeId, row.canRetry])).toEqual([
      ["outcome-1", true],
      ["outcome-2", false],
    ]);
  });
});
