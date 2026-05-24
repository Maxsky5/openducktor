import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  markScriptProcessHandleMissing,
  stoppedScriptFromState,
  stopScriptProcessHandle,
  type UpdateScriptState,
} from "./dev-server-runtime-scripts";
import type { StoppedDevServerScript } from "./dev-server-service-types";
import type { DevServerGroupRuntime } from "./dev-server-state";

export type FailedDevServerScriptStart = {
  command: string;
  message: string;
  name: string;
  scriptId: string;
};

export const stopStartedScriptsAfterStartFailure = (
  runtime: DevServerGroupRuntime,
  updateScriptState: UpdateScriptState,
) =>
  Effect.gen(function* () {
    const stoppedScripts: StoppedDevServerScript[] = [];
    const cleanupErrors: string[] = [];
    for (const script of runtime.state.scripts) {
      if (script.pid === null) {
        continue;
      }
      const stoppedScript = stoppedScriptFromState(runtime, script, script.pid);
      const handle = runtime.processes.get(script.scriptId);
      if (!handle) {
        const message = markScriptProcessHandleMissing({
          pid: script.pid,
          runtime,
          scriptId: script.scriptId,
          updateScriptState,
        });
        cleanupErrors.push(`Failed cleaning up dev server ${script.scriptId}: ${message}`);
        continue;
      }
      updateScriptState(runtime, script.scriptId, (state) => {
        state.status = "stopping";
        state.lastError = null;
      });
      const stopError = yield* stopScriptProcessHandle({
        handle,
        runtime,
        scriptId: script.scriptId,
        updateScriptState,
      });
      if (stopError === null) {
        stoppedScripts.push(stoppedScript);
      } else {
        cleanupErrors.push(`Failed cleaning up dev server ${script.scriptId}: ${stopError}`);
      }
    }
    return { cleanupErrors, stoppedScripts };
  });

export const createDevServerStartFailureError = ({
  cleanupErrors,
  failedScript,
  repoPath,
  stoppedScripts,
  taskId,
}: {
  cleanupErrors: string[];
  failedScript: FailedDevServerScriptStart;
  repoPath: string;
  stoppedScripts: StoppedDevServerScript[];
  taskId: string;
}): HostOperationError => {
  const sections = [
    "Failed to start all configured dev server scripts.",
    `Failed starting dev server ${failedScript.scriptId}: ${failedScript.message}`,
    ...cleanupErrors,
  ];
  return new HostOperationError({
    operation: "dev_server.start",
    message: sections.join("\n"),
    details: {
      cleanupErrors,
      failedScripts: [failedScript],
      repoPath,
      stoppedScripts,
      taskId,
    },
  });
};
