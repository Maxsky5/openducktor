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
import type { UsageLimitRecovery } from "@openducktor/core";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import type { HostError } from "../../effect/host-errors";
import { createLiveWorkflowObservations } from "./live-workflow-observations";
import {
  createUsageLimitAutoResumeService,
  USAGE_LIMIT_RESUME_GRACE_MS,
} from "./usage-limit-auto-resume-service";

export const BASE = Date.parse("2026-11-15T00:00:00.000Z");
export const RESET = BASE + 60 * 60_000;
export const DUE = RESET + USAGE_LIMIT_RESUME_GRACE_MS;

export const claudeRef: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};
export const sessionScope = {
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

export const limitError = (
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

export const turnFailed = (ref = claudeRef): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    ...eventBase(ref),
    type: "session_turn_finished",
    completionId: "result-1",
    messageIds: [],
    turnOutcome: "failed",
  },
});

export const userMessage = (messageId: string): AgentSessionLiveEnvelope => ({
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

export const flush = Effect.gen(function* () {
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

export const createHarness = (
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
