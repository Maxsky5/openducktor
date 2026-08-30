import { describe, expect, test } from "bun:test";
import { Cause, Chunk, Effect, Exit } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { useRuntimeProbeResource } from "./runtime-executable-probe-lifecycle";

const firstFailureMessage = async (effect: Effect.Effect<void, HostOperationErrorAggregate>) => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    return null;
  }
  const failure = Chunk.head(Cause.failures(exit.cause));
  return failure._tag === "Some" ? failure.value.message : null;
};

describe("useRuntimeProbeResource", () => {
  test("releases the runtime resource after a failed protocol probe", async () => {
    let released = false;
    const effect = useRuntimeProbeResource({
      acquire: Effect.succeed("runtime"),
      probe: () =>
        Effect.fail(new HostOperationError({ operation: "probe", message: "protocol failed" })),
      release: () =>
        Effect.sync(() => {
          released = true;
        }),
      cleanupOperation: "probe.cleanup",
    });

    expect(await firstFailureMessage(effect)).toContain("protocol failed");
    expect(released).toBe(true);
  });

  test("keeps both protocol and cleanup failures actionable", async () => {
    const effect = useRuntimeProbeResource({
      acquire: Effect.succeed("runtime"),
      probe: () =>
        Effect.fail(new HostOperationError({ operation: "probe", message: "protocol failed" })),
      release: () =>
        Effect.fail(
          new HostOperationError({ operation: "probe.cleanup", message: "cleanup failed" }),
        ),
      cleanupOperation: "probe.cleanup",
    });

    const message = await firstFailureMessage(effect);

    expect(message).toContain("protocol failed");
    expect(message).toContain("Cleanup failed");
    expect(message).toContain("cleanup failed");
  });
});
