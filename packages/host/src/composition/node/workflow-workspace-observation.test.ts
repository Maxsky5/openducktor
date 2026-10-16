import { expect, test } from "bun:test";
import { Cause, Deferred, Effect, Fiber } from "effect";
import { workflowShutdown } from "./workflow-workspace-observation";

const owners = ["launches", "operations", "approvals", "completions"];

const shutdown = (steps: Array<() => Effect.Effect<void>>) =>
  workflowShutdown(
    { shutdown: steps[0]! },
    // SAFETY: The composition reads only shutdownOperations from the command service.
    { shutdownOperations: steps[1] } as Parameters<typeof workflowShutdown>[1],
    // SAFETY: This fixture provides both shutdown paths that the composition reads.
    {
      approvalPolicy: { shutdown: steps[2] },
      shutdownCompletionOperations: steps[3],
    } as Parameters<typeof workflowShutdown>[2],
  );

const failureCases: Array<{ failures: string[] }> = [
  { failures: ["launches"] },
  { failures: ["operations"] },
  { failures: ["approvals"] },
  { failures: ["completions"] },
  { failures: ["launches", "approvals", "completions"] },
];
test.each(failureCases)(
  "workflow shutdown runs every owner and retains failures: %j",
  async ({ failures }) => {
    const calls: string[] = [];
    const result = await Effect.runPromiseExit(
      shutdown(
        owners.map(
          (owner) => () =>
            Effect.sync(() => {
              calls.push(owner);
              if (failures.includes(owner)) throw new Error(`${owner} failed`);
            }),
        ),
      ),
    );

    expect(calls).toEqual(owners);
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected shutdown failure");
    expect(Cause.prettyErrors(result.cause).map((error) => error.message)).toEqual(
      failures.map((owner) => `${owner} failed`),
    );
  },
);

test("workflow shutdown completes remaining cleanup after interruption", async () => {
  const started = Deferred.makeUnsafe<void>();
  const calls: string[] = [];
  const worker = Effect.runFork(
    shutdown([
      () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      ...owners.slice(1).map(
        (owner) => () =>
          Effect.sync(() => {
            calls.push(owner);
          }),
      ),
    ]),
  );
  try {
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(worker));
    expect(calls).toEqual(["operations", "approvals", "completions"]);
  } finally {
    await Effect.runPromise(Fiber.interrupt(worker));
  }
});
