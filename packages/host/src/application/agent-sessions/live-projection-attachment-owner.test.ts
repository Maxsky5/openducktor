import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createLiveStateCoordinator } from "./live-state-coordinator";
import { createLiveProjectionAttachmentOwner } from "./live-projection-attachment-owner";

test("release interrupts stalled initialization without depending on its native response", async () => {
  const entered = Promise.withResolvers<void>();
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { repoPath: "/repo", runtimeKind: "opencode", runtimeId: "runtime" },
    {
      refreshSnapshots: () =>
        Effect.promise(async () => {
          entered.resolve();
          await new Promise<void>(() => {});
        }),
    },
  );
  const owner = createLiveProjectionAttachmentOwner({
    readSessionRootRefs: () => Effect.succeed([]),
    refreshGate: createLiveStateCoordinator(),
  });
  const waiting = Effect.runPromiseExit(owner.initialize(adapter));
  await entered.promise;
  const released = Effect.runPromise(adapter.binding.closeRecoveryScopes).then(() => true);
  expect(await Promise.race([released, Bun.sleep(100).then(() => false)])).toBe(true);
  expect((await waiting)._tag).toBe("Failure");
});

test("cancelling one initialization waiter leaves shared work for the other browser", async () => {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const finish = await Effect.runPromise(Deferred.make<void>());
  let reads = 0;
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { repoPath: "/repo", runtimeKind: "opencode", runtimeId: "runtime" },
    {
      refreshSnapshots: () =>
        Effect.gen(function* () {
          reads++;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(finish);
        }),
    },
  );
  const owner = createLiveProjectionAttachmentOwner({
    readSessionRootRefs: () => Effect.succeed([]),
    refreshGate: createLiveStateCoordinator(),
  });
  const first = Effect.runFork(owner.initialize(adapter));
  await Effect.runPromise(Deferred.await(entered));
  const second = Effect.runPromise(owner.initialize(adapter));
  await Effect.runPromise(Fiber.interrupt(first));
  await Effect.runPromise(Deferred.succeed(finish, undefined));
  await second;
  expect(reads).toBe(1);
  await Effect.runPromise(adapter.binding.closeRecoveryScopes);
});
