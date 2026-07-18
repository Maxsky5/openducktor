import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Option } from "effect";
import { WebOperationError } from "./effect/web-errors";
import { createWebLauncherLifecycle, type WebSignalShutdownRequest } from "./launcher-lifecycle";
import type { FrontendServer } from "./launcher-support";

const frontendServer: FrontendServer = {
  close: async () => {},
};

describe("createWebLauncherLifecycle", () => {
  test("shares one stop result across concurrent callers", async () => {
    let stopCalls = 0;

    await Effect.runPromise(
      Effect.gen(function* () {
        const stopStarted = yield* Deferred.make<void>();
        const releaseStop = yield* Deferred.make<void>();
        const lifecycle = yield* createWebLauncherLifecycle({
          closeFrontend: () => Effect.void,
          logger: {
            error: () => Effect.void,
            info: () => Effect.void,
            success: () => Effect.void,
          },
          onSignalShutdownFailure: () => {},
          reportFailure: () => {},
          runSignalShutdown: async () => {},
          stopResources: () =>
            Effect.gen(function* () {
              stopCalls += 1;
              yield* Deferred.succeed(stopStarted, undefined);
              yield* Deferred.await(releaseStop);
            }),
        });
        yield* lifecycle.registerFrontend(frontendServer);

        const first = yield* Effect.fork(lifecycle.stop());
        yield* Deferred.await(stopStarted);
        const second = yield* Effect.fork(lifecycle.stop());
        yield* Effect.yieldNow();

        expect(stopCalls).toBe(1);
        expect(Option.isNone(yield* Fiber.poll(first))).toBeTrue();
        expect(Option.isNone(yield* Fiber.poll(second))).toBeTrue();

        yield* Deferred.succeed(releaseStop, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }),
    );
  });

  test("reports release failures without turning typed errors into defects", async () => {
    const stopFailure = new WebOperationError({
      operation: "test.stop",
      message: "host stop failed",
    });
    const reportedFailures: unknown[] = [];
    const lifecycle = await Effect.runPromise(
      createWebLauncherLifecycle({
        closeFrontend: () => Effect.void,
        logger: {
          error: () => Effect.void,
          info: () => Effect.void,
          success: () => Effect.void,
        },
        onSignalShutdownFailure: () => {},
        reportFailure: (cause) => reportedFailures.push(cause),
        runSignalShutdown: async () => {},
        stopResources: () => Effect.fail(stopFailure),
      }),
    );

    await Promise.all([
      Effect.runPromise(lifecycle.release()),
      Effect.runPromise(lifecycle.release()),
    ]);

    expect(reportedFailures).toEqual([stopFailure]);
  });

  test("admits one duplicate-signal log and closes admission before flush", async () => {
    const infos: string[] = [];
    const signalRequests: WebSignalShutdownRequest[] = [];
    let markSignalStarted: () => void = () => {};
    const signalStarted = new Promise<void>((resolve) => {
      markSignalStarted = resolve;
    });
    const lifecycle = await Effect.runPromise(
      createWebLauncherLifecycle({
        closeFrontend: () => Effect.void,
        logger: {
          error: () => Effect.void,
          info: (message) => Effect.sync(() => infos.push(message)),
          success: () => Effect.void,
        },
        onSignalShutdownFailure: () => {},
        reportFailure: () => {},
        runSignalShutdown: async (request) => {
          signalRequests.push(request);
          markSignalStarted();
        },
        stopResources: () => Effect.void,
      }),
    );

    lifecycle.handleTermination("SIGTERM", 143);
    await signalStarted;
    lifecycle.handleTermination("SIGINT", 130);

    const signalRequest = signalRequests[0];
    if (!signalRequest) {
      throw new Error("signal shutdown was not requested");
    }
    signalRequest.closeDuplicateTerminationLogAdmission();
    expect(await signalRequest.awaitDuplicateTerminationLog()).toBeFalse();
    lifecycle.handleTermination("SIGINT", 130);

    expect(infos).toEqual([
      "OpenDucktor web shutdown is already in progress; waiting for cleanup to finish.",
    ]);
  });
});
