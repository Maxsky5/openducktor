import { describe, expect, mock, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentEvent,
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
  type SendAgentUserMessageInput,
} from "@openducktor/core";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  createClaudeQueryFixture,
  createClaudeSession,
  createNonAdmittingClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";
import {
  applyClaudeUserMessageSignal,
  rejectPendingAdmissions,
} from "./claude-agent-sdk-user-message-admission";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import type { ClaudeSession } from "./claude-agent-sdk-types";

const FIRST_MESSAGE_ID = "00000000-0000-4000-8000-000000000001";
const SENT_MESSAGE_ID = "00000000-0000-4000-8000-000000000003";

type MessageOverrides = {
  delivery?: SendAgentUserMessageInput["delivery"];
  parts?: SendAgentUserMessageInput["parts"];
};

const messageInput = (overrides: MessageOverrides = {}): SendAgentUserMessageInput => ({
  externalSessionId: "session-1",
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo",
  runtimePolicy: { kind: "claude" },
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  delivery: "new_turn",
  parts: [{ kind: "text", text: "Continue" }],
  ...overrides,
});

const recordingQueue = () => {
  const pushed: SDKUserMessage[] = [];
  const queue = new AsyncInputQueue<SDKUserMessage>();
  queue.push = (message) => {
    pushed.push(message);
  };
  return { pushed, queue };
};

const runningSession = (
  createSession: typeof createClaudeSession,
  overrides: Partial<ClaudeSession> = {},
): ClaudeSession =>
  createSession({
    acceptedUserMessages: [
      {
        messageId: FIRST_MESSAGE_ID,
        parts: [{ kind: "text", text: "first" }],
        text: "first",
        timestamp: "2026-06-25T19:59:00.000Z",
      },
    ],
    activeSdkUserTurnCount: 1,
    activity: "running",
    pendingUserTurnCount: 1,
    sdkState: "running",
    ...overrides,
  });

const send = (
  session: ClaudeSession,
  input: SendAgentUserMessageInput,
  events: AgentEvent[] = [],
) =>
  sendClaudeUserMessage({
    session,
    now: () => "2026-06-25T20:00:00.000Z",
    randomId: () => SENT_MESSAGE_ID,
    emit: (_session, event) => events.push(event),
    messageInput: input,
  });

/** Waits until the send registered its admission, after its async preparation. */
const untilAdmissionPending = async (session: ClaudeSession): Promise<void> => {
  for (let tick = 0; tick < 100 && session.pendingUserMessageAdmissions.size === 0; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(session.pendingUserMessageAdmissions.size).toBe(1);
};

const failureOf = (promise: Promise<unknown>): Promise<Error | null> =>
  promise.then(
    () => null,
    (error: Error) => error,
  );

describe("Claude session I/O message delivery", () => {
  test("returns a skill chip for live Claude skill commands", async () => {
    const { pushed, queue } = recordingQueue();
    const session = createClaudeSession({ queue });

    const accepted = await send(
      session,
      messageInput({
        parts: [
          {
            kind: "slash_command",
            command: {
              id: "grill-me",
              trigger: "grill-me",
              title: "grill-me",
              description: "Grill a plan",
              source: "skill",
              hints: [],
            },
          },
        ],
      }),
    );

    expect(accepted).toMatchObject({
      message: "/grill-me",
      parts: [
        {
          kind: "skill_mention",
          skill: {
            id: "grill-me",
            name: "grill-me",
            path: "grill-me",
            title: "grill-me",
            description: "Grill a plan",
          },
          sourceText: { value: "/grill-me", start: 0, end: 9 },
        },
      ],
    });
    expect(pushed[0]?.message.content).toEqual([{ type: "text", text: "/grill-me" }]);
  });

  test("refuses a new turn while a Claude turn runs", async () => {
    const { pushed, queue } = recordingQueue();
    const session = runningSession(createClaudeSession, { queue });
    const events: AgentEvent[] = [];

    const failure = await failureOf(send(session, messageInput(), events));

    expect(failure).toBeInstanceOf(AgentSessionTurnActiveError);
    expect(pushed).toEqual([]);
    expect(session.acceptedUserMessages).toHaveLength(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(events).toEqual([]);
  });

  test("refuses a new turn while a pushed turn has not started", async () => {
    const { pushed, queue } = recordingQueue();
    const session = createClaudeSession({
      activity: "running",
      pendingUserTurnCount: 1,
      queue,
      sdkState: "idle",
    });

    const failure = await failureOf(send(session, messageInput()));

    expect(failure).toBeInstanceOf(AgentSessionTurnActiveError);
    expect(pushed).toEqual([]);
    expect(session.pendingUserTurnCount).toBe(1);
  });

  test("steers the running turn without counting a new turn", async () => {
    const { pushed, queue } = recordingQueue();
    const session = runningSession(createClaudeSession, { queue });
    const events: AgentEvent[] = [];

    const accepted = await send(
      session,
      messageInput({
        delivery: "steer",
        parts: [{ kind: "text", text: "Also check the tests" }],
      }),
      events,
    );

    expect(pushed).toEqual([
      expect.objectContaining({
        uuid: SENT_MESSAGE_ID,
        priority: "now",
        origin: { kind: "human" },
        message: { role: "user", content: [{ type: "text", text: "Also check the tests" }] },
      }),
    ]);
    expect(accepted).toEqual({
      type: "user_message",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
      messageId: SENT_MESSAGE_ID,
      message: "Also check the tests",
      parts: [{ kind: "text", text: "Also check the tests" }],
      state: "queued",
    });
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.acceptedUserMessages).toHaveLength(1);
    expect(session.model).toBeUndefined();
    expect([...session.unreadSteeredUserMessages.keys()]).toEqual([SENT_MESSAGE_ID]);
    expect(events).toEqual([]);
  });

  test("admits a steered message and marks it read when the CLI echoes it", async () => {
    const session = runningSession(createNonAdmittingClaudeSession);
    const events: AgentEvent[] = [];

    const sending = send(session, {
      ...messageInput({ delivery: "steer" }),
      submissionId: "submission-steer",
    });
    await untilAdmissionPending(session);
    const handled = applyClaudeUserMessageSignal({
      session,
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: SENT_MESSAGE_ID,
        session_id: "session-1",
        parent_tool_use_id: null,
        isReplay: true,
        message: { role: "user", content: "Continue" },
      }),
    });

    const read = {
      type: "user_message" as const,
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
      messageId: SENT_MESSAGE_ID,
      message: "Continue",
      parts: [{ kind: "text" as const, text: "Continue" }],
      state: "read" as const,
      submissionId: "submission-steer",
    };
    expect(handled).toBe(true);
    expect(events).toEqual([read]);
    expect(await sending).toEqual(read);
    expect(session.unreadSteeredUserMessages.size).toBe(0);
  });

  test("returns a message only after the CLI admits it", async () => {
    const session = createNonAdmittingClaudeSession({ activity: "idle", sdkState: "idle" });
    let settled = false;

    const sending = send(session, { ...messageInput(), submissionId: "submission-1" }).then(
      (accepted) => {
        settled = true;
        return accepted;
      },
    );
    await untilAdmissionPending(session);
    expect(settled).toBe(false);

    applyClaudeUserMessageSignal({
      session,
      emit: () => {},
      message: { type: "command_lifecycle", command_uuid: SENT_MESSAGE_ID, state: "queued" },
    });

    expect(await sending).toMatchObject({
      messageId: SENT_MESSAGE_ID,
      state: "read",
      submissionId: "submission-1",
    });
  });

  test("refuses a new turn that the CLI cancels before it runs and leaves the session idle", async () => {
    const session = createNonAdmittingClaudeSession({ activity: "idle", sdkState: "idle" });
    const events: AgentEvent[] = [];

    const sending = failureOf(send(session, messageInput(), events));
    await untilAdmissionPending(session);
    applyClaudeUserMessageSignal({
      session,
      emit: () => {},
      message: { type: "command_lifecycle", command_uuid: SENT_MESSAGE_ID, state: "cancelled" },
    });

    expect(await sending).toBeInstanceOf(AgentSessionMessageRefusedError);
    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.acceptedUserMessages).toEqual([]);
    // A turn that never ran ends with no outcome, so it releases no queued message.
    expect(events.at(-1)).toEqual({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
    });
  });

  test("refuses a steered message that the CLI cancels before a turn reads it", async () => {
    const session = runningSession(createNonAdmittingClaudeSession);

    const sending = failureOf(send(session, messageInput({ delivery: "steer" })));
    await untilAdmissionPending(session);
    applyClaudeUserMessageSignal({
      session,
      emit: () => {},
      message: { type: "command_lifecycle", command_uuid: SENT_MESSAGE_ID, state: "cancelled" },
    });

    expect(await sending).toBeInstanceOf(AgentSessionMessageRefusedError);
    expect(session.unreadSteeredUserMessages.size).toBe(0);
    expect(session.activity).toBe("running");
  });

  test("reports an unknown result when the session stops before the CLI admits a message", async () => {
    const session = createNonAdmittingClaudeSession({ activity: "idle", sdkState: "idle" });

    const sending = failureOf(send(session, messageInput()));
    await untilAdmissionPending(session);
    rejectPendingAdmissions(session, new Error("stopped"));

    expect(await sending).toBeInstanceOf(AgentSessionMessageAcceptanceUnknownError);
  });

  test("refuses an issued steer whose running turn ended before dispatch", async () => {
    const { pushed, queue } = recordingQueue();
    const session = createClaudeSession({ activity: "idle", queue, sdkState: "idle" });
    expect(await failureOf(send(session, messageInput({ delivery: "steer" })))).toBeInstanceOf(
      AgentSessionMessageRefusedError,
    );
    expect(pushed).toEqual([]);
    expect(session.activeSdkUserTurnCount).toBe(0);
  });

  test("keeps a stopped session stopped when the push fails", async () => {
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    const session = createClaudeSession({ activity: "idle", queue });
    queue.push = () => {
      session.activity = "stopped";
      queue.close();
      throw new Error("session stopped during delivery");
    };

    const failure = await failureOf(
      send(
        session,
        messageInput({ parts: [{ kind: "text", text: "should remain stopped" }] }),
        events,
      ),
    );

    expect(failure).toMatchObject({ message: "session stopped during delivery" });
    expect(session.activity).toBe("stopped");
    expect(session.acceptedUserMessages).toEqual([]);
    expect(events).toEqual([]);
  });

  test("does not mark user messages accepted when the Claude input queue is closed", async () => {
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.close();
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings: mock(async () => {}),
        setModel: mock(async (_model?: string) => {}),
      }),
      queue,
    });

    const failure = await failureOf(
      send(
        session,
        messageInput({
          parts: [{ kind: "text", text: "should not be accepted" }],
        }),
        events,
      ),
    );

    expect(failure).toMatchObject({
      message: "Cannot send input to a closed Claude Agent SDK session.",
    });
    expect(session.acceptedUserMessages).toEqual([]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    expect(session.model).toEqual({
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      runtimeKind: "claude",
      variant: "high",
    });
    expect(events).toEqual([]);
  });
});
