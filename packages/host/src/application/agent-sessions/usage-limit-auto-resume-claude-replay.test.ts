import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { createClaudeLiveSessionState } from "../../adapters/agent-sessions/claude-live-session-state";
import { decideClaudeLiveContinuation } from "../../adapters/claude/claude-agent-sdk-continuation";
import { handleClaudeSdkMessage } from "../../adapters/claude/claude-agent-sdk-events";
import { createClaudeSession } from "../../adapters/claude/claude-agent-sdk-session-io.test-support";
import {
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "../../adapters/claude/claude-agent-sdk-test-messages";
import {
  claudeRateLimitEventFixture,
  claudeTaskNotificationWakeFixture,
} from "../../adapters/claude/claude-agent-sdk-usage-limit.test-support";
import {
  BASE,
  claudeRef,
  createHarness,
  DUE,
  flush,
  RESET,
  sessionScope,
} from "./usage-limit-auto-resume-service.test-support";

const createClaudeReplay = (h: ReturnType<typeof createHarness>) => {
  const liveState = createClaudeLiveSessionState();
  const timestamp = new Date(BASE).toISOString();
  const session = createClaudeSession({
    activity: "running",
    foregroundTurnActive: true,
    input: {
      repoPath: claudeRef.repoPath,
      runtimeKind: "claude",
      workingDirectory: claudeRef.workingDirectory,
      runtimePolicy: { kind: "claude" },
      sessionScope,
      systemPrompt: "Build",
    },
    summary: {
      externalSessionId: claudeRef.externalSessionId,
      runtimeKind: "claude",
      workingDirectory: claudeRef.workingDirectory,
      title: "Build",
      startedAt: timestamp,
      status: "running",
      sessionAssociation: sessionScope,
    },
    acceptedUserMessages: [{ messageId: "user-1", text: "Build", parts: [], timestamp }],
    pendingUserTurnCount: 1,
  });
  const emit = (event: AgentEvent): void => {
    for (const change of liveState.applyEvent(session, event)) {
      if (change.type === "session_upsert") {
        h.state.live = { type: "live", session: change.snapshot };
        h.service.observe({ type: "session_upsert", session: change.snapshot });
      } else if (change.type === "transcript_event") {
        h.service.observe({ type: "transcript_event", event: change.event });
      }
    }
  };
  const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
    handleClaudeSdkMessage({
      session,
      message,
      timestamp,
      emit,
      modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
    });
  const stopOnWeeklyLimit = (stopId: string): void => {
    handle(
      claudeRateLimitEventFixture(
        {
          status: "rejected",
          rateLimitType: "seven_day",
          resetsAt: Math.floor(RESET / 1000),
        },
        { sessionId: claudeRef.externalSessionId, uuidLabel: `rate-limit-${stopId}` },
      ),
    );
    handle(
      claudeSdkMessageFixture({
        type: "assistant",
        session_id: claudeRef.externalSessionId,
        uuid: claudeSdkMessageUuidFixture(stopId),
        error: "rate_limit",
        message: {
          id: stopId,
          content: [{ type: "text", text: "You've hit your weekly limit." }],
          stop_reason: "end_turn",
        },
      }),
    );
    handle(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "error_during_execution",
        session_id: claudeRef.externalSessionId,
        uuid: claudeSdkMessageUuidFixture(`result-${stopId}`),
        user_message_uuid: "user-1",
        errors: ["You've hit your weekly limit."],
      }),
    );
  };
  const notificationWake = (
    id: string,
    overrides: { isSynthetic?: boolean; shouldQuery?: boolean } = {},
  ): void =>
    handle(
      claudeTaskNotificationWakeFixture(id, {
        sessionId: claudeRef.externalSessionId,
        content: "<task-notification><status>completed</status></task-notification>",
        ...overrides,
      }),
    );
  const successResult = (id: string, result = ""): void =>
    handle(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        session_id: claudeRef.externalSessionId,
        uuid: claudeSdkMessageUuidFixture(id),
        is_error: false,
        num_turns: 0,
        result,
        stop_reason: null,
      }),
    );
  return { session, handle, stopOnWeeklyLimit, notificationWake, successResult };
};

describe("usage-limit auto-resume Claude replay", () => {
  test("keeps a Claude weekly-limit auto-resume scheduled across an empty notification wake and background completion", async () => {
    const h = createHarness();
    const { session, handle, stopOnWeeklyLimit, notificationWake, successResult } =
      createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response");
        yield* flush;
        expect(h.published).toEqual([
          { ref: claudeRef, stopId: "limit-response", resumeAtEpochMs: DUE, state: "scheduled" },
        ]);

        notificationWake("notif-wake-user");
        handle(
          claudeSdkMessageFixture({
            type: "system",
            subtype: "task_notification",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("notif-system"),
            task_id: "bg-task-1",
            tool_use_id: "call-bg-1",
            status: "completed",
            output_file: "/tmp/bg.out",
            summary: "Background agent finished",
          }),
        );
        successResult("notif-empty-result");
        yield* flush;

        expect(h.published).toEqual([
          { ref: claudeRef, stopId: "limit-response", resumeAtEpochMs: DUE, state: "scheduled" },
        ]);
        expect(decideClaudeLiveContinuation(session, claudeRef.externalSessionId)).toEqual({
          kind: "allow",
        });

        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([
          { ...claudeRef, sessionScope, resumeMode: "continue_interrupted_turn" },
        ]);
      }),
    );
  });

  test("cancels a Claude auto-resume when a later notification wake produces real assistant output", async () => {
    const h = createHarness();
    const { handle, stopOnWeeklyLimit, notificationWake, successResult } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response-2");
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled" });

        notificationWake("real-wake-user");
        handle(
          claudeSdkMessageFixture({
            type: "assistant",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("real-wake-assistant"),
            message: {
              id: "real-wake-assistant",
              content: [{ type: "text", text: "Processed the completed background task." }],
              stop_reason: "end_turn",
            },
          }),
        );
        successResult("real-wake-result", "Processed the completed background task.");
        yield* h.advanceTo(DUE);

        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("keeps a Claude auto-resume pending while an empty notification spans the deadline and dispatches when it ends", async () => {
    const h = createHarness();
    const { session, stopOnWeeklyLimit, notificationWake, successResult } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response-span");
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled" });

        yield* h.advanceTo(DUE - 1_000);
        notificationWake("span-wake-user");
        yield* flush;

        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toMatchObject({
          stopId: "limit-response-span",
          state: "scheduled",
        });

        yield* h.advanceTo(DUE + 1_000);
        successResult("span-wake-result");
        yield* flush;

        expect(decideClaudeLiveContinuation(session, claudeRef.externalSessionId)).toEqual({
          kind: "allow",
        });
        expect(h.resumes).toEqual([
          { ...claudeRef, sessionScope, resumeMode: "continue_interrupted_turn" },
        ]);
        expect(h.published.at(-1)).toBeNull();
      }),
    );
  });

  test("cancels a Claude auto-resume when a wake spanning the deadline produces real assistant output", async () => {
    const h = createHarness();
    const { handle, stopOnWeeklyLimit, notificationWake, successResult } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response-span-real");
        yield* flush;

        yield* h.advanceTo(DUE - 1_000);
        notificationWake("span-real-wake-user");
        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);

        yield* h.advanceTo(DUE + 1_000);
        handle(
          claudeSdkMessageFixture({
            type: "assistant",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("span-real-wake-assistant"),
            message: {
              id: "span-real-wake-assistant",
              content: [{ type: "text", text: "Handled the background result." }],
              stop_reason: "end_turn",
            },
          }),
        );
        successResult("span-real-wake-result", "Handled the background result.");
        yield* flush;

        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("keeps a Claude auto-resume scheduled when an existing background shell tool reports progress", async () => {
    const h = createHarness();
    const { session, handle, stopOnWeeklyLimit } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        handle(
          claudeSdkMessageFixture({
            type: "assistant",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("bg-launch-assistant"),
            message: {
              id: "bg-launch-assistant",
              content: [
                {
                  type: "tool_use",
                  id: "call-bg-shell",
                  name: "Bash",
                  input: { command: "bun test", run_in_background: true },
                },
              ],
              stop_reason: "tool_use",
            },
          }),
        );
        handle(
          claudeSdkMessageFixture({
            type: "user",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("bg-launch-result"),
            tool_use_result: { backgroundTaskId: "task-bg-shell" },
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call-bg-shell",
                  content: "Command running in background with ID: task-bg-shell",
                },
              ],
            },
          }),
        );
        stopOnWeeklyLimit("limit-response-bg");
        yield* flush;
        expect(h.published).toEqual([
          {
            ref: claudeRef,
            stopId: "limit-response-bg",
            resumeAtEpochMs: DUE,
            state: "scheduled",
          },
        ]);

        handle(
          claudeSdkMessageFixture({
            type: "system",
            subtype: "task_progress",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("bg-shell-progress"),
            task_id: "task-bg-shell",
            tool_use_id: "call-bg-shell",
            description: "Running bun test",
            summary: "50% complete",
          }),
        );
        handle(
          claudeSdkMessageFixture({
            type: "system",
            subtype: "task_notification",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("bg-shell-done"),
            task_id: "task-bg-shell",
            tool_use_id: "call-bg-shell",
            status: "completed",
            output_file: "/tmp/bg-shell.out",
            summary: "bun test passed",
          }),
        );
        yield* flush;

        expect(h.published).toEqual([
          {
            ref: claudeRef,
            stopId: "limit-response-bg",
            resumeAtEpochMs: DUE,
            state: "scheduled",
          },
        ]);
        expect(decideClaudeLiveContinuation(session, claudeRef.externalSessionId)).toEqual({
          kind: "allow",
        });

        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([
          { ...claudeRef, sessionScope, resumeMode: "continue_interrupted_turn" },
        ]);
      }),
    );
  });

  test.each([
    { name: "synthetic wake", wake: { isSynthetic: true } },
    { name: "non-query wake", wake: { shouldQuery: false } },
    { name: "display-only", wake: null },
  ] as const)(
    "dispatches and keeps live continuation eligible after an empty $name result",
    async ({ name, wake }) => {
      const h = createHarness();
      const { session, handle, stopOnWeeklyLimit, notificationWake, successResult } =
        createClaudeReplay(h);

      await h.run(
        Effect.gen(function* () {
          handle(
            claudeSdkMessageFixture({
              type: "assistant",
              session_id: claudeRef.externalSessionId,
              uuid: claudeSdkMessageUuidFixture(`pre-limit-${name}`),
              message: {
                id: `pre-limit-${name}`,
                content: [
                  {
                    type: "tool_use",
                    id: `call-pre-${name}`,
                    name: "Bash",
                    input: { command: "echo hi" },
                  },
                ],
                stop_reason: "tool_use",
              },
            }),
          );
          stopOnWeeklyLimit(`limit-response-${name}`);
          yield* flush;

          if (wake) notificationWake(`wake-${name}`, wake);
          successResult(`empty-res-${name}`);
          yield* flush;

          expect(decideClaudeLiveContinuation(session, claudeRef.externalSessionId)).toEqual({
            kind: "allow",
          });

          yield* h.advanceTo(DUE);
          expect(h.resumes).toEqual([
            { ...claudeRef, sessionScope, resumeMode: "continue_interrupted_turn" },
          ]);
        }),
      );
    },
  );
});
