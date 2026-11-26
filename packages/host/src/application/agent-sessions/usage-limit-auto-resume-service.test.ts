import { describe, expect, test } from "bun:test";
import {
  type AgentSessionAuthorizedRoot,
  type AgentSessionControlSummary,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionResumeIntent,
  globalConfigSchema,
  type UsageLimitAutoResume,
} from "@openducktor/contracts";
import type { SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, UsageLimitRecovery, UsageLimitStop } from "@openducktor/core";
import { Deferred, Effect } from "effect";
import { TestClock } from "effect/testing";
import { createClaudeLiveSessionState } from "../../adapters/agent-sessions/claude-live-session-state";
import { decideClaudeLiveContinuation } from "../../adapters/claude/claude-agent-sdk-continuation";
import { handleClaudeSdkMessage } from "../../adapters/claude/claude-agent-sdk-events";
import { createClaudeSession } from "../../adapters/claude/claude-agent-sdk-session-io.test-support";
import {
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "../../adapters/claude/claude-agent-sdk-test-messages";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import { runtimeQueryError } from "../../ports/runtime-query-error";
import { SessionOperationError } from "../../ports/session-operation-error";
import { createLiveWorkflowObservations } from "./live-workflow-observations";
import {
  createUsageLimitAutoResumeService,
  USAGE_LIMIT_RESUME_GRACE_MS,
} from "./usage-limit-auto-resume-service";

const BASE = Date.parse("2026-11-15T00:00:00.000Z");
const RESET = BASE + 60 * 60_000;
const DUE = RESET + USAGE_LIMIT_RESUME_GRACE_MS;

const claudeRef: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};
const sessionScope = {
  kind: "workflow",
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "build",
} as const;

const eventBase = (ref: AgentSessionLiveRef) => ({
  externalSessionId: ref.externalSessionId,
  timestamp: new Date(BASE).toISOString(),
  sessionRef: ref,
});
const limitError = (
  messageId: string,
  resetsAtEpochMs?: number,
  ref = claudeRef,
): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    ...eventBase(ref),
    type: "turn_error",
    messageId,
    message: "Session limit reached.",
    usageLimit: resetsAtEpochMs === undefined ? {} : { resetsAtEpochMs },
  },
});
const turnFailed = (ref = claudeRef): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    ...eventBase(ref),
    type: "session_turn_finished",
    completionId: "result-1",
    messageIds: [],
    turnOutcome: "failed",
  },
});
const userMessage = (messageId: string): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    ...eventBase(claudeRef),
    type: "user_message",
    messageId,
    message: "Continue",
    parts: [],
    state: "read",
  },
});

const flush = Effect.gen(function* () {
  for (let index = 0; index < 20; index += 1)
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
});

/** The answers of the fakes, which each test can change. */
type HarnessState = {
  roots: AgentSessionAuthorizedRoot[];
  live: AgentSessionLiveReadResult;
  /** Runs before each live read answers. */
  liveRead: Effect.Effect<void>;
  resume: () => Effect.Effect<AgentSessionControlSummary, HostError>;
  recovery: UsageLimitRecovery;
};

const createHarness = (
  options: { enabled?: boolean; roots?: AgentSessionAuthorizedRoot[] } = {},
) => {
  const published: Array<UsageLimitAutoResume | null> = [];
  const observations = createLiveWorkflowObservations();
  const resumes: AgentSessionResumeIntent[] = [];
  const failures: string[] = [];
  const readFailures: string[] = [];
  const summary: AgentSessionControlSummary = {
    externalSessionId: claudeRef.externalSessionId,
    runtimeKind: "claude",
    workingDirectory: claudeRef.workingDirectory,
    title: "Build",
    startedAt: new Date(BASE).toISOString(),
    status: "running",
  };
  const state: HarnessState = {
    roots: options.roots ?? [{ ...claudeRef, sessionScope }],
    live: { type: "missing", ref: claudeRef },
    liveRead: Effect.void,
    resume: () => Effect.succeed(summary),
    recovery: { kind: "recovered" },
  };
  const service = createUsageLimitAutoResumeService({
    live: {
      // The live owner publishes only a changed entry.
      publishUsageLimitAutoResume: (ref, entry) =>
        Effect.sync(() => {
          if (observations.autoResume(ref, entry)) published.push(entry);
        }),
      read: () => Effect.suspend(() => state.liveRead).pipe(Effect.as(state.live)),
    },
    resume: (input) =>
      Effect.suspend(() => {
        resumes.push(input);
        return state.resume();
      }),
    readRoots: () => Effect.sync(() => state.roots),
    listRepoPaths: () => Effect.succeed(["/repo"]),
    readUsageLimitRecovery: () => Effect.sync(() => state.recovery),
    settingsConfig: {
      readConfig: () =>
        Effect.succeed(
          globalConfigSchema.parse({
            version: 4,
            chat: { autoResumeAfterUsageLimits: options.enabled ?? true },
          }),
        ),
    },
    onBackgroundFailure: (failure) => Effect.sync(() => failures.push(failure.message)),
    logReadFailure: (message) => Effect.sync(() => readFailures.push(message)),
  });
  const run = (program: Effect.Effect<void, unknown>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(BASE);
        yield* service.initialize();
        yield* program;
      }).pipe(Effect.ensuring(service.dispose()), Effect.provide(TestClock.layer())),
    );
  const stop = (resetsAtEpochMs = RESET) =>
    Effect.gen(function* () {
      service.observe(limitError("limit-1", resetsAtEpochMs));
      service.observe(turnFailed());
      yield* flush;
    });
  const advanceTo = (time: number) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(time);
      yield* flush;
    });
  return {
    advanceTo,
    failures,
    published,
    readFailures,
    resumeSummary: summary,
    resumes,
    run,
    service,
    state,
    stop,
  };
};

describe("usage-limit auto-resume", () => {
  test("resumes the stopped turn after the reset, through the Resume command", async () => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        expect(h.published).toEqual([
          { ref: claudeRef, stopId: "limit-1", resumeAtEpochMs: DUE, state: "scheduled" },
        ]);

        yield* h.advanceTo(DUE - 1_000);
        expect(h.resumes).toEqual([]);

        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([
          { ...claudeRef, sessionScope, resumeMode: "continue_interrupted_turn" },
        ]);
        expect(h.published.slice(1)).toEqual([
          { ref: claudeRef, stopId: "limit-1", resumeAtEpochMs: DUE, state: "resuming" },
          null,
        ]);
      }),
    );
  });

  test("plans the stop when Claude reports the reset after the turn ended", async () => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        h.service.observe(limitError("limit-1"));
        h.service.observe(turnFailed());
        h.service.observe(limitError("limit-1"));
        yield* flush;
        expect(h.published).toEqual([]);

        h.service.observe(limitError("limit-1", RESET));
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled", resumeAtEpochMs: DUE });
      }),
    );
  });

  test.each([
    {
      name: "the runtime reported no reset time",
      setup: () => [limitError("limit-1"), turnFailed()],
    },
    {
      name: "the reset time is not later than the error",
      setup: () => [limitError("limit-1", BASE), turnFailed()],
    },
    {
      name: "the runtime has no auto-resume",
      setup: () => {
        const codex = { ...claudeRef, runtimeKind: "codex" } as const;
        return [limitError("limit-1", RESET, codex), turnFailed(codex)];
      },
    },
  ])("does not plan a resume when $name", async ({ setup }) => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        for (const envelope of setup()) h.service.observe(envelope);
        yield* h.advanceTo(DUE + 60_000);
        expect(h.published).toEqual([]);
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("does not plan a resume for a session that is not a root of an open workspace", async () => {
    const h = createHarness({ roots: [] });
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE);
        expect(h.published).toEqual([]);
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test.each([
    {
      name: "a new user message",
      change: userMessage("user-2"),
    },
    {
      name: "a manual Resume",
      change: {
        type: "session_operation_updated",
        observation: {
          ref: claudeRef,
          kind: "continue",
          pending: true,
          nativeOutcome: "not_issued",
        },
      } satisfies AgentSessionLiveEnvelope,
    },
    {
      name: "a Stop of the user",
      change: {
        type: "session_operation_updated",
        observation: { ref: claudeRef, kind: "stop", pending: true, nativeOutcome: "not_issued" },
      } satisfies AgentSessionLiveEnvelope,
    },
  ])("$name ends the planned resume", async ({ change }) => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        h.service.observe(change);
        yield* h.advanceTo(DUE);
        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("a Stop keeps the stop from a later rebuild of the same history", async () => {
    const h = createHarness();
    const adapter = {
      binding: { runtimeKind: "claude" as const },
      queries: {
        readLatestUsageLimitStop: () =>
          Effect.succeed({ stopId: "limit-1", occurredAtEpochMs: BASE, resetsAtEpochMs: RESET }),
      },
    };
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        h.service.observe({
          type: "session_operation_updated",
          observation: { ref: claudeRef, kind: "stop", pending: true, nativeOutcome: "not_issued" },
        });
        yield* flush;
        h.service.runtimeRegistered(adapter);
        yield* h.advanceTo(DUE);
        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test.each([
    { name: "earlier than", resetsAtEpochMs: BASE - 60_000 },
    { name: "equal to", resetsAtEpochMs: BASE },
  ])("a reset update $name the error removes the planned resume", async ({ resetsAtEpochMs }) => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        h.service.observe(limitError("limit-1", resetsAtEpochMs));
        yield* h.advanceTo(DUE);
        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("does not resume a session that waits for an approval at the reset", async () => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        h.state.live = {
          type: "live",
          session: {
            ref: claudeRef,
            activity: "waiting_for_permission",
            title: "Build",
            startedAt: new Date(BASE).toISOString(),
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          },
        };
        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toBeNull();
      }),
    );
  });

  test("does not resume a session that left the open workspace before the reset", async () => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        h.state.roots = [];
        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toBeNull();
      }),
    );
  });

  test("a cancel removes the planned resume of one stop only", async () => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        const otherScope = { kind: "repository", workspaceId: "workspace-2" } as const;
        const refused = yield* Effect.flip(
          h.service.cancel({ ...claudeRef, sessionScope: otherScope, stopId: "limit-1" }),
        );
        expect(refused.message).toContain("belongs to another task");

        yield* h.service.cancel({ ...claudeRef, sessionScope, stopId: "limit-1" });
        yield* h.advanceTo(DUE);
        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);

        // The same stop cannot come back, but a later stop is eligible again.
        h.service.observe(limitError("limit-1", RESET));
        yield* flush;
        expect(h.published.at(-1)).toBeNull();
        h.service.observe(userMessage("user-3"));
        h.service.observe(limitError("limit-2", DUE + 60_000));
        h.service.observe(turnFailed());
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ stopId: "limit-2", state: "scheduled" });
      }),
    );
  });

  test("the setting holds planned resumes while it is off", async () => {
    const h = createHarness();
    const config = (enabled: boolean) =>
      globalConfigSchema.parse({ version: 4, chat: { autoResumeAfterUsageLimits: enabled } });
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.service.configCommitted(config(false));
        yield* flush;
        expect(h.published.at(-1)).toBeNull();
        yield* h.service.configCommitted(config(true));
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled" });
        yield* h.service.configCommitted(config(false));
        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("waits again while the runtime says that usage is not back", async () => {
    const h = createHarness();
    const later = RESET + 2 * 60 * 60_000;
    h.state.recovery = { kind: "waiting", resetsAtEpochMs: later };
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toMatchObject({
          state: "scheduled",
          resumeAtEpochMs: later + USAGE_LIMIT_RESUME_GRACE_MS,
        });

        h.state.recovery = { kind: "recovered" };
        yield* h.advanceTo(later + USAGE_LIMIT_RESUME_GRACE_MS);
        expect(h.resumes).toHaveLength(1);
      }),
    );
  });

  test("leaves the stop to a manual Resume when the runtime cannot tell", async () => {
    const h = createHarness();
    h.state.recovery = { kind: "unknown" };
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE + 10 * 60_000);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toBeNull();
      }),
    );
  });

  test("shows a failed resume once and does not retry it", async () => {
    const h = createHarness();
    const failure = {
      stage: "continue",
      code: "runtime_unavailable",
      message: "The Claude runtime is not running.",
      nextAction: "Start the runtime, then select Resume.",
    };
    h.state.resume = () =>
      Effect.fail(
        new SessionOperationError(
          {
            ref: claudeRef,
            kind: "continue",
            pending: false,
            nativeOutcome: "not_issued",
            failure,
          },
          new HostOperationError({ operation: "test", message: failure.message }),
        ),
      );
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE);
        expect(h.published.at(-1)).toEqual({
          ref: claudeRef,
          stopId: "limit-1",
          resumeAtEpochMs: DUE,
          state: "failed",
          failure,
        });
        yield* h.advanceTo(DUE + 10 * 60_000);
        expect(h.resumes).toHaveLength(1);
      }),
    );
  });

  test("a later reset during the due-time checks defers the resume", async () => {
    const h = createHarness();
    const read = Deferred.makeUnsafe<void>();
    const later = RESET + 60 * 60_000;
    h.state.liveRead = Deferred.await(read);
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE);
        h.service.observe(limitError("limit-1", later));
        yield* Deferred.succeed(read, undefined);
        yield* flush;
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toEqual({
          ref: claudeRef,
          stopId: "limit-1",
          resumeAtEpochMs: later + USAGE_LIMIT_RESUME_GRACE_MS,
          state: "scheduled",
        });
        yield* h.advanceTo(later + USAGE_LIMIT_RESUME_GRACE_MS);
        expect(h.resumes).toHaveLength(1);
      }),
    );
  });

  test("refuses a cancel after the resume started", async () => {
    const h = createHarness();
    const release = Deferred.makeUnsafe<void>();
    h.state.resume = () => Deferred.await(release).pipe(Effect.as(h.resumeSummary));
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE);
        expect(h.published.at(-1)).toMatchObject({ state: "resuming" });
        const refused = yield* Effect.flip(
          h.service.cancel({ ...claudeRef, sessionScope, stopId: "limit-1" }),
        );
        expect(refused.message).toBe(
          "The resume already started. Use Stop session to stop the turn.",
        );
        yield* Deferred.succeed(release, undefined);
        yield* flush;
        expect(h.published.at(-1)).toBeNull();
      }),
    );
  });

  test("plans the next stop when the resumed turn reaches the limit again", async () => {
    const h = createHarness();
    const release = Deferred.makeUnsafe<void>();
    h.state.resume = () => Deferred.await(release).pipe(Effect.as(h.resumeSummary));
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        yield* h.advanceTo(DUE);
        h.service.observe(limitError("limit-2", DUE + 60 * 60_000));
        h.service.observe(turnFailed());
        yield* Deferred.succeed(release, undefined);
        yield* flush;
        expect(h.published.at(-1)).toEqual({
          ref: claudeRef,
          stopId: "limit-2",
          resumeAtEpochMs: DUE + 60 * 60_000 + USAGE_LIMIT_RESUME_GRACE_MS,
          state: "scheduled",
        });
      }),
    );
  });

  test("rebuilds pending resumes from runtime history after a host start", async () => {
    const h = createHarness();
    const reads: Array<UsageLimitStop | null> = [
      { stopId: "limit-1", occurredAtEpochMs: BASE - 60_000, resetsAtEpochMs: RESET },
    ];
    const adapter = {
      binding: { runtimeKind: "claude" as const },
      queries: {
        readLatestUsageLimitStop: () => Effect.succeed(reads.shift() ?? null),
      },
    };
    await h.run(
      Effect.gen(function* () {
        h.service.runtimeRegistered(adapter);
        yield* flush;
        expect(h.published).toEqual([
          { ref: claudeRef, stopId: "limit-1", resumeAtEpochMs: DUE, state: "scheduled" },
        ]);
        yield* h.advanceTo(DUE);
        expect(h.resumes).toHaveLength(1);
      }),
    );
  });

  test("does not rebuild a stop when the user sends a message during the history read", async () => {
    const h = createHarness();
    const read = Deferred.makeUnsafe<UsageLimitStop | null>();
    const adapter = {
      binding: { runtimeKind: "claude" as const },
      queries: { readLatestUsageLimitStop: () => Deferred.await(read) },
    };
    await h.run(
      Effect.gen(function* () {
        h.service.runtimeRegistered(adapter);
        yield* flush;
        h.service.observe(userMessage("user-2"));
        yield* Deferred.succeed(read, {
          stopId: "limit-1",
          occurredAtEpochMs: BASE - 60_000,
          resetsAtEpochMs: RESET,
        });
        yield* h.advanceTo(DUE);
        expect(h.published).toEqual([]);
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("does not rebuild a stop whose reset passed while the host was off", async () => {
    const h = createHarness();
    const adapter = {
      binding: { runtimeKind: "claude" as const },
      queries: {
        readLatestUsageLimitStop: () =>
          Effect.succeed({
            stopId: "limit-1",
            occurredAtEpochMs: BASE - 120_000,
            resetsAtEpochMs: BASE - 60_000,
          }),
      },
    };
    await h.run(
      Effect.gen(function* () {
        h.service.runtimeRegistered(adapter);
        yield* h.advanceTo(DUE);
        expect(h.published).toEqual([]);
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("logs a failed history read and rebuilds the other sessions", async () => {
    const failingRef = { ...claudeRef, externalSessionId: "session-0" };
    const h = createHarness({
      roots: [
        { ...failingRef, sessionScope },
        { ...claudeRef, sessionScope },
      ],
    });
    const adapter = {
      binding: { runtimeKind: "claude" as const },
      queries: {
        readLatestUsageLimitStop: (ref: AgentSessionLiveRef) =>
          ref.externalSessionId === failingRef.externalSessionId
            ? Effect.fail(
                runtimeQueryError(
                  "read latest usage limit stop",
                  ref,
                  "request_failed",
                  "The runtime query failed. Check the host runtime logs and retry this read.",
                  new Error("Codex app-server request account/rateLimits/read failed", {
                    cause: {
                      code: -32600,
                      message: "chatgpt authentication required to read rate limits",
                    },
                  }),
                ),
              )
            : Effect.succeed({
                stopId: "limit-1",
                occurredAtEpochMs: BASE - 60_000,
                resetsAtEpochMs: RESET,
              }),
      },
    };
    await h.run(
      Effect.gen(function* () {
        h.service.runtimeRegistered(adapter);
        yield* flush;
        expect(h.failures).toEqual([]);
        expect(h.readFailures).toEqual([
          expect.stringContaining("chatgpt authentication required to read rate limits"),
        ]);
        expect(h.published).toEqual([
          { ref: claudeRef, stopId: "limit-1", resumeAtEpochMs: DUE, state: "scheduled" },
        ]);
      }),
    );
  });

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
      const rateLimit: SDKRateLimitEvent = {
        type: "rate_limit_event",
        session_id: claudeRef.externalSessionId,
        uuid: claudeSdkMessageUuidFixture(`rate-limit-${stopId}`),
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "seven_day",
          resetsAt: Math.floor(RESET / 1000),
        },
      };
      handle(rateLimit);
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
    return { session, handle, stopOnWeeklyLimit };
  };

  test("keeps a Claude weekly-limit auto-resume scheduled across an empty notification wake and background completion", async () => {
    const h = createHarness();
    const { session, handle, stopOnWeeklyLimit } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response");
        yield* flush;
        expect(h.published).toEqual([
          { ref: claudeRef, stopId: "limit-response", resumeAtEpochMs: DUE, state: "scheduled" },
        ]);

        handle(
          claudeSdkMessageFixture({
            type: "user",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("notif-wake-user"),
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content: "<task-notification><status>completed</status></task-notification>",
            },
          }),
        );
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
        handle(
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("notif-empty-result"),
            result: "",
          }),
        );
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
    const { handle, stopOnWeeklyLimit } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response-2");
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled" });

        handle(
          claudeSdkMessageFixture({
            type: "user",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("real-wake-user"),
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content: "<task-notification><status>completed</status></task-notification>",
            },
          }),
        );
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
        handle(
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("real-wake-result"),
            result: "Processed the completed background task.",
          }),
        );
        yield* h.advanceTo(DUE);

        expect(h.published.at(-1)).toBeNull();
        expect(h.resumes).toEqual([]);
      }),
    );
  });

  test("keeps a Claude auto-resume pending while an empty notification spans the deadline and dispatches when it ends", async () => {
    const h = createHarness();
    const { session, handle, stopOnWeeklyLimit } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response-span");
        yield* flush;
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled" });

        yield* h.advanceTo(DUE - 1_000);
        handle(
          claudeSdkMessageFixture({
            type: "user",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("span-wake-user"),
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content: "<task-notification><status>completed</status></task-notification>",
            },
          }),
        );
        yield* flush;

        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toMatchObject({
          stopId: "limit-response-span",
          state: "scheduled",
        });

        yield* h.advanceTo(DUE + 1_000);
        handle(
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("span-wake-result"),
            result: "",
          }),
        );
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
    const { handle, stopOnWeeklyLimit } = createClaudeReplay(h);

    await h.run(
      Effect.gen(function* () {
        stopOnWeeklyLimit("limit-response-span-real");
        yield* flush;

        yield* h.advanceTo(DUE - 1_000);
        handle(
          claudeSdkMessageFixture({
            type: "user",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("span-real-wake-user"),
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content: "<task-notification><status>completed</status></task-notification>",
            },
          }),
        );
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
        handle(
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            session_id: claudeRef.externalSessionId,
            uuid: claudeSdkMessageUuidFixture("span-real-wake-result"),
            result: "Handled the background result.",
          }),
        );
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

  test("does not resume a Claude session while a foreground turn is running at the reset", async () => {
    const h = createHarness();
    await h.run(
      Effect.gen(function* () {
        yield* h.stop();
        h.state.live = {
          type: "live",
          session: {
            ref: claudeRef,
            activity: "running",
            foregroundTurnActive: true,
            title: "Build",
            startedAt: new Date(BASE).toISOString(),
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          },
        };
        yield* h.advanceTo(DUE);
        expect(h.resumes).toEqual([]);
        expect(h.published.at(-1)).toMatchObject({ state: "scheduled" });
      }),
    );
  });
});
