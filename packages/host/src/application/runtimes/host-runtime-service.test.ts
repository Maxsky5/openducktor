import { describe, expect, test } from "bun:test";
import {
  type AgentSessionLiveSnapshot,
  type GlobalConfig,
  globalConfigSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber, FiberId } from "effect";
import { createRuntimeAdmissionGate } from "../../adapters/runtimes/runtime-admission";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { createHostRuntimeService } from "./host-runtime-service";

const repoPath = "/repos/alpha";

const configWith = (
  runtimes: Partial<Record<RuntimeKind, { enabled: boolean; executablePath: string }>>,
): GlobalConfig =>
  globalConfigSchema.parse({
    version: 4,
    agentRuntimes: {
      opencode: { enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
      ...runtimes,
    },
    workspaces: {
      alpha: { workspaceId: "alpha", workspaceName: "Alpha", repoPath },
    },
  });

const snapshot = (
  externalSessionId: string,
  activity: AgentSessionLiveSnapshot["activity"],
  runtimeKind: RuntimeKind = "opencode",
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ...overrides,
  ref: { repoPath, runtimeKind, workingDirectory: `${repoPath}/wt`, externalSessionId },
  activity,
  title: `Session ${externalSessionId}`,
  startedAt: "2026-10-03T10:00:00.000Z",
  pendingApprovals: overrides.pendingApprovals ?? [],
  pendingQuestions: overrides.pendingQuestions ?? [],
  contextUsage: null,
});

const createHarness = (initialConfig: GlobalConfig) => {
  let config: GlobalConfig | null = initialConfig;
  let readFailure: HostValidationError | null = null;
  let writeFailure: HostOperationError | null = null;
  /** Holds the settings write open until the test releases it. */
  let writeGate: Deferred.Deferred<void> | null = null;
  let writeStarted = false;
  const writes: GlobalConfig[] = [];
  const events: string[] = [];
  let starts = 0;
  const sessions = new Map<RuntimeKind, AgentSessionLiveSnapshot[]>();
  const failingStarts = new Set<RuntimeKind>();
  const missingExecutables = new Set<string>();
  const starter: RuntimeStarterPort = {
    startRuntime: (input) =>
      Effect.suspend(() => {
        if (failingStarts.has(input.runtimeKind)) {
          return Effect.fail(
            new HostOperationError({ operation: "test.start", message: "missing executable" }),
          );
        }
        const runtimeId = `${input.runtimeKind}-${++starts}`;
        events.push(`start:${runtimeId}`);
        return Effect.succeed({
          runtime: {
            kind: input.runtimeKind,
            runtimeId,
            runtimeRoute: { type: "host_service" as const, identity: runtimeId },
            startedAt: "2026-10-03T10:00:00.000Z",
            descriptor: input.descriptor,
          },
          configuredExecutablePath: input.runtimeKind,
          effectiveExecutablePath: `/bin/${input.runtimeKind}`,
          stop: () => Effect.sync(() => void events.push(`stop:${runtimeId}`)),
        });
      }),
  };
  const admission = createRuntimeAdmissionGate();
  const registry = createRuntimeRegistry({
    admission,
    starter,
    descriptorFor: (kind) => RUNTIME_DESCRIPTORS_BY_KIND[kind],
    onStatusChanged: () => {},
    controlGrace: "20 millis",
  });
  const workspaces: WorkspaceRecord[] = [];
  const prepare = (next: { agentRuntimes: GlobalConfig["agentRuntimes"] }) => {
    const current = config ?? initialConfig;
    return {
      current,
      next: globalConfigSchema.parse({ ...current, agentRuntimes: next.agentRuntimes }),
    };
  };
  const service = createHostRuntimeService({
    hostInstanceId: "host-1",
    registry,
    settingsConfig: {
      readConfig: () =>
        Effect.suspend(() => (readFailure ? Effect.fail(readFailure) : Effect.succeed(config))),
    },
    settingsService: {
      prepareSettingsSnapshot: (next) => Effect.sync(() => prepare(next)),
      saveSettingsSnapshotWith: (next, commit) =>
        Effect.suspend(() => {
          const prepared = prepare(next);
          const nextConfig = prepared.next;
          return commit(
            prepared,
            Effect.suspend(() => {
              writeStarted = true;
              if (writeFailure) return Effect.fail(writeFailure);
              const write = Effect.sync(() => {
                writes.push(nextConfig);
                config = nextConfig;
                return workspaces;
              });
              return writeGate ? Deferred.await(writeGate).pipe(Effect.zipRight(write)) : write;
            }),
          );
        }),
    },
    liveSessions: {
      listRuntimeSessions: (kind) =>
        Effect.sync(() => [...sessions].find(([candidate]) => candidate === kind)?.[1] ?? []),
    },
    toolDiscovery: {
      validateToolPath: (toolId, executablePath) =>
        missingExecutables.has(executablePath)
          ? Effect.fail(
              new HostValidationError({
                field: "executablePath",
                message: `${executablePath} does not exist.`,
              }),
            )
          : Effect.succeed({
              displayLabel: toolId,
              path: executablePath,
              sourceCategory: "provided_path" as const,
            }),
    },
    logError: () => Effect.void,
  });
  return {
    service,
    registry,
    admission,
    events,
    writes,
    sessions,
    failingStarts,
    missingExecutables,
    setReadFailure: (failure: HostValidationError) => {
      readFailure = failure;
    },
    holdWrites: () => {
      writeGate = Deferred.unsafeMake<void>(FiberId.none);
    },
    writeStarted: () => writeStarted,
    setWriteFailure: (failure: HostOperationError) => {
      writeFailure = failure;
    },
  };
};

const waitForState = async (
  registry: ReturnType<typeof createHarness>["registry"],
  kind: RuntimeKind,
  state: string,
) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await Effect.runPromise(registry.status(kind));
    if (status.state === state) return status;
    await Effect.runPromise(Effect.sleep("1 millis"));
  }
  throw new Error(`Runtime ${kind} did not reach ${state}.`);
};

// SAFETY: the fake settings service reads only `agentRuntimes` from the snapshot.
const saveInput = (agentRuntimes: GlobalConfig["agentRuntimes"]) =>
  ({ agentRuntimes }) as Parameters<
    ReturnType<typeof createHostRuntimeService>["saveSettings"]
  >[0]["snapshot"];

describe("host runtime service", () => {
  test("starts enabled kinds at host startup and leaves disabled kinds stopped", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );

    await Effect.runPromise(harness.service.initialize());

    await waitForState(harness.registry, "opencode", "ready");
    const snapshot = await Effect.runPromise(harness.service.snapshot());
    expect(snapshot.hostInstanceId).toBe("host-1");
    expect(snapshot.runtimes.map((status) => [status.kind, status.state])).toEqual([
      ["opencode", "ready"],
      ["codex", "disabled"],
      ["claude", "disabled"],
    ]);
    expect(harness.events).toEqual(["start:opencode-1"]);
  });

  test("records an unreadable configuration as an error for every kind", async () => {
    const harness = createHarness(configWith({}));
    harness.setReadFailure(new HostValidationError({ message: "settings file is invalid" }));

    await Effect.runPromise(harness.service.initialize());

    const snapshot = await Effect.runPromise(harness.service.snapshot());
    expect(snapshot.runtimes.every((status) => status.state === "error")).toBe(true);
    expect(snapshot.runtimes[0]?.failure?.message).toContain("settings file is invalid");
  });

  test("restart groups live sessions by workspace and replaces the runtime after review", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.sessions.set("opencode", [snapshot("s1", "running"), snapshot("s2", "idle")]);

    const impact = await Effect.runPromise(harness.service.restartImpact("opencode"));
    expect(impact.kinds).toEqual([
      {
        kind: "opencode",
        runtimeId: "opencode-1",
        effect: "restart",
        oldExecutablePath: null,
        newExecutablePath: "opencode",
      },
    ]);
    expect(impact.workspaces).toHaveLength(1);
    expect(impact.workspaces[0]).toMatchObject({ workspaceId: "alpha", workspaceName: "Alpha" });
    expect(impact.workspaces[0]?.sessions.map((session) => session.ref.externalSessionId)).toEqual([
      "s1",
      "s2",
    ]);

    const result = await Effect.runPromise(
      harness.service.restart("opencode", impact.confirmation),
    );
    expect(result).toMatchObject({ type: "completed", status: { runtimeId: "opencode-2" } });
    expect(harness.events).toEqual(["start:opencode-1", "stop:opencode-1", "start:opencode-2"]);
  });

  test("restart finishes when an admitted control never finishes", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    const stuck = Effect.runFork(harness.admission.admit("opencode", Effect.never));
    await Effect.runPromise(Effect.yieldNow());

    const impact = await Effect.runPromise(harness.service.restartImpact("opencode"));
    const result = await Effect.runPromise(
      harness.service.restart("opencode", impact.confirmation),
    );

    expect(result).toMatchObject({ type: "completed", status: { runtimeId: "opencode-2" } });
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(stuck)))).toBe(true);
    await expect(
      Effect.runPromise(harness.admission.admit("opencode", Effect.succeed("ok"))),
    ).resolves.toBe("ok");
  });

  test("restart returns the changed impact when new work appears after review", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.sessions.set("opencode", [snapshot("s1", "idle")]);
    const reviewed = await Effect.runPromise(harness.service.restartImpact("opencode"));

    harness.sessions.set("opencode", [snapshot("s1", "running")]);
    const result = await Effect.runPromise(
      harness.service.restart("opencode", reviewed.confirmation),
    );

    expect(result.type).toBe("impact_changed");
    expect(harness.events).toEqual(["start:opencode-1"]);
    await expect(
      Effect.runPromise(harness.service.restart("opencode", reviewed.confirmation)),
    ).resolves.toMatchObject({ type: "impact_changed" });
  });

  test("a disable that stops live sessions needs a confirmation before settings are written", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.sessions.set("opencode", [snapshot("s1", "idle")]);
    const disabled = configWith({}).agentRuntimes;

    const unconfirmed = await Effect.runPromise(
      harness.service.saveSettings({ snapshot: saveInput(disabled) }),
    );
    expect(unconfirmed.type).toBe("runtime_impact_changed");
    expect(harness.writes).toHaveLength(0);
    expect(harness.events).toEqual(["start:opencode-1"]);

    if (unconfirmed.type !== "runtime_impact_changed") throw new Error("expected impact");
    const saved = await Effect.runPromise(
      harness.service.saveSettings({
        snapshot: saveInput(disabled),
        runtimeConfirmation: unconfirmed.impact.confirmation,
      }),
    );
    expect(saved).toMatchObject({
      type: "saved",
      runtimeApplications: [{ kind: "opencode", effect: "stop", outcome: "applied" }],
    });
    expect(harness.writes).toHaveLength(1);
    expect(harness.events).toEqual(["start:opencode-1", "stop:opencode-1"]);
    await expect(Effect.runPromise(harness.registry.status("opencode"))).resolves.toMatchObject({
      state: "disabled",
      enabled: false,
    });
  });

  test("applies each changed kind independently and reports failures after the write", async () => {
    const harness = createHarness(configWith({}));
    await Effect.runPromise(harness.service.initialize());
    harness.failingStarts.add("claude");

    const saved = await Effect.runPromise(
      harness.service.saveSettings({
        snapshot: saveInput(
          configWith({
            opencode: { enabled: true, executablePath: "opencode" },
            claude: { enabled: true, executablePath: "claude" },
          }).agentRuntimes,
        ),
      }),
    );

    expect(saved.type).toBe("saved");
    if (saved.type !== "saved") throw new Error("expected saved");
    expect(saved.runtimeApplications).toEqual([
      { kind: "opencode", effect: "start", outcome: "applied", message: null },
      expect.objectContaining({ kind: "claude", effect: "start", outcome: "failed" }),
    ]);
    expect(harness.writes).toHaveLength(1);
    await expect(Effect.runPromise(harness.registry.status("opencode"))).resolves.toMatchObject({
      state: "ready",
    });
  });

  test("a path change of a disabled kind is saved without a start", async () => {
    const harness = createHarness(configWith({}));
    await Effect.runPromise(harness.service.initialize());

    const preview = configWith({ claude: { enabled: false, executablePath: "/opt/claude" } });
    const saved = await Effect.runPromise(
      harness.service.saveSettings({ snapshot: saveInput(preview.agentRuntimes) }),
    );

    expect(saved).toMatchObject({ type: "saved", runtimeApplications: [] });
    expect(harness.events).toEqual([]);
    await expect(Effect.runPromise(harness.registry.status("claude"))).resolves.toMatchObject({
      state: "disabled",
      configuredExecutablePath: "/opt/claude",
    });
  });

  test("an invalid replacement executable fails the save before any write or stop", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.missingExecutables.add("/missing/opencode");

    const failure = await Effect.runPromise(
      Effect.flip(
        harness.service.saveSettings({
          snapshot: saveInput(
            configWith({ opencode: { enabled: true, executablePath: "/missing/opencode" } })
              .agentRuntimes,
          ),
        }),
      ),
    );

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toBe(
      "Cannot use /missing/opencode for the opencode runtime: /missing/opencode does not exist. Fix the executable path, then save again.",
    );
    expect(harness.writes).toEqual([]);
    expect(harness.events).toEqual(["start:opencode-1"]);
    await expect(
      Effect.runPromise(harness.registry.requireReady("opencode")),
    ).resolves.toMatchObject({ runtimeId: "opencode-1" });
  });

  test("an interrupted settings save releases its runtime reservation", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.holdWrites();

    const saving = Effect.runFork(
      harness.service.saveSettings({
        snapshot: saveInput(
          configWith({ opencode: { enabled: true, executablePath: "/new" } }).agentRuntimes,
        ),
      }),
    );
    while (!harness.writeStarted()) await Effect.runPromise(Effect.yieldNow());
    await Effect.runPromise(Fiber.interrupt(saving));

    const reservation = await Effect.runPromise(harness.registry.reserve(["opencode"]));
    await Effect.runPromise(reservation.release());
    expect(harness.events).toEqual(["start:opencode-1"]);
  });

  test("a failed settings write never stops a runtime", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.setWriteFailure(
      new HostOperationError({ operation: "test.write", message: "disk full" }),
    );

    await expect(
      Effect.runPromise(
        harness.service.saveSettings({ snapshot: saveInput(configWith({}).agentRuntimes) }),
      ),
    ).rejects.toThrow("disk full");

    expect(harness.events).toEqual(["start:opencode-1"]);
    await expect(Effect.runPromise(harness.registry.status("opencode"))).resolves.toMatchObject({
      state: "ready",
    });
  });
  test.each([
    {
      label: "a new turn in a reviewed running session",
      after: snapshot("s1", "running", "opencode", { executionEpisodeId: "turn-2" }),
      changed: true,
    },
    {
      label: "a new pending approval",
      after: snapshot("s1", "waiting_for_permission", "opencode", {
        executionEpisodeId: "turn-1",
        pendingApprovals: [{ requestId: "approval-1", requestType: "runtime_tool", title: "Run" }],
      }),
      changed: true,
    },
    {
      label: "progress in the reviewed turn",
      after: snapshot("s1", "running", "opencode", { executionEpisodeId: "turn-1" }),
      changed: false,
    },
    { label: "the reviewed turn finishing", after: snapshot("s1", "idle"), changed: false },
  ])("restart confirmation after $label", async ({ after, changed }) => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");
    harness.sessions.set("opencode", [
      snapshot("s1", "running", "opencode", { executionEpisodeId: "turn-1" }),
    ]);
    const reviewed = await Effect.runPromise(harness.service.restartImpact("opencode"));

    harness.sessions.set("opencode", [after]);
    const result = await Effect.runPromise(
      harness.service.restart("opencode", reviewed.confirmation),
    );

    expect(result.type).toBe(changed ? "impact_changed" : "completed");
  });
});
