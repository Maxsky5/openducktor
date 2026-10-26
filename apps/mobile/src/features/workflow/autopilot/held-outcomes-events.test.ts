import { describe, expect, test } from "bun:test";
import type { AutopilotOutcome } from "@openducktor/contracts";
import {
  connectionReconnectedEvent,
  connectionStreamWarningEvent,
} from "@openducktor/frontend-core/recovery/connection-control-events";
import { changesHeldOutcomes } from "./held-outcomes-events";

const skipped = (workspaceId: string): AutopilotOutcome => ({
  kind: "skipped",
  outcomeId: "outcome-1",
  workspaceId,
  repoPath: "/repo",
  task: { id: "TASK-1", title: "Export" },
  eventId: "taskRejectedByQa",
  actionId: "startReviewQaFeedbacks",
  occurredAt: "2026-10-10T00:00:00.000Z",
  reason: "The Builder session runs.",
});

describe("changesHeldOutcomes", () => {
  test("reads again after an outcome in the workspace only", () => {
    const event = { type: "autopilot_outcome", outcome: skipped("ws-1") } as const;

    expect(changesHeldOutcomes(event, "ws-1")).toBe(true);
    expect(changesHeldOutcomes(event, "ws-2")).toBe(false);
  });

  test("reads again when the host failure starts or stops, in every workspace", () => {
    expect(
      changesHeldOutcomes({ type: "autopilot_failure", failure: "Fix the rules." }, "ws-2"),
    ).toBe(true);
    expect(changesHeldOutcomes({ type: "autopilot_failure", failure: null }, "ws-1")).toBe(true);
  });

  test("reads again after a reconnect only when the replay missed events", () => {
    expect(
      changesHeldOutcomes(
        connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }),
        "ws-1",
      ),
    ).toBe(true);
    expect(
      changesHeldOutcomes(
        connectionReconnectedEvent(false, { hostChanged: false, missedEventNames: [] }),
        "ws-1",
      ),
    ).toBe(false);
    expect(changesHeldOutcomes(connectionStreamWarningEvent("Slow stream."), "ws-1")).toBe(false);
  });

  test("ignores the settings save event", () => {
    expect(changesHeldOutcomes({ type: "autopilot_settings_saved" }, "ws-1")).toBe(false);
  });
});
