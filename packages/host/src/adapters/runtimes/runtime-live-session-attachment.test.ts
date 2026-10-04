import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, FiberId } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createLiveSessionAttachment } from "./runtime-live-session-attachment";

const createHarness = (options: { registration?: Deferred.Deferred<void> } = {}) => {
  const events: string[] = [];
  let closed = false;
  const attachment = createLiveSessionAttachment({
    runtimeId: "runtime-1",
    runtimeLabel: "OpenCode",
    operationPrefix: "opencodeRuntime",
    lifecycle: {
      registerRuntimeAdapter: () =>
        (options.registration ? Deferred.await(options.registration) : Effect.void).pipe(
          Effect.tap(() => Effect.sync(() => events.push("register"))),
        ),
      releaseRuntime: () => Effect.sync(() => (events.push("release"), [])),
    },
    isClosed: () => closed,
    closeDescription: () => "process exited with code 1",
  });
  const prepared = {
    adapter: createAgentSessionRuntimeAdapterTestDouble(
      { runtimeId: "runtime-1", runtimeKind: "opencode" },
      {},
    ),
    startForwarding: () => Effect.sync(() => void events.push("forward")),
    discard: () => Effect.sync(() => void events.push("discard")),
  };
  return {
    attachment,
    prepared,
    events,
    close: () => {
      closed = true;
    },
  };
};

describe("createLiveSessionAttachment", () => {
  test("registers, then forwards, and releases a registered adapter", async () => {
    const { attachment, prepared, events } = createHarness();
    attachment.adopt(prepared);
    await Effect.runPromise(attachment.attach);
    await Effect.runPromise(attachment.release);

    expect(events).toEqual(["register", "forward", "release"]);
  });

  test("a release before adoption does not stop a later discard", async () => {
    const { attachment, prepared, events, close } = createHarness();
    await Effect.runPromise(attachment.release);
    attachment.adopt(prepared);
    close();

    const failure = await Effect.runPromise(Effect.flip(attachment.attach));
    expect(failure.message).toBe(
      "OpenCode process exited before its live-session adapter was registered: process exited with code 1",
    );
    await Effect.runPromise(attachment.release);
    expect(events).toEqual(["discard"]);
  });

  test("a release waits for a registration in progress, then releases", async () => {
    const registration = Deferred.unsafeMake<void>(FiberId.none);
    const { attachment, prepared, events } = createHarness({ registration });
    attachment.adopt(prepared);
    const attaching = Effect.runFork(attachment.attach);
    await Effect.runPromise(Effect.yieldNow());

    const releasing = Effect.runFork(attachment.release);
    await Effect.runPromise(Effect.yieldNow());
    expect(events).toEqual([]);
    await Effect.runPromise(Deferred.succeed(registration, undefined));
    await Effect.runPromise(Fiber.join(attaching));
    await Effect.runPromise(Fiber.join(releasing));

    expect(events).toEqual(["register", "forward", "release"]);
  });

  test("a release after an interrupted registration discards the adapter", async () => {
    const registration = Deferred.unsafeMake<void>(FiberId.none);
    const { attachment, prepared, events } = createHarness({ registration });
    attachment.adopt(prepared);
    const attaching = Effect.runFork(attachment.attach);
    await Effect.runPromise(Effect.yieldNow());

    await Effect.runPromise(Fiber.interrupt(attaching));
    await Effect.runPromise(attachment.release);

    expect(events).toEqual(["discard"]);
  });

  test("a failed discard stays retryable", async () => {
    const { attachment, events } = createHarness();
    let attempts = 0;
    attachment.adopt({
      adapter: createAgentSessionRuntimeAdapterTestDouble(
        { runtimeId: "runtime-1", runtimeKind: "opencode" },
        {},
      ),
      startForwarding: () => Effect.void,
      discard: () =>
        Effect.suspend(() => {
          attempts += 1;
          return attempts === 1
            ? Effect.fail(new HostOperationError({ operation: "test.discard", message: "busy" }))
            : Effect.sync(() => void events.push("discard"));
        }),
    });

    await expect(Effect.runPromise(attachment.release)).rejects.toThrow("busy");
    await Effect.runPromise(attachment.release);
    await Effect.runPromise(attachment.release);

    expect(attempts).toBe(2);
    expect(events).toEqual(["discard"]);
  });
});
