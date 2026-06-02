import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionStatusProbeInput } from "../../ports/runtime-registry-port";
import {
  createGitPort,
  createRegistry,
  createRuntime,
  createRuntimeDefinitionsService,
  createRuntimeOrchestratorService,
  createTaskStore,
} from "./runtime-orchestrator-service.test-support";

const waitForCondition = async (
  predicate: () => boolean,
  message: string,
  timeoutMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

type SessionProbeResult = {
  supported: boolean;
  hasLiveSession: boolean;
};

const describeProbeRoute = (input: RuntimeSessionStatusProbeInput): string =>
  input.runtimeRoute.type === "local_http"
    ? input.runtimeRoute.endpoint
    : input.runtimeRoute.identity;

const createDeferredProbeController = () => {
  const pendingProbes: Array<{
    resolve(value: SessionProbeResult): void;
  }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const startedRoutes: string[] = [];
  const completedRoutes: string[] = [];
  return {
    startedRoutes,
    completedRoutes,
    get maxInFlight() {
      return maxInFlight;
    },
    probe(input: RuntimeSessionStatusProbeInput) {
      return Effect.tryPromise({
        try: async () => {
          const route = describeProbeRoute(input);
          startedRoutes.push(route);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          const result = await new Promise<SessionProbeResult>((resolve) => {
            pendingProbes.push({ resolve });
          });
          inFlight -= 1;
          completedRoutes.push(route);
          return result;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    },
    resolveNext(results: SessionProbeResult[]) {
      const probes = pendingProbes.splice(0, results.length);
      if (probes.length !== results.length) {
        throw new Error(`Expected ${results.length} pending probes, found ${probes.length}`);
      }
      probes.forEach((probe, index) => {
        const result = results[index];
        if (!result) {
          throw new Error(`Missing probe result at index ${index}`);
        }
        probe.resolve(result);
      });
    },
  };
};

describe("createRuntimeOrchestratorService agentSessionStop", () => {
  test("stops persisted agent sessions through the matching runtime route", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({ workingDirectory: "/canonical/repo/worktree" });
    const registry = createRegistry([runtime], {
      ensureWorkspaceRuntime() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected runtime ensure");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stopRuntime() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected runtime stop");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      stopSession(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      probeSessionStatus() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected session probe",
          }),
        );
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "opencode",
        runtimeRoute: runtime.runtimeRoute,
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });

  test("stops persisted Codex sessions through the resolved stdio runtime route", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({
      kind: "codex",
      runtimeId: "runtime-codex-1",
      workingDirectory: "/canonical/repo/worktree",
      runtimeRoute: { type: "stdio", identity: "runtime-codex-1" },
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
    });
    const registry = createRegistry([runtime], {
      ensureWorkspaceRuntime() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected runtime ensure",
          }),
        );
      },
      stopSession(input) {
        return Effect.sync(() => {
          calls.push(input);
        });
      },
      probeSessionStatus() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected session probe",
          }),
        );
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore({ runtimeKind: "codex" }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        runtimeKind: "codex",
        runtimeRoute: { type: "stdio", identity: "runtime-codex-1" },
        externalSessionId: "external-session-1",
        workingDirectory: "/canonical/repo/worktree",
      },
    ]);
  });

  test("rejects agent session stop when persisted session identity mismatches the request", async () => {
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry([createRuntime()]),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "codex",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow(
      "Agent session with externalSessionId external-session-1 runtime kind mismatch",
    );
  });

  test("probes candidate session stop routes with bounded concurrency", async () => {
    const probes = createDeferredProbeController();
    const runtimes = Array.from({ length: 6 }, (_, index) =>
      createRuntime({
        runtimeId: `runtime-${index + 1}`,
        workingDirectory: `/canonical/repo/other-${index + 1}`,
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: `http://127.0.0.1:${4100 + index}`,
        },
      }),
    );
    const expectedLiveRoute = runtimes[4]?.runtimeRoute;
    if (!expectedLiveRoute) {
      throw new Error("Expected a live route candidate for the concurrency test");
    }
    const registry = createRegistry(runtimes, {
      probeSessionStatus(input) {
        return probes.probe(input);
      },
      stopSession(input) {
        return Effect.sync(() => {
          expect(input.runtimeRoute).toEqual(expectedLiveRoute);
        });
      },
    });
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: registry,
      taskReader: createTaskStore(),
    });
    const stop = Effect.runPromise(
      service.agentSessionStop({
        repoPath: "/repo",
        taskId: "task-1",
        externalSessionId: "external-session-1",
        runtimeKind: "opencode",
        workingDirectory: "/canonical/repo/worktree",
      }),
    );
    await waitForCondition(
      () => probes.startedRoutes.length >= 4,
      "Expected first bounded probe batch to start",
    );
    expect(probes.startedRoutes).toHaveLength(4);
    expect(probes.completedRoutes).toHaveLength(0);
    expect(probes.maxInFlight).toBe(4);
    probes.resolveNext([
      { supported: true, hasLiveSession: false },
      { supported: true, hasLiveSession: false },
      { supported: true, hasLiveSession: false },
      { supported: true, hasLiveSession: false },
    ]);
    await waitForCondition(
      () => probes.startedRoutes.length >= 6,
      "Expected remaining probe batch to start",
    );
    expect(probes.maxInFlight).toBeLessThanOrEqual(4);
    probes.resolveNext([
      { supported: true, hasLiveSession: true },
      { supported: true, hasLiveSession: false },
    ]);
    await expect(stop).resolves.toEqual({ ok: true });
    expect(probes.startedRoutes).toHaveLength(6);
  });

  test("fails session stop after all probes when multiple repo routes are live", async () => {
    const probeCalls: string[] = [];
    const runtimes = [1, 2, 3].map((index) =>
      createRuntime({
        runtimeId: `runtime-${index}`,
        workingDirectory: `/canonical/repo/other-${index}`,
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: `http://127.0.0.1:${4200 + index}`,
        },
      }),
    );
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(runtimes, {
        probeSessionStatus(input) {
          return Effect.sync(() => {
            if (input.runtimeRoute.type === "local_http") {
              probeCalls.push(input.runtimeRoute.endpoint);
            }
            return { supported: true, hasLiveSession: true };
          });
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow("Multiple live runtime routes matched externalSessionId external-session-1");
    expect(probeCalls).toHaveLength(3);
  });

  test("propagates session route probe failures instead of treating them as inactive", async () => {
    const runtimes = [1, 2].map((index) =>
      createRuntime({
        runtimeId: `runtime-${index}`,
        workingDirectory: `/canonical/repo/other-${index}`,
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: `http://127.0.0.1:${4300 + index}`,
        },
      }),
    );
    const service = createRuntimeOrchestratorService({
      gitPort: createGitPort(),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createRegistry(runtimes, {
        probeSessionStatus() {
          return Effect.fail(
            new HostOperationError({
              operation: "runtimeRegistry.probeSessionStatus",
              message: "probe transport failed",
            }),
          );
        },
      }),
      taskReader: createTaskStore(),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionStop({
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/canonical/repo/worktree",
        }),
      ),
    ).rejects.toThrow("probe transport failed");
  });
});
