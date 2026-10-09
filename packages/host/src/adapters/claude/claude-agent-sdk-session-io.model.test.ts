import { describe, expect, mock, test } from "bun:test";
import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { initialSpeedState } from "@openducktor/core";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
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
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        systemPrompt: "Replacement prompt",
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(session.input).toBe(originalInput);
    expect(session.input.systemPrompt).toBe("Build");
  });

  test("applies per-message model changes through the Claude SDK query", async () => {
    const setModel = mock(async (_model?: string) => {});
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "idle",
      query: createClaudeQueryFixture({ setModel }),
      queue,
    });

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
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
        },
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(setModel).toHaveBeenCalledWith("claude-opus-4-6");
    expect(session.model?.modelId).toBe("claude-opus-4-6");
    expect(pushed).toHaveLength(1);
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.acceptedUserMessages).toEqual([
      {
        messageId: MESSAGE_ID,
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
        },
        parts: [{ kind: "text", text: "hello" }],
        text: "hello",
        timestamp: "2026-06-25T20:00:00.000Z",
      },
    ]);
  });

  test("applies supported per-message effort changes through Claude flag settings", async () => {
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async () => {});
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings,
        setModel,
      }),
      queue,
    });

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
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
          variant: "xhigh",
        },
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" });
    expect(session.model?.variant).toBe("xhigh");
    expect(pushed).toHaveLength(1);
  });

  test.each(["delivery", "catalog", "flag", "save"] as const)(
    "rolls the Claude SDK model back when %s fails before message acceptance",
    async (failure) => {
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const fail = async () => {
        entered.resolve();
        await resume.promise;
        throw new Error(`${failure} unavailable`);
      };
      let nativeModel = "claude-opus-5-5";
      const setModel = mock(async (model?: string) => {
        nativeModel = model ?? "default";
      });
      const applyFlagSettings = mock<Query["applyFlagSettings"]>(async (settings) => {
        if (failure === "flag" && settings.fastMode === false) await fail();
      });
      const save = mock(async () => {
        if (failure === "save") await fail();
        return async () => {};
      });
      const queue = new AsyncInputQueue<SDKUserMessage>();
      const push = mock(() => {
        if (failure === "delivery") throw new Error("delivery unavailable");
      });
      queue.push = push;
      const priorMessage = {
        messageId: "00000000-0000-4000-8000-000000000002",
        parts: [{ kind: "text" as const, text: "Earlier message" }],
        text: "Earlier message",
        timestamp: "2026-06-25T19:59:00.000Z",
      };
      const session = createClaudeSession({
        acceptedUserMessages: [priorMessage],
        activity: "idle",
        sdkState: "idle",
        summary: {
          ...createClaudeSession().summary,
          speed: initialSpeedState(failure === "delivery" ? "standard" : "fast", "confirmed"),
        },
        nativeModel: { modelId: "claude-opus-5-5", effort: "high" },
        preserveNativeSettings: true,
        model: {
          providerId: "claude",
          modelId: "claude-opus-5-5",
          runtimeKind: "claude",
          variant: "high",
          profileId: "review-agent",
        },
        query: createClaudeQueryFixture({
          setModel,
          applyFlagSettings,
          supportedModels: async () => {
            if (failure === "catalog") await fail();
            return [
              {
                value: "sonnet",
                resolvedModel: "claude-sonnet-5-5",
                displayName: "Sonnet",
                description: "Sonnet",
                supportsFastMode: false,
              },
            ];
          },
        }),
        recordSpeedChoice: save,
        queue,
      });
      const emit = mock(() => {});
      const sending = sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => MESSAGE_ID,
        emit,
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          model: {
            providerId: "claude",
            modelId: "claude-sonnet-5-5",
            runtimeKind: "claude",
            variant: "low",
            profileId: "review-agent",
          },
          parts: [{ kind: "text", text: "hello" }],
        },
      });
      try {
        if (failure !== "delivery") {
          await entered.promise;
          expect(session.activity).toBe("idle");
          expect(session.acceptedUserMessages).toEqual([priorMessage]);
          expect(session.pendingUserTurnCount).toBe(0);
          expect(push).not.toHaveBeenCalled();
        }
      } finally {
        resume.resolve();
      }
      await expect(sending).rejects.toThrow(`${failure} unavailable`);

      expect(setModel.mock.calls.map(([model]) => model)).toEqual([
        "claude-sonnet-5-5",
        "claude-opus-5-5",
      ]);
      expect(nativeModel).toBe("claude-opus-5-5");
      expect(session.model).toEqual({
        providerId: "claude",
        modelId: "claude-opus-5-5",
        runtimeKind: "claude",
        variant: "high",
        profileId: "review-agent",
      });
      expect(session.summary.speed).toMatchObject({
        choice: failure === "delivery" ? "standard" : "fast",
        synchronization: "confirmed",
      });
      expect(session.acceptedUserMessages).toEqual([priorMessage]);
      expect(session.queuedSdkMessages).toEqual([]);
      expect(session.activity).toBe("idle");
      expect(session.sdkState).toBe("idle");
      expect(session.pendingUserTurnCount).toBe(0);
      expect(session.activeSdkUserTurnCount).toBe(0);
      expect(emit).not.toHaveBeenCalled();
      expect(push).toHaveBeenCalledTimes(failure === "delivery" ? 1 : 0);
      if (failure === "save") {
        expect(save).toHaveBeenCalledTimes(1);
        expect(applyFlagSettings).toHaveBeenCalledWith({ fastMode: true });
      }
    },
  );
});
