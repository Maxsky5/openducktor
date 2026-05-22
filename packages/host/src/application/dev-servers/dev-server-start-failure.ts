import type { DevServerScriptState } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { StoppedDevServerScript } from "./dev-server-service-types";
import type { DevServerGroupRuntime } from "./dev-server-state";

export type FailedDevServerScriptStart = {
  command: string;
  message: string;
  name: string;
  scriptId: string;
};

type UpdateScriptState = (
  runtime: DevServerGroupRuntime,
  scriptId: string,
  update: (script: DevServerScriptState) => void,
) => void;

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
      const stoppedScript = {
        command: script.command,
        name: script.name,
        pid: script.pid,
        repoPath: runtime.state.repoPath,
        scriptId: script.scriptId,
        taskId: runtime.state.taskId,
      };
      const handle = runtime.processes.get(script.scriptId);
      if (!handle) {
        const message = `Dev server process handle missing for pid ${script.pid}.`;
        cleanupErrors.push(`Failed cleaning up dev server ${script.scriptId}: ${message}`);
        updateScriptState(runtime, script.scriptId, (state) => {
          state.status = "failed";
          state.lastError = message;
        });
        continue;
      }
      updateScriptState(runtime, script.scriptId, (state) => {
        state.status = "stopping";
        state.lastError = null;
      });
      const stopResult = yield* Effect.either(handle.stop());
      if (stopResult._tag === "Right") {
        stoppedScripts.push(stoppedScript);
        runtime.processes.delete(script.scriptId);
        const currentScript = runtime.state.scripts.find(
          (candidate) => candidate.scriptId === script.scriptId,
        );
        if (currentScript?.pid === handle.pid) {
          updateScriptState(runtime, script.scriptId, (state) => {
            state.status = "stopped";
            state.pid = null;
            state.startedAt = null;
            state.lastError = null;
          });
        }
      } else {
        const message = errorMessage(stopResult.left);
        cleanupErrors.push(`Failed cleaning up dev server ${script.scriptId}: ${message}`);
        updateScriptState(runtime, script.scriptId, (state) => {
          state.status = "failed";
          state.lastError = message;
        });
      }
    }
    return { cleanupErrors, stoppedScripts };
  });

export const createDevServerStartFailureError = ({
  cleanupErrors,
  failedScripts,
  repoPath,
  stoppedScripts,
  taskId,
}: {
  cleanupErrors: string[];
  failedScripts: FailedDevServerScriptStart[];
  repoPath: string;
  stoppedScripts: StoppedDevServerScript[];
  taskId: string;
}): HostOperationError => {
  const sections = [
    "Failed to start all configured dev server scripts.",
    ...failedScripts.map(
      (script) => `Failed starting dev server ${script.scriptId}: ${script.message}`,
    ),
    ...cleanupErrors,
  ];
  return new HostOperationError({
    operation: "dev_server.start",
    message: sections.join("\n"),
    details: {
      cleanupErrors,
      failedScripts,
      repoPath,
      stoppedScripts,
      taskId,
    },
  });
};
