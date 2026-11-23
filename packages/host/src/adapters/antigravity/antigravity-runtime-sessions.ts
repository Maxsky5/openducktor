import { Effect } from "effect";
import { HostResourceError, toHostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionOperations } from "../runtimes/runtime-session-operations";
import type { AntigravitySessionController } from "./antigravity-session-controller";
import type { AntigravitySessionRegistry } from "./antigravity-session-registry";

type AntigravityRuntimeSessionControl = {
  readonly controller: Pick<AntigravitySessionController, "stopSession">;
  readonly sessions: Pick<AntigravitySessionRegistry, "hasRunningTurn">;
};

/**
 * The sessions of each running Antigravity runtime of this host, by runtime ID. A runtime adds
 * itself when it starts and removes itself when it is released.
 */
export class AntigravityRuntimeSessions {
  private readonly runtimes = new Map<string, AntigravityRuntimeSessionControl>();

  add(runtimeId: string, control: AntigravityRuntimeSessionControl): void {
    this.runtimes.set(runtimeId, control);
  }

  delete(runtimeId: string): void {
    this.runtimes.delete(runtimeId);
  }

  private require(
    runtimeId: string,
  ): Effect.Effect<AntigravityRuntimeSessionControl, HostResourceError> {
    const control = this.runtimes.get(runtimeId);
    return control
      ? Effect.succeed(control)
      : Effect.fail(
          new HostResourceError({
            resource: "antigravity",
            operation: "antigravityRuntime.sessionOperation",
            message: `Antigravity runtime '${runtimeId}' is not running. Restart the runtime, then try again.`,
          }),
        );
  }

  /** The session operations that the runtime registry runs on an Antigravity runtime. */
  readonly operations: RuntimeSessionOperations = {
    stopSession: (target, runtime) =>
      this.require(runtime.runtimeId).pipe(
        Effect.flatMap(({ controller }) =>
          Effect.tryPromise({
            try: () => controller.stopSession(target),
            catch: (cause) => toHostOperationError(cause, "antigravityRuntime.stopSession"),
          }),
        ),
      ),
    // ACP has no status read. The runtime knows each prompt that it sent.
    probeSessionStatus: (target, runtime) =>
      this.require(runtime.runtimeId).pipe(
        Effect.map(({ sessions }) => ({
          supported: true,
          hasLiveSession: sessions.hasRunningTurn(target.externalSessionId),
        })),
      ),
  };
}
