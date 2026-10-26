import { expect, mock, test } from "bun:test";
import type { AutopilotState } from "@openducktor/contracts";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { readAutopilotHeldOutcomes } from "./autopilot-held-outcomes";

const heldState = (): AutopilotState => ({
  outcomes: [
    {
      workspaceId: "alpha",
      repoPath: "/repos/alpha",
      task: { id: "task-1", title: "Task" },
      eventId: "taskRejectedByQa",
      actionId: "startReviewQaFeedbacks",
      occurredAt: "2026-10-10T00:00:00.000Z",
      outcomeId: "skipped-1",
      kind: "skipped",
      reason: "The task moved to Blocked / Needs Input before the action started.",
    },
  ],
  failure: null,
});

test("reports each workspace read on its own and lists the failed reads", async () => {
  const readFailure = new Error("Autopilot state is unavailable.");
  const autopilotStateRead = mock(async ({ workspaceId }: { workspaceId: string }) => {
    if (workspaceId === "beta") throw readFailure;
    return heldState();
  });
  const { queryClient } = createTestClientConnection({ client: { autopilotStateRead } });
  const read: Array<[string, AutopilotState]> = [];
  const failures: Array<[string, unknown]> = [];

  const causes = await readAutopilotHeldOutcomes(queryClient, ["alpha", "beta"], {
    onRead: (workspaceId, state) => read.push([workspaceId, state]),
    onReadFailure: (workspaceId, cause) => failures.push([workspaceId, cause]),
  });

  expect(read).toEqual([["alpha", heldState()]]);
  expect(failures).toEqual([["beta", readFailure]]);
  expect(causes).toEqual([readFailure]);
  expect(autopilotStateRead.mock.calls.map(([input]) => input.workspaceId)).toEqual([
    "alpha",
    "beta",
  ]);
});
