import type { AgentRuntimeRecoveredSessionHistory } from "@openducktor/contracts";
import { Cause, Deferred, Effect, Exit, FiberId, Scope } from "effect";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { runtimeQueryError, type RuntimeQueryError } from "../../ports/runtime-query-error";

/** The query owner retains passive reads; cancelling one browser only cancels its wait. */
type ReadJob = {
  result: Deferred.Deferred<AgentRuntimeRecoveredSessionHistory, RuntimeQueryError>;
  completed: boolean;
  scope: Scope.CloseableScope | null;
};

export const createSharedHistoryRecovery = () => {
  const reads = new WeakMap<AgentSessionLiveAdapterPort, Map<string, ReadJob>>();
  const failedScopes = new WeakMap<AgentSessionLiveAdapterPort, Scope.CloseableScope[]>();
  return (
    adapter: AgentSessionLiveAdapterPort,
    key: string,
    work: Effect.Effect<AgentRuntimeRecoveredSessionHistory, RuntimeQueryError>,
  ): Effect.Effect<AgentRuntimeRecoveredSessionHistory, RuntimeQueryError> =>
    Effect.suspend(() => {
      let jobs = reads.get(adapter);
      if (!jobs) {
        jobs = new Map();
        reads.set(adapter, jobs);
      }
      const existing = jobs.get(key);
      if (existing) return Deferred.await(existing.result);
      const result = Deferred.unsafeMake<AgentRuntimeRecoveredSessionHistory, RuntimeQueryError>(
        FiberId.none,
      );
      const retired = failedScopes.get(adapter) ?? [];
      failedScopes.delete(adapter);
      for (const [oldKey, job] of jobs) {
        if (!job.completed) continue;
        if (job.scope) {
          retired.push(job.scope);
          job.scope = null;
        }
        if (jobs.size >= 128) jobs.delete(oldKey);
      }
      const job: ReadJob = { result, completed: false, scope: null };
      jobs.set(key, job);
      const start = Effect.gen(function* () {
        yield* Effect.forEach(retired, adapter.binding.retireRecoveryScope, { discard: true });
        const scope = yield* Scope.make();
        job.scope = scope;
        const attached = yield* adapter.binding.ownRecoveryScope(scope);
        if (!attached) {
          jobs.delete(key);
          yield* Deferred.fail(
            result,
            runtimeQueryError(
              "recoverSessionHistory",
              adapter.binding,
              "runtime_unavailable",
              "The runtime stopped before history recovery. Start the assigned runtime and reload this conversation.",
            ),
          );
          return;
        }
        yield* work.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              job.completed = true;
              if (Exit.isFailure(exit) && jobs.get(key) === job) {
                jobs.delete(key);
                if (job.scope) {
                  const scopes = failedScopes.get(adapter) ?? [];
                  scopes.push(job.scope);
                  failedScopes.set(adapter, scopes);
                  job.scope = null;
                }
              }
            }).pipe(
              Effect.zipRight(
                Exit.isFailure(exit) && Cause.isInterrupted(exit.cause)
                  ? Deferred.fail(
                      result,
                      runtimeQueryError(
                        "recoverSessionHistory",
                        adapter.binding,
                        "runtime_unavailable",
                        "The runtime stopped during history recovery. Start the assigned runtime and reload this conversation.",
                      ),
                    )
                  : Deferred.done(result, exit),
              ),
            ),
          ),
          Effect.interruptible,
          Effect.forkIn(scope),
        );
      });
      return Effect.uninterruptible(start).pipe(Effect.zipRight(Deferred.await(result)));
    });
};
