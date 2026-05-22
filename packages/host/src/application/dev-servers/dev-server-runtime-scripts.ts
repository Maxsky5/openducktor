import type { StoppedDevServerScript } from "./dev-server-service-types";
import type { DevServerGroupRuntime } from "./dev-server-state";

export const listRunningScripts = (runtime: DevServerGroupRuntime): StoppedDevServerScript[] =>
  runtime.state.scripts.flatMap((script) =>
    script.pid === null
      ? []
      : [
          {
            command: script.command,
            name: script.name,
            pid: script.pid,
            repoPath: runtime.state.repoPath,
            scriptId: script.scriptId,
            taskId: runtime.state.taskId,
          },
        ],
  );
