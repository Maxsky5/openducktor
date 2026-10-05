import { describe, expect, test } from "bun:test";
import {
  type HostRuntimeStatus,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import { Cause, Data, Deferred, type Duration, Effect, Exit, Fiber } from "effect";
import type { RuntimeDrivers, RuntimeHandle, RuntimeStartContext } from "../ports/runtime-driver";
import { createRuntimeAdmissionGate } from "./runtime-admission-gate";
import { createRuntimeRegistry } from "./runtime-registry";
import type { RuntimeLifecycleRequest } from "./runtime-slot-lifecycle";

class HostOperationError extends Data.TaggedError("HostOperationError")<{
  readonly operation: string;
  readonly message: string;
}> {}

type RuntimeStartInput = RuntimeStartContext & {
  runtimeKind: RuntimeKind;
  descriptor: (typeof RUNTIME_DESCRIPTORS_BY_KIND)[RuntimeKind];
};

type StarterCall = { input: RuntimeStartInput; runtimeId: string };

const createHarness = (
  startRuntime?: (
    input: RuntimeStartInput,
    call: number,
  ) => Effect.Effect<RuntimeHandle, HostOperationError>,
  probeVersion: (kind: RuntimeKind) => Effect.Effect<string | null> = (kind) =>
    Effect.succeed(`${kind} 1.0.0`),
  controlGrace: Duration.DurationInput = "10 seconds",
) => {
  const statuses: HostRuntimeStatus[] = [];
  const events: string[] = [];
  const calls: StarterCall[] = [];
  const admission = createRuntimeAdmissionGate();
  const defaultStart = (input: RuntimeStartInput, call: number) =>
    Effect.sync((): RuntimeHandle => {
      const runtimeId = `${input.runtimeKind}-${call}`;
      events.push(`start:${runtimeId}`);
      return {
        runtime: {
          kind: input.runtimeKind,
          runtimeId,
          runtimeRoute: { type: "host_service", identity: runtimeId },
          startedAt: "2026-10-03T10:00:00.000Z",
          descriptor: input.descriptor,
        },
        configuredExecutablePath: input.runtimeKind,
        effectiveExecutablePath: `/bin/${input.runtimeKind}`,
        stop: () => Effect.sync(() => void events.push(`stop:${runtimeId}`)),
      };
    });
  const startWithCall = (input: RuntimeStartInput) => {
    const call = calls.length + 1;
    calls.push({ input, runtimeId: `${input.runtimeKind}-${call}` });
    return (startRuntime ?? defaultStart)(input, call);
  };
  const driverFor = (kind: RuntimeKind) => {
    const descriptor = RUNTIME_DESCRIPTORS_BY_KIND[kind];
    return {
      descriptor,
      start: (context: RuntimeStartContext) =>
        startWithCall({ ...context, runtimeKind: kind, descriptor }),
      probeVersion: () => probeVersion(kind),
      validateExecutable: () => Effect.void,
      stopSession: () => Effect.void,
      probeSession: () => Effect.succeed({ supported: true, hasLiveSession: true }),
    };
  };
  const drivers: RuntimeDrivers<HostOperationError> = {
    opencode: driverFor("opencode"),
    codex: driverFor("codex"),
    claude: driverFor("claude"),
  };
  const registry = createRuntimeRegistry({
    admission,
    drivers,
    onStatusChanged: (change) => statuses.push(change.status),
    now: () => new Date(),
    controlGrace,
  });
  return { registry, admission, statuses, events, calls, defaultStart };
};

const request = (
  action: "start" | "replace" | "stop",
  overrides: Partial<RuntimeLifecycleRequest> = {},
): RuntimeLifecycleRequest => ({
  trigger: "host_startup",
  enabled: action !== "stop",
  configuredExecutablePath: "opencode",
  ...overrides,
});

const apply = (
  registry: ReturnType<typeof createHarness>["registry"],
  kind: RuntimeKind,
  lifecycle: RuntimeLifecycleRequest,
) =>
  Effect.acquireUseRelease(
    registry.reserve([kind]),
    (reservation) => reservation.apply(kind, lifecycle),
    (reservation) => reservation.release(),
  );

describe("runtime registry lifecycle", () => {
  test("starts one shared runtime per kind and opens admission after the action", async () => {
    const { registry, admission, statuses } = createHarness();
    await expect(Effect.runPromise(registry.requireReady("opencode"))).rejects.toThrow(
      "The OpenCode runtime is disabled. Enable it in Settings > Runtimes.",
    );

    const outcome = await Effect.runPromise(apply(registry, "opencode", request("start")));

    expect(outcome.type).toBe("completed");
    expect(outcome.status).toMatchObject({
      kind: "opencode",
      state: "ready",
      runtimeId: "opencode-1",
      effectiveExecutablePath: "/bin/opencode",
      version: "opencode 1.0.0",
      failure: null,
    });
    expect(statuses.map((status) => status.state)).toEqual(["starting", "ready"]);
    expect(statuses.map((status) => status.revision)).toEqual([1, 2]);
    await expect(
      Effect.runPromise(admission.admit("opencode", Effect.succeed("admitted"))),
    ).resolves.toBe("admitted");
    await expect(Effect.runPromise(registry.requireReady("opencode"))).resolves.toMatchObject({
      runtimeId: "opencode-1",
    });
  });

  test("records a start failure with the next action and no running resource", async () => {
    const { registry, admission } = createHarness(() =>
      Effect.fail(
        new HostOperationError({ operation: "test.start", message: "executable not found" }),
      ),
    );

    const outcome = await Effect.runPromise(apply(registry, "codex", request("start")));

    expect(outcome.type).toBe("failed");
    expect(outcome.status.state).toBe("error");
    expect(outcome.status.runtimeId).toBeNull();
    expect(outcome.status.failure).toMatchObject({ trigger: "host_startup", phase: "start" });
    expect(outcome.status.failure?.message).toContain("executable not found");
    expect(outcome.status.failure?.nextAction).toContain("Settings > Runtimes");
    await expect(
      Effect.runPromise(admission.admit("codex", Effect.succeed("admitted"))),
    ).rejects.toThrow("executable not found");
  });

  test("allows one lifecycle action for a kind at a time", async () => {
    const { registry } = createHarness();
    const reservation = await Effect.runPromise(registry.reserve(["claude"]));

    await expect(Effect.runPromise(registry.reserve(["claude"]))).rejects.toThrow(
      "A lifecycle action is already running for the Claude runtime.",
    );
    await expect(Effect.runPromise(registry.reserve(["codex"]))).resolves.toBeDefined();
    await Effect.runPromise(reservation.release());
    await expect(Effect.runPromise(registry.reserve(["claude"]))).resolves.toBeDefined();
  });

  test("stops the old resource before it starts the replacement", async () => {
    const { registry, events, statuses } = createHarness();
    await Effect.runPromise(apply(registry, "opencode", request("start")));

    const outcome = await Effect.runPromise(
      apply(registry, "opencode", request("replace", { trigger: "restart" })),
    );

    expect(events).toEqual(["start:opencode-1", "stop:opencode-1", "start:opencode-2"]);
    expect(outcome.status).toMatchObject({ state: "ready", runtimeId: "opencode-2" });
    expect(statuses.slice(2).map((status) => status.state)).toEqual([
      "restarting",
      "restarting",
      "ready",
    ]);
  });

  test("keeps a resource that failed to stop and never starts a second instance", async () => {
    let stopAttempts = 0;
    const harness = createHarness((input, call) =>
      harness.defaultStart(input, call).pipe(
        Effect.map((handle) => ({
          ...handle,
          stop: () =>
            Effect.suspend(() => {
              stopAttempts += 1;
              return stopAttempts === 1
                ? Effect.fail(new HostOperationError({ operation: "test.stop", message: "busy" }))
                : handle.stop();
            }),
        })),
      ),
    );
    const { registry, events } = harness;
    const target = {
      runtimeKind: "codex" as const,
      externalSessionId: "s",
      workingDirectory: "/w",
    };
    await Effect.runPromise(apply(registry, "codex", request("start")));
    // A ready runtime answers through its driver.
    await expect(Effect.runPromise(registry.probeSession(target))).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });

    const failed = await Effect.runPromise(
      apply(registry, "codex", request("stop", { trigger: "settings" })),
    );
    expect(failed.type).toBe("failed");
    expect(failed.status).toMatchObject({ state: "error", runtimeId: "codex-1", enabled: false });
    expect(failed.status.failure).toMatchObject({ phase: "stop" });
    expect(failed.status.failure?.nextAction).toContain("retry applying the saved settings");
    // The process may still run its sessions, so the probe cannot report them as stopped.
    const probeFailure = await Effect.runPromise(Effect.flip(registry.probeSession(target)));
    expect(probeFailure).toMatchObject({
      _tag: "RuntimeUnavailableError",
      operation: "probe_session",
      runtimeKind: "codex",
      state: "error",
    });
    expect(probeFailure.message).toContain("retry applying the saved settings");

    const retried = await Effect.runPromise(
      apply(registry, "codex", request("stop", { trigger: "restart" })),
    );
    expect(retried.status).toMatchObject({ state: "disabled", runtimeId: null, failure: null });
    expect(events).toEqual(["start:codex-1", "stop:codex-1"]);
    // Without a process, no session can run.
    await expect(Effect.runPromise(registry.probeSession(target))).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });
  });

  test("reports a crash, adds a later cleanup failure, and ignores a released generation", async () => {
    const { registry, calls, admission } = createHarness();
    await Effect.runPromise(apply(registry, "opencode", request("start")));
    const firstExit = calls[0]?.input.onRuntimeExit;

    firstExit?.("process exited with code 1");
    const crashed = await Effect.runPromise(registry.status("opencode"));
    expect(crashed.state).toBe("error");
    expect(crashed.failure).toMatchObject({ trigger: "crash", phase: "run" });
    expect(crashed.failure?.nextAction).toBe("Restart the runtime from Diagnostics.");
    await expect(Effect.runPromise(admission.admit("opencode", Effect.void))).rejects.toThrow(
      "stopped unexpectedly",
    );

    calls[0]?.input.onRuntimeCleanupFailed("process still alive");
    await expect(Effect.runPromise(registry.status("opencode"))).resolves.toMatchObject({
      state: "error",
      failure: {
        message:
          "The OpenCode runtime stopped unexpectedly: process exited with code 1\nCleanup failed: process still alive",
      },
    });

    await Effect.runPromise(
      apply(registry, "opencode", request("replace", { trigger: "restart" })),
    );
    firstExit?.("late exit");
    await expect(Effect.runPromise(registry.status("opencode"))).resolves.toMatchObject({
      state: "ready",
      runtimeId: "opencode-2",
    });
  });

  test("waits for admitted controls before a lifecycle action owns the kind", async () => {
    const { registry, admission } = createHarness();
    await Effect.runPromise(apply(registry, "claude", request("start")));
    const release = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const control = Effect.runFork(admission.admit("claude", Deferred.await(release)));
    await Effect.runPromise(Effect.yieldNow());

    const reserving = Effect.runFork(registry.reserve(["claude"]));
    await Effect.runPromise(Effect.yieldNow());
    expect(reserving.unsafePoll()).toBeNull();
    await expect(Effect.runPromise(admission.admit("claude", Effect.void))).rejects.toThrow(
      "applying a lifecycle action",
    );

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(control));
    const reservation = await Effect.runPromise(Fiber.join(reserving));
    await Effect.runPromise(reservation.release());
    await expect(Effect.runPromise(admission.admit("claude", Effect.succeed(1)))).resolves.toBe(1);
  });

  test("shutdown interrupts a pending start and stops ready runtimes", async () => {
    const started = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const harness = createHarness((input, call) =>
      input.runtimeKind === "codex"
        ? Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never))
        : harness.defaultStart(input, call),
    );
    const { registry, events } = harness;
    await Effect.runPromise(apply(registry, "opencode", request("start")));
    const pending = Effect.runFork(apply(registry, "codex", request("start")));
    await Effect.runPromise(Deferred.await(started));

    const stopped = await Effect.runPromise(registry.stopAll());

    expect(stopped.map((runtime) => runtime.runtimeId)).toEqual(["opencode-1"]);
    expect(events).toEqual(["start:opencode-1", "stop:opencode-1"]);
    const pendingExit = await Effect.runPromise(Fiber.await(pending));
    expect(Exit.isSuccess(pendingExit) && pendingExit.value.status.state).toBe("disabled");
    await expect(Effect.runPromise(registry.reserve(["opencode"]))).rejects.toThrow(
      "OpenDucktor is shutting down.",
    );
    await expect(Effect.runPromise(registry.requireReady("opencode"))).rejects.toThrow(
      "OpenDucktor is shutting down. The OpenCode runtime does not accept work. Start OpenDucktor again.",
    );
  });

  test("records a configuration failure for a kind without starting it", async () => {
    const { registry, calls } = createHarness();
    await Effect.runPromise(registry.recordConfigurationFailure("claude", "invalid JSON"));

    const status = await Effect.runPromise(registry.status("claude"));
    expect(status.state).toBe("error");
    expect(status.failure).toMatchObject({ phase: "configuration", trigger: "host_startup" });
    expect(calls).toEqual([]);
  });
  test("a restart that is stopping when shutdown begins never starts a replacement", async () => {
    const stopEntered = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const stopRelease = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const harness = createHarness((input, call) =>
      harness.defaultStart(input, call).pipe(
        Effect.map((handle) => ({
          ...handle,
          stop: () =>
            Deferred.succeed(stopEntered, undefined).pipe(
              Effect.zipRight(Deferred.await(stopRelease)),
              Effect.zipRight(handle.stop()),
            ),
        })),
      ),
    );
    const { registry, events } = harness;
    await Effect.runPromise(apply(registry, "opencode", request("start")));
    const restart = Effect.runFork(
      apply(registry, "opencode", request("replace", { trigger: "restart" })),
    );
    await Effect.runPromise(Deferred.await(stopEntered));
    // The old process still runs while it stops, so a probe gets the state and next action.
    const target = {
      runtimeKind: "opencode" as const,
      externalSessionId: "s",
      workingDirectory: "/w",
    };
    await expect(
      Effect.runPromise(Effect.flip(registry.probeSession(target))),
    ).resolves.toMatchObject({
      operation: "probe_session",
      state: "restarting",
      message: "The OpenCode runtime is restarting. Wait for the runtime to become ready.",
    });

    const shutdown = Effect.runFork(registry.stopAll());
    await Effect.runPromise(Effect.yieldNow());
    expect(shutdown.unsafePoll()).toBeNull();
    await Effect.runPromise(Deferred.succeed(stopRelease, undefined));

    await Effect.runPromise(Fiber.join(shutdown));
    const outcome = await Effect.runPromise(Fiber.join(restart));
    expect(outcome.status).toMatchObject({ state: "disabled", runtimeId: null });
    expect(events).toEqual(["start:opencode-1", "stop:opencode-1"]);
    await expect(Effect.runPromise(registry.requireReady("opencode"))).rejects.toThrow();
  });
  test("keeps a failed startup cleanup and retries it before the next start", async () => {
    let cleanupAttempts = 0;
    let failStart = true;
    const order: string[] = [];
    const harness = createHarness((input, call) => {
      if (!failStart) return harness.defaultStart(input, call);
      input.ownCleanup(
        Effect.suspend(() => {
          cleanupAttempts += 1;
          order.push(`cleanup:${cleanupAttempts}`);
          return cleanupAttempts === 1
            ? Effect.fail(new HostOperationError({ operation: "test.cleanup", message: "alive" }))
            : Effect.void;
        }),
      );
      return Effect.fail(
        new HostOperationError({ operation: "test.start", message: "adapter setup failed" }),
      );
    });
    const { registry, events } = harness;

    const failed = await Effect.runPromise(apply(registry, "opencode", request("start")));
    expect(failed.status.state).toBe("error");
    expect(failed.status.failure?.message).toContain("adapter setup failed");
    expect(failed.status.failure?.message).toContain(
      "Cleanup of the partly started runtime failed",
    );
    expect(failed.status.failure?.message.match(/[Cc]leanup/g)).toHaveLength(1);
    expect(cleanupAttempts).toBe(1);

    failStart = false;
    const restarted = await Effect.runPromise(
      apply(registry, "opencode", request("replace", { trigger: "restart" })),
    );
    expect(restarted.status).toMatchObject({ state: "ready", runtimeId: "opencode-2" });
    expect(order).toEqual(["cleanup:1", "cleanup:2"]);
    expect(events).toEqual(["start:opencode-2"]);
  });

  test("shutdown retries an owned startup cleanup", async () => {
    let cleanupAttempts = 0;
    const harness = createHarness((input) => {
      input.ownCleanup(
        Effect.suspend(() => {
          cleanupAttempts += 1;
          return cleanupAttempts === 1
            ? Effect.fail(new HostOperationError({ operation: "test.cleanup", message: "alive" }))
            : Effect.void;
        }),
      );
      return Effect.fail(new HostOperationError({ operation: "test.start", message: "boom" }));
    });
    await Effect.runPromise(apply(harness.registry, "codex", request("start")));

    await Effect.runPromise(harness.registry.stopAll());

    expect(cleanupAttempts).toBe(2);
    await expect(Effect.runPromise(harness.registry.status("codex"))).resolves.toMatchObject({
      state: "disabled",
    });
  });

  test("a runtime cannot become ready after shutdown begins during the version read", async () => {
    const versionRead = Deferred.unsafeMake<string | null>(Effect.runSync(Effect.fiberId));
    const { registry, statuses, events } = createHarness(undefined, () =>
      Deferred.await(versionRead),
    );
    const start = Effect.runPromise(apply(registry, "opencode", request("start")));
    for (let attempt = 0; attempt < 50 && events.length === 0; attempt += 1) {
      await Effect.runPromise(Effect.yieldNow());
    }
    expect(events).toEqual(["start:opencode-1"]);

    const shutdown = Effect.runPromise(registry.stopAll());
    await Effect.runPromise(Effect.yieldNow());
    await Effect.runPromise(Deferred.succeed(versionRead, "opencode 1.0.0"));

    await expect(start).resolves.toMatchObject({ type: "failed" });
    await shutdown;
    expect(statuses.map((status) => status.state)).not.toContain("ready");
    expect(events).toEqual(["start:opencode-1", "stop:opencode-1"]);
    await expect(Effect.runPromise(registry.status("opencode"))).resolves.toMatchObject({
      state: "disabled",
    });
  });

  test("an interrupted reservation releases its kinds", async () => {
    const { registry, admission } = createHarness();
    await Effect.runPromise(apply(registry, "claude", request("start")));
    const release = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const control = Effect.runFork(admission.admit("claude", Deferred.await(release)));
    await Effect.runPromise(Effect.yieldNow());

    const reserving = Effect.runFork(registry.reserve(["claude"]));
    await Effect.runPromise(Effect.yieldNow());
    await Effect.runPromise(Fiber.interrupt(reserving));
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(control));

    await expect(Effect.runPromise(registry.requireReady("claude"))).resolves.toMatchObject({
      runtimeId: "claude-1",
    });
    const reservation = await Effect.runPromise(registry.reserve(["claude"]));
    await Effect.runPromise(reservation.release());
  });

  test("shutdown waits for an admitted control before it stops the runtime", async () => {
    const { registry, admission, events } = createHarness();
    await Effect.runPromise(apply(registry, "claude", request("start")));
    const release = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const control = Effect.runFork(
      admission.admit(
        "claude",
        Deferred.await(release).pipe(Effect.tap(() => Effect.sync(() => events.push("control")))),
      ),
    );
    await Effect.runPromise(Effect.yieldNow());

    const shutdown = Effect.runPromise(registry.stopAll());
    await Effect.runPromise(Effect.yieldNow());
    expect(events).toEqual(["start:claude-1"]);
    await expect(Effect.runPromise(admission.admit("claude", Effect.void))).rejects.toThrow();

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await shutdown;
    await Effect.runPromise(Fiber.join(control));
    expect(events).toEqual(["start:claude-1", "control", "stop:claude-1"]);
  });

  test("shutdown cancels an admitted control that outlasts the grace period", async () => {
    const { registry, admission, events } = createHarness(undefined, undefined, "20 millis");
    await Effect.runPromise(apply(registry, "claude", request("start")));
    const control = Effect.runFork(admission.admit("claude", Effect.never));
    await Effect.runPromise(Effect.yieldNow());

    await Effect.runPromise(registry.stopAll());

    expect(events).toEqual(["start:claude-1", "stop:claude-1"]);
    const result = await Effect.runPromise(Fiber.await(control));
    if (!Exit.isFailure(result)) throw new Error("The cancelled control must fail.");
    expect(Exit.isInterrupted(result)).toBe(false);
    expect(Cause.pretty(result.cause)).toContain(
      "OpenDucktor stopped the Claude runtime before this action finished.",
    );
  });

  test("a crash and a cleanup failure before ready both reach the runtime error", async () => {
    const versionRead = Deferred.unsafeMake<string | null>(Effect.runSync(Effect.fiberId));
    const { registry, calls, events } = createHarness(undefined, () => Deferred.await(versionRead));
    const start = Effect.runPromise(apply(registry, "opencode", request("start")));
    for (let attempt = 0; attempt < 50 && events.length === 0; attempt += 1) {
      await Effect.runPromise(Effect.yieldNow());
    }

    calls[0]?.input.onRuntimeExit("process exited with code 1");
    calls[0]?.input.onRuntimeCleanupFailed("process still alive");
    await Effect.runPromise(Deferred.succeed(versionRead, "opencode 1.0.0"));
    await start;

    await expect(Effect.runPromise(registry.status("opencode"))).resolves.toMatchObject({
      state: "error",
      failure: {
        phase: "run",
        message:
          "The OpenCode runtime stopped unexpectedly: process exited with code 1\nCleanup failed: process still alive",
      },
    });
  });

  test("a reservation cancels an admitted control that outlasts the grace period", async () => {
    const { registry, admission } = createHarness(undefined, undefined, "20 millis");
    await Effect.runPromise(apply(registry, "opencode", request("start")));
    const control = Effect.runFork(admission.admit("opencode", Effect.never));
    await Effect.runPromise(Effect.yieldNow());

    const reservation = await Effect.runPromise(registry.reserve(["opencode"]));

    const result = await Effect.runPromise(Fiber.await(control));
    if (!Exit.isFailure(result)) throw new Error("The cancelled control must fail.");
    expect(Exit.isInterrupted(result)).toBe(false);
    expect(Cause.pretty(result.cause)).toContain(
      "OpenDucktor stopped this action to apply a lifecycle action on the OpenCode runtime.",
    );
    await Effect.runPromise(reservation.release());
    await expect(
      Effect.runPromise(admission.admit("opencode", Effect.succeed("ok"))),
    ).resolves.toBe("ok");
  });
});
