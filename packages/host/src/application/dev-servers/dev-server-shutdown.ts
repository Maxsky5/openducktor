import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { listRunningScripts } from "./dev-server-runtime-scripts";
import type { DevServerGroupRuntime } from "./dev-server-state";

export const stopAllDevServers = (
  groups: ReadonlyMap<string, ReadonlyMap<string, DevServerGroupRuntime>>,
  stopRuntime: (runtime: DevServerGroupRuntime) => Effect.Effect<string[]>,
  publishSnapshot: (runtime: DevServerGroupRuntime) => void,
) =>
  Effect.gen(function* () {
    const errors: string[] = [];
    const stoppedScripts: ReturnType<typeof listRunningScripts> = [];
    const runtimes = [...groups.values()].flatMap((repoGroups) => [...repoGroups.values()]);
    const results = yield* Effect.forEach(
      runtimes,
      (runtime) =>
        Effect.gen(function* () {
          const runningScripts = listRunningScripts(runtime);
          const stopErrors = yield* stopRuntime(runtime);
          publishSnapshot(runtime);
          return { runningScripts, stopErrors };
        }),
      { concurrency: "unbounded" },
    );
    for (const result of results) {
      stoppedScripts.push(...result.runningScripts);
      errors.push(...result.stopErrors);
    }
    if (errors.length > 0) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "dev_server.stop_all",
          message: errors.join("\n"),
        }),
      );
    }
    return { stoppedScripts };
  });
