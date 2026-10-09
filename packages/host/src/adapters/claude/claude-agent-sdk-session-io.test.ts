import { describe, expect, mock, test } from "bun:test";
import { initialSpeedState, type AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { consumeClaudeSession, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  ignoreClaudeBackgroundFailure,
  openClaudeQueryWithMessages,
  waitForTimers,
} from "./claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";

describe("sendClaudeUserMessage", () => {
  test("uses Claude SDK message timestamps for live transcript events", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession({
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "06f148f0-bd09-403a-8120-1b89a5737347",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:10.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done." }],
          },
        }),
      ]),
    });
    const closed = { value: false };

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: "06f148f0-bd09-403a-8120-1b89a5737347",
        timestamp: "2026-06-25T20:00:10.000Z",
      }),
    );
  });

  test("emits current context usage from the Claude SDK control API after result messages", async () => {
    const events: AgentEvent[] = [];
    const closed = { value: false };
    const getContextUsage = mock(async () => {
      await Promise.resolve();
      if (closed.value) {
        throw new Error("Query was closed before context usage was read.");
      }
      return {
        totalTokens: 42_000,
        maxTokens: 1_000_000,
      };
    });
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "89c62bd4-3b2a-476e-8df9-1559ad2a22a1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            result: "Done.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
            usage: {
              input_tokens: 1_600_000,
              output_tokens: 74_127,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
          session.query.close();
        },
      },
    });
    await waitForTimers();

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      totalTokens: 42_000,
      contextWindow: 1_000_000,
    });
    const assistantMessage = events.find((event) => event.type === "assistant_message");
    expect(assistantMessage).toEqual(
      expect.not.objectContaining({
        totalTokens: 1_674_127,
      }),
    );
  });

  test("does not emit a terminal session error when live context usage refresh fails", async () => {
    const events: AgentEvent[] = [];
    const warn = console.warn;
    const warnMock = mock(() => {});
    console.warn = warnMock;
    const getContextUsage = mock(async () => {
      throw new Error("context unavailable");
    });
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "89c62bd4-3b2a-476e-8df9-1559ad2a22a1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            result: "Done.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
          }),
        ]),
        { getContextUsage },
      ),
    });
    const closed = { value: false };

    try {
      await consumeClaudeSession({
        session,
        now: () => "2026-06-25T20:01:00.000Z",
        emit: (_session, event) => events.push(event),
        onBackgroundFailure: ignoreClaudeBackgroundFailure,
        sessionStore: {
          get: (externalSessionId) =>
            !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
          close: () => {
            closed.value = true;
            session.query.close();
          },
        },
      });
      await waitForTimers();
    } finally {
      console.warn = warn;
    }

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      "Failed to refresh Claude context usage for session 'session-1': context unavailable",
    );
    expect(events).toContainEqual({
      type: "session_context_error",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      message: "context unavailable",
    });
    expect(events.some((event) => event.type === "session_error")).toBe(false);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });

  test("refreshes current context usage while a live assistant message is still streaming", async () => {
    const events: AgentEvent[] = [];
    const getContextUsage = mock(async () => ({
      totalTokens: 95_000,
      maxTokens: 200_000,
    }));
    const { query, release } = openClaudeQueryWithMessages([
      claudeSdkMessageFixture({
        type: "assistant",
        uuid: "06f148f0-bd09-403a-8120-1b89a5737347",
        session_id: "session-1",
        timestamp: "2026-06-25T20:00:10.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: null,
          content: [{ type: "text", text: "Working..." }],
        },
      }),
    ]);
    const session = createClaudeSession({
      query: Object.assign(query, { getContextUsage }),
    });
    const closed = { value: false };

    const consumePromise = consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    await waitForTimers();

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      totalTokens: 95_000,
      contextWindow: 200_000,
    });
    expect(events.some((event) => event.type === "session_finished")).toBe(false);

    release();
    await consumePromise;
  });

  test("does not refresh context usage for tool-use continuation results", async () => {
    const events: AgentEvent[] = [];
    const getContextUsage = mock(async () => ({
      totalTokens: 42_000,
      maxTokens: 1_000_000,
    }));
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "89c62bd4-3b2a-476e-8df9-1559ad2a22a1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            stop_reason: "tool_use",
            usage: {
              input_tokens: 20_000,
              output_tokens: 1_000,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });
    const closed = { value: false };

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    expect(getContextUsage).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "session_context_updated")).toBe(false);
  });
});

describe("consumeClaudeSession fast mode", () => {
  test.each(["save", "publish"] as const)(
    "handles a native speed report's %s failure without losing committed state",
    async (failure) => {
      const events: AgentEvent[] = [];
      const failures: string[] = [];
      const processed = Promise.withResolvers<void>();
      let saved: string | null = "fast";
      const { query, release } = openClaudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "system",
          subtype: "init",
          model: "opus",
          fast_mode_state: "off",
        }),
        {
          type: "system",
          subtype: "notification",
          key: "after-speed-report",
          text: "Stream continues",
          priority: "high",
          uuid: "00000000-0000-4000-8000-000000000003",
          session_id: "session-1",
        },
      ]);
      const session = createClaudeSession({
        model: { providerId: "claude", modelId: "opus" },
        summary: {
          ...createClaudeSession().summary,
          speed: initialSpeedState("fast", "confirmed"),
        },
        query,
        recordSpeedChoice: async (choice) => {
          if (failure === "save") throw new Error("Store unavailable");
          saved = choice;
          return async () => {
            throw new Error("Publication failed");
          };
        },
      });
      const store = createClaudeAgentSdkSessionStore();
      store.set(session);
      const consumption = consumeClaudeSession({
        session,
        sessionStore: store,
        now: () => "2026-10-09T00:00:00Z",
        emit: (_session, event) => {
          events.push(event);
          if (event.type === "session_policy_notice" || event.type === "session_finished")
            processed.resolve();
        },
        onBackgroundFailure: (error) =>
          Effect.sync(() => {
            failures.push(error.message);
          }),
      });
      try {
        await processed.promise;
        if (failure === "publish") {
          expect(saved).toBe("standard");
          expect(store.get(session.externalSessionId)).toBe(session);
          expect(session.summary.speed).toMatchObject({
            choice: "standard",
            synchronization: "confirmed",
          });
          expect(failures).toEqual([expect.stringContaining("Publication failed")]);
          expect(events).toContainEqual(
            expect.objectContaining({ type: "session_policy_notice", message: "Stream continues" }),
          );
          expect(
            events.some(
              (event) => event.type === "session_error" || event.type === "session_finished",
            ),
          ).toBe(false);
          await expect(session.turnAdmission.run(async () => "admitted")).resolves.toBe("admitted");
        } else {
          expect(saved).toBe("fast");
          expect(store.get(session.externalSessionId)).toBeUndefined();
          expect(session.summary.speed).toMatchObject({
            choice: "fast",
            synchronization: "confirmed",
          });
          expect(events).toContainEqual(
            expect.objectContaining({ type: "session_error", message: "Store unavailable" }),
          );
          expect(failures).toEqual([]);
        }
      } finally {
        release();
        await consumption;
      }
    },
  );

  test("applies an explicit saved model before a cold session's first native report", async () => {
    const model = { providerId: "claude", modelId: "opus", variant: "low" };
    const setModel = mock(async () => {});
    const flags = mock(async () => {});
    const session = createClaudeSession({
      model,
      preserveNativeSettings: true,
      summary: {
        ...createClaudeSession().summary,
        speed: initialSpeedState("standard", "confirmed"),
      },
      query: Object.assign(claudeQueryWithMessages([]), { setModel, applyFlagSettings: flags }),
    });
    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-10-09T00:00:00.000Z",
      randomId: () => "00000000-0000-4000-8000-000000000001",
      emit: () => {},
      messageInput: {
        ...session.input,
        externalSessionId: session.externalSessionId,
        model,
        parts: [{ kind: "text", text: "Use the selected model" }],
      },
    });
    expect(accepted.state).toBe("read");
    expect(setModel).toHaveBeenCalledWith("opus");
    expect(flags).toHaveBeenCalledWith({ effortLevel: "low" });
    session.queue.close();
  });

  test.each(["pending", "unapplied", "uncertain"] as const)(
    "does not deliver new work while the on choice is %s",
    async (synchronization) => {
      const session = createClaudeSession({
        summary: {
          ...createClaudeSession().summary,
          speed: initialSpeedState("fast", synchronization),
        },
      });
      await expect(
        sendClaudeUserMessage({
          session,
          now: () => "2026-10-08T00:00:00Z",
          randomId: () => "00000000-0000-4000-8000-000000000001",
          emit: () => {},
          messageInput: {
            repoPath: "/repo",
            workingDirectory: "/repo",
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            externalSessionId: session.externalSessionId,
            parts: [{ kind: "text", text: "Do not start yet" }],
          },
        }),
      ).rejects.toThrow("Set fast mode explicitly before sending another message.");
      session.queue.close();
      const delivered = [];
      for await (const message of session.queue) delivered.push(message);
      expect(delivered).toEqual([]);
      expect(session.summary.speed).toMatchObject({ choice: "fast", synchronization });
    },
  );

  test.each([
    {
      fast_mode_state: "off" as const,
      fast_mode_disabled_reason: "extra_usage_disabled" as const,
      processing: "standard",
    },
    {
      fast_mode_state: "off" as const,
      fast_mode_disabled_reason: "preference" as const,
      processing: "standard",
    },
    {
      fast_mode_state: "off" as const,
      fast_mode_disabled_reason: "sdk_opt_in_required" as const,
      processing: "standard",
    },
    { fast_mode_state: "cooldown" as const, processing: "cooldown" },
  ])(
    "delivers queued work after $processing processing without clearing the confirmed on choice",
    async ({ processing, ...report }) => {
      const events: AgentEvent[] = [];
      const save = mock(async () => async () => {});
      const flags = mock(async () => {});
      const session = createClaudeSession({
        summary: {
          ...createClaudeSession().summary,
          speed: initialSpeedState("fast", "confirmed"),
        },
        model: { providerId: "claude", modelId: "opus", profileId: "build", variant: "high" },
        recordSpeedChoice: save,
        query: Object.assign(
          claudeQueryWithMessages([
            claudeSdkMessageFixture({
              type: "result",
              subtype: "success",
              stop_reason: "end_turn",
              terminal_reason: "completed",
              ...report,
            }),
            claudeSdkMessageFixture({
              type: "system",
              subtype: "session_state_changed",
              state: "idle",
            }),
          ]),
          {
            applyFlagSettings: flags,
            supportedModels: async () => [
              { value: "opus", displayName: "Opus", description: "Opus", supportsFastMode: true },
            ],
          },
        ),
      });
      const sessionStore = createClaudeAgentSdkSessionStore();
      sessionStore.set(session);
      const messageIds = [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ] as const;
      for (const [index, messageId] of messageIds.entries()) {
        const accepted = await sendClaudeUserMessage({
          session,
          now: () => "2026-10-08T00:00:00Z",
          randomId: () => messageId,
          emit: (_session, event) => events.push(event),
          messageInput: {
            repoPath: "/repo",
            workingDirectory: "/repo",
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            externalSessionId: session.externalSessionId,
            parts: [{ kind: "text", text: `Work ${index + 1}` }],
          },
        });
        expect(accepted.state).toBe(index === 0 ? "read" : "queued");
      }
      await consumeClaudeSession({
        session,
        sessionStore,
        now: () => "2026-10-08T00:00:01Z",
        emit: (_session, event) => events.push(event),
        onBackgroundFailure: ignoreClaudeBackgroundFailure,
      });
      const delivered = [];
      for await (const message of session.queue)
        delivered.push({ id: message.uuid, content: message.message.content });
      expect(delivered).toEqual([
        { id: messageIds[0], content: [{ type: "text", text: "Work 1" }] },
        { id: messageIds[1], content: [{ type: "text", text: "Work 2" }] },
      ]);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "user_message", messageId: messageIds[1], state: "read" }),
      );
      expect(events.some((event) => event.type === "session_error")).toBe(false);
      expect(session.summary.speed).toMatchObject({
        choice: "fast",
        synchronization: "confirmed",
        processing: { status: processing },
      });
      if ("fast_mode_disabled_reason" in report)
        expect(session.summary.speed.availability).toMatchObject({
          status: "blocked",
          reason: { code: report.fast_mode_disabled_reason },
        });
      expect(session.model).toEqual({
        providerId: "claude",
        modelId: "opus",
        profileId: "build",
        variant: "high",
      });
      expect(save).not.toHaveBeenCalled();
      expect(flags).not.toHaveBeenCalled();
    },
  );

  test("forwards native speed notification text without changing choice or processing", async () => {
    const events: AgentEvent[] = [];
    const text = "Fast mode disabled · usage credits exhausted";
    const uuid = "00000000-0000-4000-8000-000000000003";
    const session = createClaudeSession({
      summary: { ...createClaudeSession().summary, speed: initialSpeedState("fast", "confirmed") },
      query: claudeQueryWithMessages([
        {
          type: "system",
          subtype: "notification",
          key: "speed-usage",
          text,
          priority: "high",
          uuid,
          session_id: "session-1",
        },
      ]),
    });
    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-10-08T00:00:01Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    expect(events).toContainEqual({
      type: "session_policy_notice",
      externalSessionId: "session-1",
      timestamp: "2026-10-08T00:00:01Z",
      messageId: uuid,
      message: text,
    });
    expect(events.some((event) => event.type === "session_speed_changed")).toBe(false);
    expect(session.summary.speed).toMatchObject({
      choice: "fast",
      synchronization: "confirmed",
      processing: { status: "unknown" },
    });
  });
});
