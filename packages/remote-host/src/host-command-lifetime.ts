import { HostOperationError, type EffectNodeHostCommandRouter } from "@openducktor/host";
import { Deferred, Effect } from "effect";
/** Accepted network work belongs to the shell host, including while its listener is disabled. */
export type HostCommandLifetime = {
  invoke: EffectNodeHostCommandRouter["invoke"];
  drain(): Effect.Effect<void>;
};
export const createHostCommandLifetime = (
  router: Pick<EffectNodeHostCommandRouter, "invoke">,
): HostCommandLifetime => {
  let accepting = true;
  const commands = new Set<Deferred.Deferred<void>>();
  const invoke: EffectNodeHostCommandRouter["invoke"] = (
    command: string,
    args?: import("@openducktor/contracts").HostCommandArgs,
  ) =>
    Effect.suspend(() => {
      if (!accepting)
        return Effect.fail(
          new HostOperationError({
            operation: "remote.invoke",
            message: "The host is shutting down. Reopen the shell to run work.",
          }),
        );
      const done = Deferred.makeUnsafe<void>();
      commands.add(done);
      return router
        .invoke(command, args)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => commands.delete(done)).pipe(
              Effect.andThen(Deferred.succeed(done, undefined)),
            ),
          ),
        );
    });
  return {
    invoke,
    drain: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        accepting = false;
        return Effect.all([...commands].map(Deferred.await), { discard: true });
      }),
  };
};
