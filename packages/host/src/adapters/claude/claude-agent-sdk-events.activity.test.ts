import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import {
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "./claude-agent-sdk-test-messages";
import {
  applyClaudeUserMessageSignal,
  waitForUserMessageAdmission,
} from "./claude-agent-sdk-user-message-admission";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";

describe("Claude native background activity", () => {
  const setup = () => {
    const session = createEventTestSession("idle");
    const events: AgentEvent[] = [];
    let ordinal = 0;
    const send = (message: Parameters<typeof claudeSdkMessageFixture>[0]) => {
      handleClaudeSdkMessage({
        session,
        emit: (event) => events.push(event),
        modelSelection: (modelId) => ({ providerId: "claude", runtimeKind: "claude", modelId }),
        timestamp: `2026-10-23T19:00:${String(ordinal++).padStart(2, "0")}.000Z`,
        message: claudeSdkMessageFixture(message),
      });
    };
    const membership = (
      tasks: {
        task_id: string;
        run_id?: string;
        ambient?: boolean;
        parent_task_id?: string;
        task_type?: string;
      }[],
    ) =>
      send({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: tasks.map((task) => ({ task_type: "local_bash", description: "Build", ...task })),
      });
    const idle = () => send({ type: "system", subtype: "session_state_changed", state: "idle" });
    const result = (
      overrides: Partial<
        Extract<
          Parameters<typeof claudeSdkMessageFixture>[0],
          { type: "result"; subtype: "success" }
        >
      > = {},
    ) =>
      send({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done",
        terminal_reason: "completed",
        ...overrides,
      });
    return { session, events, send, membership, idle, result };
  };

  test("holds aggregate activity through task disappearance, result, and continuation until later native idle", () => {
    const { session, events, membership, idle, result } = setup();
    membership([{ task_id: "build", run_id: "run-1" }]);
    idle();
    expect(session.activity).toBe("running");
    membership([]);
    result();
    expect(session.activity).toBe("running");
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_turn_finished",
        messageIds: [],
        turnOutcome: "completed",
      }),
    );
    idle();
    expect(session.activity).toBe("idle");
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
  });

  test("keeps a newer run active when an older notification and snapshot arrive", () => {
    const { session, membership, send, idle } = setup();
    membership([{ task_id: "build", run_id: "run-1" }]);
    send({
      type: "system",
      subtype: "task_started",
      task_id: "build",
      run_id: "run-2",
      is_backgrounded: true,
    });
    idle();
    expect(session.activity).toBe("running");
    membership([{ task_id: "build", run_id: "run-2" }]);
    send({
      type: "system",
      subtype: "task_notification",
      task_id: "build",
      run_id: "run-1",
      status: "completed",
    });
    membership([{ task_id: "build", run_id: "run-1" }]);
    idle();
    expect(session.activity).toBe("running");
    membership([]);
    idle();
    expect(session.activity).toBe("idle");
    send({
      type: "system",
      subtype: "task_notification",
      task_id: "build",
      run_id: "run-2",
      status: "completed",
    });
    expect(session.activity).toBe("idle");
  });

  test("removes ambient obligations and does not create delivery from an empty baseline", () => {
    const { session, membership, idle } = setup();
    membership([]);
    idle();
    expect(session.activity).toBe("idle");
    membership([{ task_id: "watch", run_id: "run-1" }]);
    expect(session.activity).toBe("running");
    membership([{ task_id: "watch", run_id: "run-1", ambient: true }]);
    idle();
    expect(session.activity).toBe("idle");
    membership([]);
    expect(session.activity).toBe("idle");
  });

  test("does not consume a queued host message when an automatic turn finishes", () => {
    const { session, events, send, result } = setup();
    session.acceptedUserMessages.push({
      messageId: "queued-user",
      text: "Next",
      parts: [],
      timestamp: "2026-10-23T18:59:00.000Z",
    });
    session.pendingUserTurnCount = 1;
    send({
      type: "user",
      parent_tool_use_id: null,
      origin: { kind: "task-notification" },
      message: { role: "user", content: "Build finished" },
    });
    result({ origin: { kind: "task-notification" } });
    expect(session.pendingUserTurnCount).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "session_turn_finished", messageIds: [] }),
    );
  });

  test("settles every consumed command once when native result echoes cover only the last 64 messages", () => {
    const acceptedUserMessages = Array.from({ length: 70 }, (_, index) => ({
      messageId: `user-${index}`,
      text: "Build",
      parts: [],
      timestamp: "2026-10-23T19:00:00.000Z",
    }));
    const session = createClaudeSession({
      acceptedUserMessages,
      pendingUserTurnCount: 70,
      activeSdkUserTurnCount: 70,
      activity: "running",
    });
    const events: AgentEvent[] = [];
    for (const accepted of acceptedUserMessages)
      applyClaudeUserMessageSignal({
        session,
        emit: (event) => events.push(event),
        message: { type: "command_lifecycle", command_uuid: accepted.messageId, state: "started" },
      });
    const steerId = claudeSdkMessageUuidFixture("folded-steer");
    session.unreadSteeredUserMessages.set(steerId, {
      messageId: steerId,
      text: "Also test",
      parts: [],
      timestamp: "2026-10-23T19:00:00.000Z",
    });
    waitForUserMessageAdmission(session, steerId);
    applyClaudeUserMessageSignal({
      session,
      emit: (event) => events.push(event),
      message: { type: "command_lifecycle", command_uuid: steerId, state: "started" },
    });
    applyClaudeUserMessageSignal({
      session,
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: steerId,
        isReplay: true,
        message: { content: "Also test" },
      }),
    });
    const message = claudeSdkMessageFixture({
      type: "result",
      subtype: "success",
      user_message_uuids: acceptedUserMessages.slice(-64).map((accepted) => accepted.messageId),
      terminal_reason: "completed",
    });
    const input = {
      session,
      message,
      emit: (event: AgentEvent) => events.push(event),
      timestamp: "2026-10-23T19:00:01.000Z",
      modelSelection: (modelId: string) => ({
        runtimeKind: "claude" as const,
        providerId: "claude",
        modelId,
      }),
    };
    handleClaudeSdkMessage(input);
    for (const accepted of acceptedUserMessages)
      applyClaudeUserMessageSignal({
        session,
        emit: (event) => events.push(event),
        message: {
          type: "command_lifecycle",
          command_uuid: accepted.messageId,
          state: "completed",
        },
      });
    handleClaudeSdkMessage(input);
    expect(events.filter((event) => event.type === "session_turn_finished")).toEqual([
      expect.objectContaining({
        messageIds: [...acceptedUserMessages.map((accepted) => accepted.messageId), steerId],
        turnOutcome: "completed",
      }),
    ]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    session.acceptedUserMessages.push({
      messageId: "next-user",
      text: "Next",
      parts: [],
      timestamp: "2026-10-23T19:00:02.000Z",
    });
    session.pendingUserTurnCount = 1;
    session.activeSdkUserTurnCount = 1;
    handleClaudeSdkMessage({
      ...input,
      message: { ...message, uuid: claudeSdkMessageUuidFixture("automatic-follow-up") },
    });
    expect(events.filter((event) => event.type === "session_turn_finished").at(-1)).toMatchObject({
      messageIds: [],
    });
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.activeSdkUserTurnCount).toBe(1);
  });

  test("rejects missing run identity for a registered task", () => {
    const { session } = setup();
    const message = claudeSdkMessageFixture({
      type: "system",
      subtype: "task_started",
      task_id: "build",
    });
    delete message.run_id;
    expect(() =>
      handleClaudeSdkMessage({
        session,
        message,
        emit: () => {},
        timestamp: "2026-10-23T19:00:00.000Z",
        modelSelection: (modelId) => ({ providerId: "claude", runtimeKind: "claude", modelId }),
      }),
    ).toThrow("Update Claude Code");
  });

  test("keeps verified descendants active and routable after their parent ends", () => {
    const { session, events, send, membership, idle } = setup();
    session.toolNamesByCallId.set("parent-tool", "Agent");
    session.subagentTaskIdsByToolUseId.set("parent-tool", "parent");
    const child = claudeSubagentEventSession(session, "parent-tool");
    if (!child) throw new Error("Expected the verified parent session.");
    send({
      type: "system",
      subtype: "task_started",
      task_id: "parent",
      run_id: "parent-1",
      task_type: "local_agent",
      tool_use_id: "parent-tool",
    });
    membership([
      {
        task_id: "descendant",
        run_id: "child-1",
        task_type: "local_agent",
        parent_task_id: "parent",
      },
      { task_id: "parent", run_id: "parent-1", task_type: "local_agent" },
    ]);
    send({
      type: "system",
      subtype: "task_notification",
      task_id: "parent",
      run_id: "parent-1",
      status: "completed",
      tool_use_id: "parent-tool",
    });
    membership([
      {
        task_id: "descendant",
        run_id: "child-1",
        task_type: "local_agent",
        parent_task_id: "parent",
      },
    ]);
    idle();
    expect(session.activity).toBe("running");
    expect(session.subagentEventSessionsByToolUseId?.get("parent-tool")).toBe(child);
    send({
      type: "system",
      subtype: "task_notification",
      task_id: "descendant",
      run_id: "child-1",
      status: "completed",
      tool_use_id: "child-tool",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        externalSessionId: child?.externalSessionId,
        type: "assistant_part",
        part: expect.objectContaining({ kind: "subagent", status: "completed" }),
      }),
    );
    membership([]);
    idle();
    expect(session.activity).toBe("idle");
  });

  test("settles a cancelled admitted command before freeing foreground readiness", async () => {
    const session = createClaudeSession({
      pendingUserTurnCount: 1,
      activeSdkUserTurnCount: 1,
      foregroundTurnActive: true,
      activity: "running",
      acceptedUserMessages: [
        { messageId: "user", text: "Build", parts: [], timestamp: "2026-10-23T19:00:00.000Z" },
      ],
    });
    const events: AgentEvent[] = [];
    const admission = waitForUserMessageAdmission(session, "user");
    const signal = (state: string) =>
      applyClaudeUserMessageSignal({
        session,
        emit: (event) => events.push(event),
        timestamp: "2026-10-23T19:00:01.000Z",
        message: { type: "command_lifecycle", command_uuid: "user", state },
      });
    signal("queued");
    await admission.admitted;
    signal("cancelled");
    signal("cancelled");
    expect(events.map((event) => event.type)).toEqual(["turn_error", "session_idle"]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.foregroundTurnActive).toBe(false);
  });
});
