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

const missingProcessHandleMessage = (pid: number): string =>
  `Dev server process handle missing for pid ${pid}.`;

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
  const message = missingProcessHandleMessage(pid);
  updateScriptState(runtime, scriptId, (state) => {
    state.status = "failed";
    state.lastError = message;
  });
  return message;
};

const scriptHasRecordedPid = (
  script: DevServerScriptState,
): script is DevServerScriptState & { pid: number } => script.pid !== null;

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
      runtime.processes.delete(scriptId);
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

export const listRunningScripts = (runtime: DevServerGroupRuntime): StoppedDevServerScript[] =>
  runtime.state.scripts.flatMap((script) =>
    scriptHasRecordedPid(script) ? [stoppedScriptFromState(runtime, script, script.pid)] : [],
  );
