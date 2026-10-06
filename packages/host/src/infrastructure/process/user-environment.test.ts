import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, type Duration } from "effect";
import type { UserEnvironmentResolution } from "../../ports/user-environment-port";
import { ProcessEnvironmentError } from "./process-environment-error";
import { createUserEnvironment } from "./user-environment";

const pathFailure: UserEnvironmentResolution = {
  environment: { HOME: "/home/dev" },
  error: new ProcessEnvironmentError({
    message: "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out.",
    reason: "timed_out",
    shell: "/bin/zsh",
  }),
};
const pathReady: UserEnvironmentResolution = {
  environment: { HOME: "/home/dev", PATH: "/opt/tools/bin:/usr/bin" },
  error: null,
};

const stateOf = (resolution: UserEnvironmentResolution, revision: number) => ({
  ...resolution,
  revision,
});

describe("createUserEnvironment", () => {
  test("keeps the startup resolution until a refresh completes", async () => {
    const userEnvironment = createUserEnvironment(pathFailure, Effect.succeed(pathReady));

    expect(userEnvironment.current()).toEqual(stateOf(pathFailure, 0));
    await Effect.runPromise(userEnvironment.refresh());
    expect(userEnvironment.current()).toEqual(stateOf(pathReady, 1));
  });

  test("shares one resolution between concurrent refreshes", async () => {
    let resolveCalls = 0;
    const program = Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const userEnvironment = createUserEnvironment(
        pathFailure,
        Effect.gen(function* () {
          resolveCalls += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(gate);
          return pathReady;
        }),
      );

      const first = yield* Effect.forkChild(userEnvironment.refresh());
      yield* Deferred.await(started);
      // The second caller starts at once and waits on the shared run.
      const second = yield* Effect.forkChild(userEnvironment.refresh(), { startImmediately: true });
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      const sharedState = userEnvironment.current();
      // A refresh after the shared one completes starts a new resolution.
      yield* userEnvironment.refresh();
      return sharedState;
    });

    const sharedState = await Effect.runPromise(program);

    expect(sharedState).toEqual(stateOf(pathReady, 1));
    expect(resolveCalls).toBe(2);
  });

  test("ends a refresh when the resolution time limit ends", async () => {
    let resolveCalls = 0;
    const userEnvironment = createUserEnvironment(
      pathReady,
      Effect.suspend(() => {
        resolveCalls += 1;
        return Effect.never.pipe(
          Effect.timeoutOrElse({ duration: "50 millis", orElse: () => Effect.fail("timed out") }),
          Effect.orElseSucceed(() => pathFailure),
        );
      }),
    );
    const refreshWithin = (duration: Duration.Input) =>
      Effect.runPromise(
        userEnvironment.refresh().pipe(
          Effect.timeoutOrElse({
            duration,
            orElse: () => Effect.fail(new Error("The refresh did not end.")),
          }),
        ),
      );

    await refreshWithin("1 second");
    await refreshWithin("1 second");

    expect(userEnvironment.current()).toEqual(stateOf(pathFailure, 2));
    expect(resolveCalls).toBe(2);
  });

  test("reports a failed refresh after a ready resolution", async () => {
    const userEnvironment = createUserEnvironment(pathReady, Effect.succeed(pathFailure));

    await Effect.runPromise(userEnvironment.refresh());

    expect(userEnvironment.current()).toEqual(stateOf(pathFailure, 1));
  });
});
