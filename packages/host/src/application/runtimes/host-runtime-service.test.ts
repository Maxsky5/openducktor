import { describe, expect, test } from "bun:test";
import {
  type AgentSessionLiveSnapshot,
  type GlobalConfig,
  globalConfigSchema,
  type RuntimeKind,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import {
  createRuntimeAdmissionGate,
  createRuntimeOrchestrator,
} from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import {
  createTestRuntimeDrivers,
  testRuntimeHandle,
} from "../../test-support/runtime-orchestrator-test-support";
import {
  createLiveSessionInventory,
  createRuntimeAdmissionPort,
  createRuntimeRegistryPort,
  createRuntimeSettingsSource,
} from "./host-runtime-ports";
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
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath,
    runtimeKind: "opencode",
    workingDirectory: `${repoPath}/wt`,
    externalSessionId,
  },
  activity,
  title: `Session ${externalSessionId}`,
  startedAt: "2026-10-03T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

const createHarness = (initialConfig: GlobalConfig) => {
  let config: GlobalConfig | null = initialConfig;
  let writeFailure: HostOperationError | null = null;
  const writes: GlobalConfig[] = [];
  const events: string[] = [];
  let starts = 0;
  const sessions = new Map<RuntimeKind, AgentSessionLiveSnapshot[]>();
  const failingStarts = new Set<RuntimeKind>();
  const missingExecutables = new Set<string>();
  const drivers = createTestRuntimeDrivers(
    (kind) =>
      Effect.suspend(() => {
        if (failingStarts.has(kind)) {
          return Effect.fail(
            new HostOperationError({ operation: "test.start", message: "missing executable" }),
          );
        }
        const runtimeId = `${kind}-${++starts}`;
        events.push(`start:${runtimeId}`);
        return Effect.succeed(testRuntimeHandle(kind, runtimeId, events));
      }),
    {
      validateExecutable: (executablePath) =>
        missingExecutables.has(executablePath)
          ? Effect.fail(
              new HostValidationError({
                field: "executablePath",
                message: `${executablePath} does not exist.`,
              }),
            )
          : Effect.void,
    },
  );
  const settingsConfig = {
    readConfig: () => Effect.sync(() => config),
  };
  const gate = createRuntimeAdmissionGate();
  const orchestrator = createRuntimeOrchestrator({
    drivers,
    settings: createRuntimeSettingsSource(settingsConfig),
    liveSessions: createLiveSessionInventory({
      listRuntimeSessions: (kind) =>
        Effect.sync(() => [...sessions].find(([candidate]) => candidate === kind)?.[1] ?? []),
    }),
    observer: { statusChanged: () => {}, backgroundFailure: () => {} },
    admission: gate,
  });
  const registry = createRuntimeRegistryPort(orchestrator);
  const admission = createRuntimeAdmissionPort(gate);
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
    orchestrator,
    settingsService: {
      prepareSettingsSnapshot: (next) => Effect.sync(() => prepare(next)),
      saveSettingsSnapshotWith: (next, commit) =>
        Effect.suspend(() => {
          const prepared = prepare(next);
          const nextConfig = prepared.next;
          return commit(
            prepared,
            Effect.suspend(() => {
              if (writeFailure) return Effect.fail(writeFailure);
              return Effect.sync(() => {
                writes.push(nextConfig);
                config = nextConfig;
                return workspaces;
              });
            }),
          );
        }),
    },
  });
  return {
    service,
    orchestrator,
    registry,
    admission,
    events,
    writes,
    sessions,
    failingStarts,
    missingExecutables,
    clearConfig: () => {
      config = null;
    },
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

  test("records missing runtime settings as an error for every kind", async () => {
    const harness = createHarness(configWith({}));
    harness.clearConfig();

    await Effect.runPromise(harness.service.initialize());

    const snapshot = await Effect.runPromise(harness.service.snapshot());
    expect(snapshot.runtimes.map((status) => status.state)).toEqual(["error", "error", "error"]);
    for (const status of snapshot.runtimes) {
      expect(status.failure?.message).toEndWith(
        "Runtime settings are not initialized. Open Settings > Runtimes.",
      );
    }
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

  test("rejects a control with a host resource error while a lifecycle action holds the kind", async () => {
    const harness = createHarness(
      configWith({ opencode: { enabled: true, executablePath: "opencode" } }),
    );
    await Effect.runPromise(harness.service.initialize());
    await waitForState(harness.registry, "opencode", "ready");

    const failure = await Effect.runPromise(
      harness.orchestrator.withSettingsChange(["opencode"], () =>
        Effect.flip(harness.admission.admit("opencode", Effect.succeed("ok"))),
      ),
    );

    expect(failure).toBeInstanceOf(HostResourceError);
    expect(failure).toMatchObject({
      resource: "agent_runtime",
      operation: "runtime.admit",
      details: { runtimeKind: "opencode", state: "ready" },
    });
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
});
