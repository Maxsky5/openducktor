import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionScope } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  createRuntimeHarness,
  runtime,
  ref,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";

describe("live runtime registration lifecycle", () => {
  test.each([
    { kind: "workflow", taskId: "task-1", role: "build" },
    { kind: "repository" },
  ] satisfies AgentSessionScope[])(
    "releases a runtime during a $kind control without blocking other repositories",
    async (sessionScope) => {
      const nativeEntered = Promise.withResolvers<void>();
      const nativeFinish = Promise.withResolvers<void>();
      const detached = Promise.withResolvers<void>();
      const registry = createLiveSessionAdapterRegistry();
      const events: AgentSessionLiveEnvelope[] = [];
      const service = createAgentSessionLiveStateService({
        adapterRegistry: {
          ...registry,
          remove: (id) =>
            registry.remove(id).pipe(Effect.tap(() => Effect.sync(() => detached.resolve()))),
        },
        faultLog: () => Effect.void,
        publish: (event) => {
          events.push(event);
        },
      });
      const native = createRuntimeHarness();
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: service,
          prepareRuntime: async (input) => {
            const preparedNative = await native.prepareRuntime(input);
            return {
              ...preparedNative,
              connection: {
                ...preparedNative.connection,
                resumeSession: async (request) => {
                  nativeEntered.resolve();
                  await nativeFinish.promise;
                  return preparedNative.connection.resumeSession(request);
                },
              },
            };
          },
        })(runtime),
      );
      await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
      const resumed = Effect.runPromiseExit(service.resumeSession({ ...ref, sessionScope }));
      await nativeEntered.promise;
      const released = Effect.runPromiseExit(service.releaseRuntime(runtime.runtimeId));
      await detached.promise;
      try {
        expect(await Effect.runPromise(service.list({ repoPath: "/other-repository" }))).toEqual(
          [],
        );
      } finally {
        nativeFinish.resolve();
      }
      const [resumeExit, releaseExit] = await Promise.all([resumed, released]);
      expect(Exit.isFailure(resumeExit)).toBe(true);
      if (Exit.isFailure(resumeExit))
        expect(Cause.pretty(resumeExit.cause)).toContain("was released");
      expect(Exit.isSuccess(releaseExit)).toBe(true);
      expect(await Effect.runPromise(service.list({ repoPath: runtime.repoPath }))).toEqual([]);
      expect(native.releaseCalls).toHaveLength(1);
      const eventCount = events.length;
      await Effect.runPromise(
        prepared.adapter.binding.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [{ type: "fault", repoPath: runtime.repoPath, message: "late native event" }],
          }),
        ),
      );
      expect(events).toHaveLength(eventCount);
      const copiedLease = { ...prepared.adapter.binding };
      await Effect.runPromise(
        copiedLease.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [
              { type: "fault", repoPath: runtime.repoPath, message: "copied late callback" },
            ],
          }),
        ),
      );
      expect(events).toHaveLength(eventCount);
      const preparedLease = service.createRuntimeRegistration(prepared.adapter.binding);
      await Effect.runPromise(
        preparedLease.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [{ type: "fault", repoPath: runtime.repoPath, message: "not registered" }],
          }),
        ),
      );
      expect(events).toHaveLength(eventCount);
    },
    1000,
  );
});
