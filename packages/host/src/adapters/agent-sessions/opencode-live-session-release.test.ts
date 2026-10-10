import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";
import {
  createOpenCodeLiveSessionAdapterPreparer,
  type OpenCodeLiveSessionObserver,
} from "./opencode-live-session-adapter";
import {
  createRuntimeHarness,
  ignoreObservationLoss,
  runtime,
  runtimeConnection,
} from "./opencode-live-session-adapter.test-support";

/** Composes the production live-state service with the production OpenCode adapter. */
const setup = async (
  release: () => Promise<void>,
  observer: OpenCodeLiveSessionObserver = ignoreObservationLoss,
) => {
  const harness = createRuntimeHarness({ release });
  const adapterRegistry = createLiveSessionAdapterRegistry();
  const service = createAgentSessionLiveStateService({
    adapterRegistry,
    faultLog: () => Effect.void,
    runtimeAdmission: { admit: (_runtimeKind, effect) => effect },
    publish: () => undefined,
  });
  const prepared = await Effect.runPromise(
    createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: {
        releaseRuntime: service.releaseRuntime,
        createRuntimeRegistration: service.createRuntimeRegistration,
      },
      prepareRuntime: harness.prepareRuntime,
    })(runtime, observer, runtimeConnection),
  );
  await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
  await Effect.runPromise(prepared.startForwarding());
  return { harness, service, adapterRegistry };
};

describe("OpenCode runtime release", () => {
  test("a release after a failed native release runs the native release again", async () => {
    let failRelease = true;
    const { harness, service } = await setup(async () => {
      if (failRelease) throw new Error("server still running");
    });

    await expect(Effect.runPromise(service.releaseRuntime(runtime.runtimeId))).rejects.toThrow(
      "server still running",
    );
    expect(harness.releaseCalls).toEqual([runtime.runtimeId]);

    failRelease = false;
    await Effect.runPromise(service.releaseRuntime(runtime.runtimeId));
    expect(harness.releaseCalls).toEqual([runtime.runtimeId, runtime.runtimeId]);

    await Effect.runPromise(service.releaseRuntime(runtime.runtimeId));
    expect(harness.releaseCalls).toHaveLength(2);
  });

  test("an observation fault reports the loss before release and then the failed cleanup", async () => {
    const reports: string[] = [];
    const nativeRelease = Promise.withResolvers<void>();
    const { harness, adapterRegistry } = await setup(() => nativeRelease.promise, {
      onObservationLost: (message) => reports.push(`lost: ${message}`),
      onCleanupFailed: (message) => reports.push(`cleanup: ${message}`),
    });

    const fault = harness.emit({ type: "fault", message: "connection lost" });
    for (let attempt = 0; attempt < 50 && harness.releaseCalls.length === 0; attempt += 1) {
      await Bun.sleep(0);
    }

    // Native cleanup is still pending, but the loss is already reported.
    expect(harness.releaseCalls).toEqual([runtime.runtimeId]);
    expect(adapterRegistry.list()).toEqual([]);
    expect(reports).toEqual(["lost: connection lost"]);

    nativeRelease.reject(new Error("server still running"));
    await fault.catch(() => undefined);
    expect(reports).toHaveLength(2);
    expect(reports[1]).toContain("cleanup: ");
    expect(reports[1]).toContain("server still running");
  });
});
