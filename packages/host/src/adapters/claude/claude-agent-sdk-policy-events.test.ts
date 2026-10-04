import { expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

const createPolicyEventHarness = (requestedMode?: string) => {
  const session = createEventTestSession();
  if (requestedMode) session.requestedPermissionMode = requestedMode;
  const events: AgentEvent[] = [];
  return {
    events,
    handle: (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
      handleClaudeSdkMessage({
        session,
        message,
        timestamp: "2026-10-03T10:00:00Z",
        modelSelection: (model) => ({
          providerId: "claude",
          modelId: model,
          runtimeKind: "claude",
        }),
        emit: (event) => events.push(event),
      }),
  };
};

test.each(["auto", "acceptEdits"])(
  "warns only when Claude reports a mode other than requested %s",
  (requestedMode) => {
    const { events, handle } = createPolicyEventHarness(requestedMode);
    handle(claudeSdkMessageFixture({ type: "system", subtype: "init", permissionMode: "default" }));
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_policy_notice",
        externalSessionId: "session-1",
        messageId: expect.any(String),
        message: expect.stringContaining(requestedMode),
      }),
    ]);
    expect(events[0]).toHaveProperty("message", expect.stringContaining("default"));
    const messageId = events.find((event) => event.type === "session_policy_notice")?.messageId;
    handle(claudeSdkMessageFixture({ type: "system", subtype: "status" }));
    for (const permissionMode of ["default", requestedMode, requestedMode] as const) {
      handle(claudeSdkMessageFixture({ type: "system", subtype: "status", permissionMode }));
    }
    expect(events).toHaveLength(1);
    handle(
      claudeSdkMessageFixture({ type: "system", subtype: "status", permissionMode: "default" }),
    );
    handle(claudeSdkMessageFixture({ type: "system", subtype: "init", permissionMode: "default" }));
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "session_policy_notice",
      externalSessionId: "session-1",
      messageId,
      message: expect.stringContaining("default"),
    });
  },
);

test.each([undefined, "auto", "default", "acceptEdits"])(
  "keeps inherited or matching %s mode metadata silent",
  (requestedMode) => {
    const { events, handle } = createPolicyEventHarness(requestedMode);
    const mode = requestedMode ?? "auto";
    for (const subtype of ["init", "init", "status"] as const) {
      handle(claudeSdkMessageFixture({ type: "system", subtype, permissionMode: mode }));
    }
    expect(events).toEqual([]);
  },
);
