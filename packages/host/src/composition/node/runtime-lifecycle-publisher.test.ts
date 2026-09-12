import { expect, test } from "bun:test";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type HostEventEnvelope,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import { createHostEventBus } from "../../events/host-event-bus";
import {
  createLiveSessionPublisher,
  createRuntimeLifecyclePublisher,
} from "./runtime-lifecycle-publisher";

const runtime: RuntimeInstanceSummary = {
  runtimeId: "runtime-1",
  kind: "opencode",
  repoPath: "/repo",
  workingDirectory: "/repo",
  role: "workspace",
  taskId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-09-12T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
};

test("keeps runtime start, reuse, replacement, and stop consistent when publication fails", async () => {
  const failure = new Error("event delivery unavailable");
  const failures: HostOperationError[] = [];
  let starts = 0;
  let stops = 0;
  let alive = true;
  const registry = createRuntimeRegistry({
    workspaceStarter: {
      startWorkspaceRuntime: () =>
        Effect.sync(() => ({
          runtime: { ...runtime, runtimeId: `runtime-${++starts}` },
          configuredExecutablePath: "opencode",
          isAlive: () => alive,
          stop: () =>
            Effect.sync(() => {
              stops += 1;
            }),
        })),
    },
    onRuntimeChanged: createRuntimeLifecyclePublisher(
      {
        publish: () => {
          throw failure;
        },
        subscribe: () => () => {},
      },
      (error) =>
        Effect.sync(() => {
          failures.push(error);
        }),
    ),
  });
  const input = {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    descriptor: runtime.descriptor,
  };

  const first = await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
  expect(await Effect.runPromise(registry.ensureWorkspaceRuntime(input))).toEqual(first);
  expect(starts).toBe(1);
  expect(await Effect.runPromise(registry.listRuntimes())).toEqual([first]);
  alive = false;
  const replacement = await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
  expect(replacement.runtimeId).toBe("runtime-2");
  expect(await Effect.runPromise(registry.stopRuntime(replacement.runtimeId))).toBe(true);
  expect(await Effect.runPromise(registry.listRuntimes())).toEqual([]);
  expect(stops).toBe(2);
  expect(failures).toHaveLength(4);
  for (const error of failures) {
    expect(error.operation).toBe("runtime.publish-change");
    expect(error.cause).toBe(failure);
  }
});

test("starts, reuses, and stops a runtime without lifecycle publication", async () => {
  let starts = 0;
  let stops = 0;
  const registry = createRuntimeRegistry({
    workspaceStarter: {
      startWorkspaceRuntime: () =>
        Effect.sync(() => {
          starts += 1;
          return {
            runtime,
            configuredExecutablePath: "opencode",
            isAlive: () => true,
            stop: () =>
              Effect.sync(() => {
                stops += 1;
              }),
          };
        }),
    },
  });
  const input = {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    descriptor: runtime.descriptor,
  };
  await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
  await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
  expect(starts).toBe(1);
  expect(await Effect.runPromise(registry.stopRuntime(runtime.runtimeId))).toBe(true);
  expect(stops).toBe(1);
  expect(await Effect.runPromise(registry.listRuntimes())).toEqual([]);
});

test("publishes runtime scope and preserves required live session bus errors", async () => {
  const envelopes: HostEventEnvelope[] = [];
  const eventBus = createHostEventBus({
    report: ({ cause }) => {
      throw cause;
    },
  });
  const unsubscribe = eventBus.subscribe("openducktor://agent-session-live-event", (envelope) =>
    envelopes.push(envelope),
  );
  const publish = createRuntimeLifecyclePublisher(eventBus, (error) => Effect.die(error));
  try {
    await Effect.runPromise(publish(runtime, "ready"));
    await Effect.runPromise(publish(runtime, "stopped"));
    expect(envelopes).toEqual(
      (["ready", "stopped"] as const).map((state) => ({
        channel: "openducktor://agent-session-live-event",
        payload: {
          type: "runtime_changed",
          scope: { repoPath: "/repo", runtimeKind: "opencode" },
          state,
        },
      })),
    );
    expect(() =>
      createLiveSessionPublisher(undefined)({
        type: "runtime_changed",
        scope: { repoPath: "/repo", runtimeKind: "opencode" },
        state: "ready",
      }),
    ).toThrow(HostResourceError);
  } finally {
    unsubscribe();
  }
});
