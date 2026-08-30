import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage session state and catalog events", () => {
  test("ignores duplicate SDK idle transitions when local session activity is already idle", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events).toEqual([]);
  });

  test("ignores replayed running state when a resumed session has no local turn", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "running",
        uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.sdkState).toBeUndefined();
    expect(events).toEqual([]);
  });

  test("emits busy status for running SDK state during an active local turn", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.activeSdkUserTurnCount = 1;

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "running",
        uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("running");
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_status",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("ignores SDK idle transitions while OpenDucktor has queued user turns", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.pendingUserTurnCount = 1;

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("running");
    expect(events).toEqual([]);
  });

  test("keeps requires_action running while pending input registration catches up", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "requires_action",
        uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.sdkState).toBe("requires_action");
    expect(events).toEqual([]);
  });

  test("keeps the turn active when Claude requires pending approval input", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.pendingApprovals.set("approval-1", {
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        requestId: "approval-1",
        requestType: "runtime_tool",
        title: "Approve tool",
        tool: { name: "TestTool", input: {} },
        mutation: "unknown",
      },
      resolve: () => {},
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "requires_action",
        uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("running");
    expect(events).toEqual([]);
  });

  test("emits Claude slash command cache replacement events", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "commands_changed",
        commands: [
          {
            name: "review",
            description: "Review the current work",
            argumentHint: "[focus]",
          },
        ],
        uuid: "88b86b46-2fc8-4031-88d5-fb068b53f034",
        session_id: "session-1",
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "runtime_slash_commands_changed",
        catalog: {
          commands: [
            {
              id: "review",
              trigger: "review",
              title: "review",
              description: "Review the current work",
              source: "command",
              hints: ["[focus]"],
            },
          ],
        },
      }),
    ]);
  });
});
