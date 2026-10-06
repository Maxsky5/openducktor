import { describe, expect, test } from "bun:test";
import {
  type AgentSessionLiveSnapshot,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import { Data, Deferred, Effect, Fiber } from "effect";
import { RuntimeSettingsError } from "../errors";
import { planSettingsChange } from "../domain/runtime-lifecycle-plan";
import type { RuntimeDriver, RuntimeDrivers, RuntimeHandle } from "../ports/runtime-driver";
import type { RuntimeSettings, RuntimeStatusChange } from "../ports/runtime-orchestration-ports";
import { createRuntimeOrchestrator } from "./runtime-orchestrator";

class TestError extends Data.TaggedError("TestError")<{ readonly message: string }> {}

const settingsWith = (enabled: Partial<Record<RuntimeKind, string>>): RuntimeSettings => ({
  opencode: { enabled: "opencode" in enabled, executablePath: enabled.opencode ?? "" },
  codex: { enabled: "codex" in enabled, executablePath: enabled.codex ?? "" },
  claude: { enabled: "claude" in enabled, executablePath: enabled.claude ?? "" },
});

const session = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repos/alpha",
    runtimeKind: "opencode",
    workingDirectory: "/repos/alpha",
    externalSessionId,
  },
  activity: "running",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-10-03T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const createHarness = (saved: RuntimeSettings) => {
  let settings: RuntimeSettings | TestError = saved;
  const events: string[] = [];
  const failures: string[] = [];
  const changes: RuntimeStatusChange[] = [];
  const sessions: AgentSessionLiveSnapshot[] = [];
  const invalidExecutables = new Set<string>();
  let starts = 0;
  const driverFor = (kind: RuntimeKind): RuntimeDriver<TestError> => ({
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND[kind],
    start: () =>
      Effect.sync((): RuntimeHandle => {
        const runtimeId = `${kind}-${++starts}`;
        events.push(`start:${runtimeId}`);
        return {
          runtime: {
            kind,
            runtimeId,
            runtimeRoute: { type: "host_service", identity: runtimeId },
            startedAt: "2026-10-03T10:00:00.000Z",
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND[kind],
          },
          configuredExecutablePath: kind,
          effectiveExecutablePath: `/bin/${kind}`,
          stop: () => Effect.sync(() => void events.push(`stop:${runtimeId}`)),
        };
      }),
    probeVersion: () => Effect.succeed("1.0.0"),
    validateExecutable: (path) =>
      invalidExecutables.has(path)
        ? Effect.fail(new TestError({ message: `${path} does not exist.` }))
        : Effect.void,
    stopSession: () => Effect.void,
    probeSession: () => Effect.succeed({ supported: true, hasLiveSession: true }),
  });
  const drivers: RuntimeDrivers<TestError> = {
    opencode: driverFor("opencode"),
    codex: driverFor("codex"),
    claude: driverFor("claude"),
  };
  const orchestrator = createRuntimeOrchestrator({
    drivers,
    settings: {
      readRuntimeSettings: () =>
        Effect.suspend(() =>
          settings instanceof TestError ? Effect.fail(settings) : Effect.succeed(settings),
        ),
      listWorkspaces: () =>
        Effect.succeed([
          { workspaceId: "alpha", workspaceName: "Alpha", repoPath: "/repos/alpha" },
        ]),
    },
    liveSessions: { listAffectedSessions: () => Effect.succeed(sessions) },
    observer: {
      statusChanged: (change) => changes.push(change),
      backgroundFailure: (message) => failures.push(message),
    },
  });
  const waitForReady = async (kind: RuntimeKind) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await Effect.runPromise(orchestrator.status(kind));
      if (status.state === "ready") return status;
      await Effect.runPromise(Effect.sleep("1 millis"));
    }
    throw new Error(`The ${kind} runtime did not become ready.`);
  };
  return {
    orchestrator,
    events,
    failures,
    changes,
    sessions,
    invalidExecutables,
    waitForReady,
    failSettings: (message: string) => {
      settings = new TestError({ message });
    },
  };
};

describe("runtime orchestrator", () => {
  test("starts enabled kinds at startup and reports each status change with its previous state", async () => {
    const harness = createHarness(settingsWith({ opencode: "opencode" }));

    await Effect.runPromise(harness.orchestrator.initialize());
    await harness.waitForReady("opencode");

    expect(harness.events).toEqual(["start:opencode-1"]);
    expect(
      harness.changes.map(({ status, previousState }) => [
        status.kind,
        previousState,
        status.state,
      ]),
    ).toEqual([
      ["codex", undefined, "disabled"],
      ["claude", undefined, "disabled"],
      ["opencode", undefined, "starting"],
      ["opencode", "starting", "ready"],
    ]);
  });

  test("records an unreadable settings source as a configuration failure of every kind", async () => {
    const harness = createHarness(settingsWith({}));
    harness.failSettings("The settings file is invalid.");

    await Effect.runPromise(harness.orchestrator.initialize());

    const statuses = await Effect.runPromise(harness.orchestrator.statuses());
    expect(statuses.map((status) => [status.state, status.failure?.phase])).toEqual([
      ["error", "configuration"],
      ["error", "configuration"],
      ["error", "configuration"],
    ]);
  });

  const reviewThenRestart = async (
    before: ReadonlyArray<AgentSessionLiveSnapshot>,
    after: ReadonlyArray<AgentSessionLiveSnapshot>,
  ) => {
    const harness = createHarness(settingsWith({ opencode: "opencode" }));
    await Effect.runPromise(harness.orchestrator.initialize());
    await harness.waitForReady("opencode");
    harness.sessions.push(...before);
    const reviewed = await Effect.runPromise(harness.orchestrator.restartImpact("opencode"));
    harness.sessions.splice(0, harness.sessions.length, ...after);
    const result = await Effect.runPromise(
      harness.orchestrator.restart("opencode", reviewed.confirmation),
    );
    return { harness, reviewed, result };
  };

  const runningTurn = session("s1", { executionEpisodeId: "turn-1" });

  test.each([
    {
      label: "progress in the reviewed turn",
      after: session("s1", { executionEpisodeId: "turn-1", title: "Renamed" }),
    },
    { label: "the reviewed turn finishing", after: session("s1", { activity: "idle" }) },
  ])("restart keeps a confirmation after $label", async ({ after }) => {
    const { harness, result } = await reviewThenRestart([runningTurn], [after]);

    expect(result).toMatchObject({ type: "completed", status: { state: "ready" } });
    expect(harness.events).toEqual(["start:opencode-1", "stop:opencode-1", "start:opencode-2"]);
  });

  test.each([
    { label: "a new running session", before: [], after: session("s1") },
    {
      label: "a reviewed idle session starting a turn",
      before: [session("s1", { activity: "idle" })],
      after: session("s1"),
    },
    {
      label: "a new turn in a reviewed running session",
      before: [runningTurn],
      after: session("s1", { executionEpisodeId: "turn-2" }),
    },
    {
      label: "a new pending approval",
      before: [runningTurn],
      after: session("s1", {
        activity: "waiting_for_permission",
        executionEpisodeId: "turn-1",
        pendingApprovals: [{ requestId: "approval-1", requestType: "runtime_tool", title: "Run" }],
      }),
    },
  ])("restart needs a new review after $label", async ({ before, after }) => {
    const { harness, reviewed, result } = await reviewThenRestart(before, [after]);
    if (result.type !== "impact_changed") throw new Error("The impact must change.");
    expect(result.impact.workspaces[0]?.workspaceName).toBe("Alpha");
    expect(harness.events).toEqual(["start:opencode-1"]);

    // A confirmation is single-use, even when the work returns to the reviewed state.
    harness.sessions.splice(0, harness.sessions.length, ...before);
    const reused = await Effect.runPromise(
      harness.orchestrator.restart("opencode", reviewed.confirmation),
    );
    if (reused.type !== "impact_changed") throw new Error("A used confirmation must fail.");

    const restarted = await Effect.runPromise(
      harness.orchestrator.restart("opencode", reused.impact.confirmation),
    );
    expect(restarted).toMatchObject({ type: "completed", status: { state: "ready" } });
    expect(harness.events).toEqual(["start:opencode-1", "stop:opencode-1", "start:opencode-2"]);
  });

  test("checks a settings change against its reservation and its executables", async () => {
    const harness = createHarness(settingsWith({}));
    const enable = planSettingsChange(settingsWith({}), settingsWith({ codex: "/bin/codex" }));
    harness.invalidExecutables.add("/bin/codex");

    const outcome = await Effect.runPromise(
      harness.orchestrator.withSettingsChange([], (session) =>
        Effect.flip(session.check(enable, undefined)),
      ),
    );
    expect(outcome).toBeInstanceOf(RuntimeSettingsError);
    expect(outcome.message).toBe(
      "Runtime settings changed while this save was in progress. Save again.",
    );

    const invalid = await Effect.runPromise(
      harness.orchestrator.withSettingsChange(["codex"], (session) =>
        Effect.flip(session.check(enable, undefined)),
      ),
    );
    expect(invalid).toMatchObject({
      field: "agentRuntimes.codex.executablePath",
      message:
        "Cannot use /bin/codex for the codex runtime: /bin/codex does not exist. Fix the executable path, then save again.",
    });

    harness.invalidExecutables.clear();
    const applied = await Effect.runPromise(
      harness.orchestrator.withSettingsChange(["codex"], (session) =>
        Effect.gen(function* () {
          expect(yield* session.check(enable, undefined)).toEqual({ type: "accepted" });
          return yield* session.apply(enable);
        }),
      ),
    );
    expect(applied).toEqual([
      { kind: "codex", effect: "start", outcome: "applied", message: null },
    ]);
  });

  test("an interrupted settings change releases its reservation", async () => {
    const harness = createHarness(settingsWith({ opencode: "opencode" }));
    const entered = Deferred.makeUnsafe<void>();
    const changing = Effect.runFork(
      harness.orchestrator.withSettingsChange(["opencode", "codex"], () =>
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      ),
    );
    await Effect.runPromise(Deferred.await(entered));
    const reserveAgain = harness.orchestrator.withSettingsChange(["opencode", "codex"], () =>
      Effect.succeed("reserved"),
    );
    await expect(Effect.runPromise(reserveAgain)).rejects.toThrow("already running");

    await Effect.runPromise(Fiber.interrupt(changing));

    await expect(Effect.runPromise(reserveAgain)).resolves.toBe("reserved");
  });

  test("probes a session only through the driver of a ready runtime", async () => {
    const harness = createHarness(settingsWith({ claude: "claude" }));
    const target = {
      runtimeKind: "claude" as const,
      externalSessionId: "s",
      workingDirectory: "/w",
    };

    await expect(Effect.runPromise(harness.orchestrator.probeSession(target))).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });
    await Effect.runPromise(harness.orchestrator.initialize());
    await harness.waitForReady("claude");
    await expect(Effect.runPromise(harness.orchestrator.probeSession(target))).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });
  });
});
