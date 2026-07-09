import type { DevServerEvent } from "@openducktor/contracts";
import { HostInvariantError } from "../../effect/host-errors";
import {
  appendTerminalChunk,
  type DevServerGroupRuntime,
  formatTerminalProcessOutput,
  formatTerminalSystemMessage,
  nextTerminalSequence,
} from "./dev-server-state";

type PublishDevServerEvent = (event: DevServerEvent) => void;

export type DevServerTerminalWriter = {
  appendSystemMessage(runtime: DevServerGroupRuntime, scriptId: string, message: string): void;
  pushProcessOutput(
    runtime: DevServerGroupRuntime,
    scriptId: string,
    expectedRunId: string,
    data: string,
  ): void;
};

export const createDevServerTerminalWriter = (
  publish: PublishDevServerEvent,
): DevServerTerminalWriter => {
  const pushTerminalChunk = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    expectedRunId: string,
    data: string,
  ): void => {
    if (data.length === 0) {
      return;
    }
    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    if (!script || script.runId !== expectedRunId) {
      return;
    }
    if (!script.runOrder) {
      throw new HostInvariantError({
        invariant: "dev_server_script_run_known",
        message: `Dev server script has no active run order: ${scriptId}`,
      });
    }
    const timestamp = new Date().toISOString();
    const terminalChunk = {
      scriptId,
      runId: expectedRunId,
      runOrder: script.runOrder,
      sequence: nextTerminalSequence(runtime, script),
      data,
      timestamp,
    };
    appendTerminalChunk(runtime, script, terminalChunk);
    runtime.state.updatedAt = timestamp;
    publish({
      type: "terminal_chunk",
      repoPath: runtime.state.repoPath,
      taskId: runtime.state.taskId,
      terminalChunk,
    });
  };

  return {
    appendSystemMessage(runtime, scriptId, message) {
      const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
      if (!script?.runId) {
        throw new HostInvariantError({
          invariant: "dev_server_script_run_known",
          message: `Dev server script has no active run id: ${scriptId}`,
        });
      }
      pushTerminalChunk(runtime, scriptId, script.runId, formatTerminalSystemMessage(message));
    },
    pushProcessOutput(runtime, scriptId, expectedRunId, data) {
      pushTerminalChunk(runtime, scriptId, expectedRunId, formatTerminalProcessOutput(data));
    },
  };
};
