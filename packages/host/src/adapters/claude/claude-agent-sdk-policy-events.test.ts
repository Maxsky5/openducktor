import { expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

test("reports the native applied mode after init and later changes, without claiming activation early", () => {
  const session = createEventTestSession();
  session.requestedPermissionMode = "auto";
  const events: AgentEvent[] = [];
  const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
    handleClaudeSdkMessage({
      session,
      message,
      timestamp: "2026-10-03T10:00:00Z",
      modelSelection: (model) => ({ providerId: "claude", modelId: model, runtimeKind: "claude" }),
      emit: (event) => events.push(event),
    });
  expect(session.appliedPermissionMode).toBeUndefined();
  handle(claudeSdkMessageFixture({ type: "system", subtype: "init", permissionMode: "default" }));
  expect(events).toEqual([
    expect.objectContaining({
      type: "session_policy_notice",
      message: expect.stringContaining("classifier review is not active"),
    }),
  ]);
  expect(session.appliedPermissionMode).toBe("default");
  handle(claudeSdkMessageFixture({ type: "system", subtype: "status", permissionMode: "auto" }));
  expect(events.at(-1)).toMatchObject({
    type: "session_policy_notice",
    message: "Claude reports automatic approvals are active.",
  });
  expect(session.appliedPermissionMode).toBe("auto");
  handle(claudeSdkMessageFixture({ type: "system", subtype: "status", permissionMode: "auto" }));
  handle(claudeSdkMessageFixture({ type: "system", subtype: "status" }));
  expect(events).toHaveLength(2);
  expect(events[0]).toHaveProperty("messageId", "claude-permission-mode:session-1");
  expect(events[1]).toHaveProperty("messageId", "claude-permission-mode:session-1");
});

test("reports native permission mode on resume without an OpenDucktor mode override", () => {
  const session = createEventTestSession();
  const events: AgentEvent[] = [];
  handleClaudeSdkMessage({
    session,
    message: claudeSdkMessageFixture({
      type: "system",
      subtype: "init",
      permissionMode: "dontAsk",
    }),
    timestamp: "2026-10-03T10:00:00Z",
    modelSelection: (model) => ({ providerId: "claude", modelId: model, runtimeKind: "claude" }),
    emit: (event) => events.push(event),
  });
  expect(events).toEqual([
    expect.objectContaining({
      type: "session_policy_notice",
      messageId: "claude-permission-mode:session-1",
      message: "Claude reports permission mode 'dontAsk'.",
    }),
  ]);
});
