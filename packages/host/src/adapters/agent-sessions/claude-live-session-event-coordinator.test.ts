import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import { createClaudeLiveSessionEventCoordinator } from "./claude-live-session-event-coordinator";

const session = { runtimeId: "runtime-1" } as ClaudeSessionContext;

const statusEvent = (timestamp: string): ClaudeAgentSdkEvent => ({
  type: "session_status",
  externalSessionId: "session-1",
  timestamp,
  status: { type: "busy", message: null },
});

describe("Claude live-session event coordinator", () => {
  test("surfaces a processing failure once without stranding later events", async () => {
    const processedTimestamps: string[] = [];
    const failure = new HostOperationError({
      operation: "test.process-event",
      message: "First event failed",
    });
    const coordinator = createClaudeLiveSessionEventCoordinator({
      runtimeId: "runtime-1",
      processEvent: (_session, event) =>
        Effect.suspend(() => {
          processedTimestamps.push(event.timestamp);
          return processedTimestamps.length === 1 ? Effect.fail(failure) : Effect.void;
        }),
    });
    coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:01:00.000Z"));
    coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:02:00.000Z"));

    await expect(Effect.runPromise(coordinator.startForwarding())).rejects.toThrow(
      "First event failed",
    );
    expect(processedTimestamps).toEqual(["2026-07-17T10:01:00.000Z", "2026-07-17T10:02:00.000Z"]);
    await expect(Effect.runPromise(coordinator.flush())).resolves.toBeUndefined();
  });

  test("coalesces a live event burst without losing event order", async () => {
    const firstStarted = await Effect.runPromise(Deferred.make<void>());
    const continueFirst = await Effect.runPromise(Deferred.make<void>());
    const processedTimestamps: string[] = [];
    const coordinator = createClaudeLiveSessionEventCoordinator({
      runtimeId: "runtime-1",
      processEvent: (_session, event) =>
        Effect.gen(function* () {
          processedTimestamps.push(event.timestamp);
          if (processedTimestamps.length === 1) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(continueFirst);
          }
        }),
    });
    await Effect.runPromise(coordinator.startForwarding());

    coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:01:00.000Z"));
    await Effect.runPromise(Deferred.await(firstStarted));
    coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:02:00.000Z"));
    coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:03:00.000Z"));
    await Effect.runPromise(Deferred.succeed(continueFirst, undefined));
    await Effect.runPromise(coordinator.flush());

    expect(processedTimestamps).toEqual([
      "2026-07-17T10:01:00.000Z",
      "2026-07-17T10:02:00.000Z",
      "2026-07-17T10:03:00.000Z",
    ]);
  });

  test("waits for in-flight projection and discards events emitted during shutdown", async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    const continueProcessing = await Effect.runPromise(Deferred.make<void>());
    const processedTimestamps: string[] = [];
    const coordinator = createClaudeLiveSessionEventCoordinator({
      runtimeId: "runtime-1",
      processEvent: (_session, event) =>
        Effect.gen(function* () {
          processedTimestamps.push(event.timestamp);
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(continueProcessing);
        }),
    });
    await Effect.runPromise(coordinator.startForwarding());
    coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:01:00.000Z"));
    await Effect.runPromise(Deferred.await(started));

    const shutdownFiber = Effect.runFork(
      coordinator.shutdown(
        Effect.sync(() => {
          coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:02:00.000Z"));
        }),
      ),
    );
    await Effect.runPromise(Deferred.succeed(continueProcessing, undefined));
    await Effect.runPromise(Fiber.join(shutdownFiber));

    expect(processedTimestamps).toEqual(["2026-07-17T10:01:00.000Z"]);
    expect(() =>
      coordinator.enqueueEvent(session, statusEvent("2026-07-17T10:03:00.000Z")),
    ).toThrow("already released");
  });
});
