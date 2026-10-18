import { describe, expect, mock, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { applyClaudeSessionModel, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  createClaudeQueryFixture,
  createClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";

const MESSAGE_ID = "00000000-0000-4000-8000-000000000001";

describe("Claude session I/O model changes", () => {
  test("does not change the query creation system prompt on later sends", async () => {
    const queue = new AsyncInputQueue<SDKUserMessage>();
    const session = createClaudeSession({ queue });
    const originalInput = session.input;

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => MESSAGE_ID,
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        delivery: "new_turn",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        systemPrompt: "Replacement prompt",
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(session.input).toBe(originalInput);
    expect(session.input.systemPrompt).toBe("Build");
  });

  test.each([false, true])(
    "sends with accepted settings without SDK configuration work, failed=%s",
    async (fail) => {
      const setModel = mock(async () => {
        throw new Error("unexpected model change");
      });
      const applyFlagSettings = mock(async () => {
        throw new Error("unexpected effort change");
      });
      const model = {
        runtimeKind: "claude" as const,
        providerId: "claude",
        modelId: "claude-opus-4-6",
        variant: "high",
        speed: "fast",
      };
      const queue = new AsyncInputQueue<SDKUserMessage>();
      if (fail)
        queue.push = () => {
          throw new Error("queue unavailable");
        };
      const session = createClaudeSession({
        activity: "idle",
        model,
        queue,
        query: createClaudeQueryFixture({ setModel, applyFlagSettings }),
      });
      const sending = sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => MESSAGE_ID,
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          delivery: "new_turn",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "hello" }],
        },
      });
      if (fail) await expect(sending).rejects.toThrow("queue unavailable");
      else expect(await sending).toMatchObject({ model, message: "hello" });
      expect(session.model).toEqual(model);
      expect(setModel).not.toHaveBeenCalled();
      expect(applyFlagSettings).not.toHaveBeenCalled();
    },
  );

  test.each([
    { previous: undefined, next: "fast", settings: { fastMode: true } },
    { previous: "fast", next: undefined, settings: { fastMode: false } },
  ])("changes speed explicitly from $previous to $next", async (change) => {
    const applyFlagSettings = mock(async () => {});
    const model = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "claude-opus-4-6",
    };
    const session = createClaudeSession({
      activity: "idle",
      model: change.previous ? { ...model, speed: change.previous } : model,
      query: createClaudeQueryFixture({ applyFlagSettings }),
    });
    await applyClaudeSessionModel(session, change.next ? { ...model, speed: change.next } : model);
    expect(applyFlagSettings).toHaveBeenCalledWith(change.settings);
    expect(session.model?.speed).toBe(change.next);
  });

  test("rejects an unsupported speed during explicit configuration", async () => {
    const applyFlagSettings = mock(async () => {});
    const model = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "claude-opus-4-6",
    };
    const session = createClaudeSession({
      model,
      query: createClaudeQueryFixture({ applyFlagSettings }),
    });
    await expect(applyClaudeSessionModel(session, { ...model, speed: "priority" })).rejects.toThrow(
      "does not support speed 'priority'",
    );
    expect(applyFlagSettings).not.toHaveBeenCalled();
  });

  test("reports the native send only after the message enters the SDK input queue", async () => {
    const messageInput = {
      externalSessionId: "session-1",
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo",
      runtimePolicy: { kind: "claude" as const },
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      parts: [{ kind: "text" as const, text: "hello" }],
      delivery: "new_turn" as const,
    };
    const send = (queue: AsyncInputQueue<SDKUserMessage>, onSent: () => void) =>
      sendClaudeUserMessage({
        session: createClaudeSession({ activity: "idle", queue }),
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => MESSAGE_ID,
        emit: () => {},
        messageInput,
        onSent,
      });
    const sent: string[] = [];
    await send(new AsyncInputQueue<SDKUserMessage>(), () => sent.push("pushed"));
    expect(sent).toEqual(["pushed"]);

    const closed = new AsyncInputQueue<SDKUserMessage>();
    closed.push = () => {
      throw new Error("queue unavailable");
    };
    // A failed push leaves the message outside the SDK, so the caller can send it again.
    await expect(send(closed, () => sent.push("closed"))).rejects.toThrow("queue unavailable");
    expect(sent).toEqual(["pushed"]);
  });
});
