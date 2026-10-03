import { Deferred, Effect, FiberId, Scope } from "effect";
import type { AgentSessionAuthorizedRoot } from "@openducktor/contracts";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { LiveStateCoordinator } from "./live-state-coordinator";

type AttachmentJob = {
  result: Deferred.Deferred<void, HostError>;
  scope: Scope.CloseableScope | null;
};

export const createLiveProjectionAttachmentOwner = ({
  readSessionRootRefs,
  refreshGate,
}: {
  readSessionRootRefs:
    | ((repoPath: string) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>)
    | undefined;
  refreshGate: LiveStateCoordinator;
}) => {
  const initialization = new WeakMap<AgentSessionLiveAdapterPort, AttachmentJob>();
  const initializeRuntime = (
    adapter: AgentSessionLiveAdapterPort,
  ): Effect.Effect<void, HostError> =>
    Effect.suspend(() => {
      const existing = initialization.get(adapter);
      if (existing) return Deferred.await(existing.result);
      // Reserve the job before yielding. Its scope belongs to the runtime registration.
      const job: AttachmentJob = {
        result: Deferred.unsafeMake<void, HostError>(FiberId.none),
        scope: null,
      };
      initialization.set(adapter, job);
      const start = Effect.gen(function* () {
        const scope = yield* Scope.make();
        job.scope = scope;
        if (!(yield* adapter.binding.ownRecoveryScope(scope))) {
          yield* Deferred.fail(
            job.result,
            new HostOperationError({
              operation: "agent-session-live.initialize",
              message:
                "The runtime was released during attachment. Start the assigned runtime to restore observation.",
            }),
          );
          return;
        }
        const work = refreshGate
          .run(
            Effect.gen(function* () {
              if (!adapter.refreshSnapshots) return;
              const roots = readSessionRootRefs
                ? yield* readSessionRootRefs(adapter.binding.repoPath)
                : [];
              yield* adapter.refreshSnapshots(
                adapter.binding.repoPath,
                roots.filter((root) => root.runtimeKind === adapter.binding.runtimeKind),
              );
            }),
          )
          .pipe(Effect.onExit((exit) => Deferred.done(job.result, exit)));
        yield* work.pipe(Effect.interruptible, Effect.forkIn(scope));
      });
      return Effect.uninterruptible(start).pipe(Effect.zipRight(Deferred.await(job.result)));
    });
  const ownership = new WeakMap<
    AgentSessionLiveAdapterPort,
    Map<string, Deferred.Deferred<void, HostError>>
  >();
  return {
    initialize: (adapter: AgentSessionLiveAdapterPort): Effect.Effect<void, HostError> =>
      initializeRuntime(adapter).pipe(
        Effect.zipRight(
          Effect.suspend(() =>
            Effect.forEach([...(ownership.get(adapter)?.values() ?? [])], Deferred.await, {
              discard: true,
            }),
          ),
        ),
      ),
    isCovered: (adapter: AgentSessionLiveAdapterPort): boolean =>
      (ownership.get(adapter)?.size ?? 0) === 0,
    run: (
      adapter: AgentSessionLiveAdapterPort,
      key: string,
      work: Effect.Effect<void, HostError>,
    ): Effect.Effect<void, HostError> =>
      Effect.suspend(() => {
        const jobs =
          ownership.get(adapter) ?? new Map<string, Deferred.Deferred<void, HostError>>();
        const existing = jobs.get(key);
        if (existing) return Deferred.await(existing);
        const result = Deferred.unsafeMake<void, HostError>(FiberId.none);
        jobs.set(key, result);
        ownership.set(adapter, jobs);
        const start = Effect.gen(function* () {
          yield* initializeRuntime(adapter);
          const scope = initialization.get(adapter)!.scope!;
          yield* refreshGate.run(work).pipe(
            Effect.onExit((exit) =>
              Deferred.done(result, exit).pipe(
                Effect.zipRight(Effect.sync(() => jobs.delete(key))),
              ),
            ),
            Effect.interruptible,
            Effect.forkIn(scope),
          );
        }).pipe(
          Effect.onError((cause) =>
            Deferred.failCause(result, cause).pipe(
              Effect.zipRight(Effect.sync(() => jobs.delete(key))),
            ),
          ),
        );
        return Effect.uninterruptible(start).pipe(Effect.zipRight(Deferred.await(result)));
      }),
  };
};
