import { describe, expect, test } from "bun:test";
import type { AgentQueuedMessage } from "@openducktor/contracts";
import { BLOCKED_ON_INPUT_REASON } from "@openducktor/core";
import { DELIVERY_UNKNOWN_NOTE, buildQueueItemView, queueCardLabel } from "./queue-item-state";

const base = {
  submissionId: "submission-1",
  parts: [{ kind: "text" as const, text: "Also update the docs" }],
  queuedAt: "2026-10-19T10:00:00.000Z",
};

const entry = (
  state: Exclude<AgentQueuedMessage["state"], "editing"> = "queued",
): AgentQueuedMessage => ({ ...base, state });

const idleSteer = {
  steerBlockedReason: null,
  runningTurnModel: null,
  isSessionWorking: false,
  isWaitingInput: false,
};

const view = (
  message: AgentQueuedMessage,
  overrides: Partial<Parameters<typeof buildQueueItemView>[1]> = {},
) =>
  buildQueueItemView(message, {
    steerContext: idleSteer,
    actionRuns: false,
    commandsOpen: true,
    ...overrides,
  });

describe("buildQueueItemView", () => {
  test("offers Steer now, Edit, and Remove for a queued message", () => {
    expect(view(entry())).toMatchObject({
      preview: "Also update the docs",
      statusLabel: "Queued",
      note: null,
      canSteer: true,
      canEdit: true,
      canRemove: true,
    });
  });

  test("shows Delivery unknown and offers no resend or remove", () => {
    expect(view(entry("acceptance_unknown"))).toMatchObject({
      statusLabel: "Delivery unknown",
      note: DELIVERY_UNKNOWN_NOTE,
      canSteer: false,
      canEdit: false,
      canRemove: false,
    });
  });

  test("shows a message on its way without actions", () => {
    expect(view(entry("steering"))).toMatchObject({
      statusLabel: "Steering…",
      canSteer: false,
      canEdit: false,
      canRemove: false,
    });
  });

  test("closes Steer now with the reason while the session waits for input", () => {
    expect(view(entry(), { steerContext: { ...idleSteer, isWaitingInput: true } })).toMatchObject({
      canSteer: false,
      steerBlockedReason: BLOCKED_ON_INPUT_REASON,
      canEdit: true,
    });
  });

  test("closes every action while the action runs or the host is not connected", () => {
    expect(view(entry(), { actionRuns: true })).toMatchObject({
      canSteer: false,
      canEdit: false,
      canRemove: false,
    });
    expect(view(entry(), { commandsOpen: false })).toMatchObject({
      canSteer: false,
      canRemove: false,
    });
  });

  test("marks an edit and keeps the last delivery failure", () => {
    expect(
      view({
        ...base,
        state: "editing",
        editId: "edit-1",
        error: "The runtime refused the message.",
      }),
    ).toMatchObject({
      isEditing: true,
      statusLabel: "Editing",
      error: "The runtime refused the message.",
    });
  });
});

describe("queueCardLabel", () => {
  const failed = view({ ...entry(), error: "The runtime refused the message." });

  test("reads the last delivery failure on a closed and an open stack", () => {
    expect(queueCardLabel(failed, { spread: false, count: 2 })).toBe(
      "2 queued messages. Also update the docs. Failed: The runtime refused the message.",
    );
    expect(queueCardLabel(failed, { spread: true, count: 2 })).toBe(
      "Queued: Also update the docs. Failed: The runtime refused the message.",
    );
  });

  test("reads why a message with an unknown delivery offers no action", () => {
    expect(queueCardLabel(view(entry("acceptance_unknown")), { spread: true, count: 1 })).toBe(
      `Delivery unknown: Also update the docs. ${DELIVERY_UNKNOWN_NOTE}`,
    );
  });
});
