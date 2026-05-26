import type { DevServerScriptState } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { DevServerProcessHandle } from "../../ports/dev-server-process-port";
import type { StoppedDevServerScript } from "./dev-server-service-types";
import type { DevServerGroupRuntime } from "./dev-server-state";

export type UpdateScriptState = (
  runtime: DevServerGroupRuntime,
  scriptId: string,
  update: (script: DevServerScriptState) => void,
) => void;

export const stoppedScriptFromState = (
  runtime: DevServerGroupRuntime,
  script: DevServerScriptState,
  pid: number,
): StoppedDevServerScript => ({
  command: script.command,
  name: script.name,
  pid,
  repoPath: runtime.state.repoPath,
  scriptId: script.scriptId,
  taskId: runtime.state.taskId,
});

export const markScriptProcessHandleMissing = ({
  pid,
  runtime,
  scriptId,
  updateScriptState,
}: {
  pid: number;
  runtime: DevServerGroupRuntime;
  scriptId: string;
  updateScriptState: UpdateScriptState;
}): string => {
  const message = `Dev server process handle missing for pid ${pid}.`;
  updateScriptState(runtime, scriptId, (state) => {
    state.status = "failed";
    state.pid = null;
    state.startedAt = null;
    state.lastError = message;
  });
  return message;
};

export const stopScriptProcessHandle = ({
  handle,
  runtime,
  scriptId,
  updateScriptState,
}: {
  handle: DevServerProcessHandle;
  runtime: DevServerGroupRuntime;
  scriptId: string;
  updateScriptState: UpdateScriptState;
}) =>
  Effect.gen(function* () {
    const stopResult = yield* Effect.either(handle.stop());
    if (stopResult._tag === "Right") {
      if (runtime.processes.get(scriptId) === handle) {
        runtime.processes.delete(scriptId);
      }
      const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
      if (script?.pid === handle.pid) {
        updateScriptState(runtime, scriptId, (state) => {
          state.status = "stopped";
          state.pid = null;
          state.startedAt = null;
          state.lastError = null;
        });
      }
      return null;
    }

    const message = errorMessage(stopResult.left);
    updateScriptState(runtime, scriptId, (script) => {
      script.status = "failed";
      script.lastError = message;
    });
    return message;
  });

export const stopStartedScriptsAfterStartFailure = (
  runtime: DevServerGroupRuntime,
  updateScriptState: UpdateScriptState,
) =>
  Effect.gen(function* () {
    const cleanupErrors: string[] = [];
    const stoppedScripts: StoppedDevServerScript[] = [];
    for (const script of runtime.state.scripts) {
      if (script.pid === null) {
        continue;
      }
      const pid = script.pid;
      const handle = runtime.processes.get(script.scriptId);
      if (!handle) {
        const message = markScriptProcessHandleMissing({
          pid,
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
        stoppedScripts.push(stoppedScriptFromState(runtime, script, pid));
      } else {
        cleanupErrors.push(`Failed cleaning up dev server ${script.scriptId}: ${stopError}`);
      }
    }
    return { cleanupErrors, stoppedScripts };
  });

export const listRunningScripts = (runtime: DevServerGroupRuntime): StoppedDevServerScript[] =>
  runtime.state.scripts.flatMap((script) =>
    script.pid === null ? [] : [stoppedScriptFromState(runtime, script, script.pid)],
  );
