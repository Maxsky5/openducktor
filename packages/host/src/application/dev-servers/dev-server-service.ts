import {
  type DevServerEvent,
  type DevServerGroupState,
  type DevServerScriptState,
  devServerEventSchema,
  devServerGroupStateSchema,
  type RepoConfig,
} from "@openducktor/contracts";
import type { HostEventBusPort } from "../../events/host-event-bus";
import {
  type DevServerProcessHandle,
  type DevServerProcessPort,
  DevServerProcessStartExitError,
  devServerExitMessage,
} from "../../ports/dev-server-process-port";
import type { TaskWorktreeService } from "../tasks/worktrees/task-worktree-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import {
  buildGroupState,
  DEV_SERVER_CLICOLOR_FORCE,
  DEV_SERVER_COLORTERM,
  DEV_SERVER_EVENT_CHANNEL,
  DEV_SERVER_FORCE_COLOR,
  DEV_SERVER_TERM,
  type DevServerGroupRuntime,
  formatTerminalProcessOutput,
  formatTerminalSystemMessage,
  nextTerminalSequence,
  scriptHasLiveProcess,
  syncGroupState,
  trimTerminalChunks,
} from "./dev-server-state";

export type DevServerService = {
  getState(input: DevServerTaskInput): Promise<DevServerGroupState>;
  restart(input: DevServerTaskInput): Promise<DevServerGroupState>;
  start(input: DevServerTaskInput): Promise<DevServerGroupState>;
  stop(input: DevServerTaskInput): Promise<DevServerGroupState>;
};

export type DisposableDevServerService = DevServerService & {
  stopAll(): Promise<DevServerStopAllResult>;
};

export type StoppedDevServerScript = {
  command: string;
  name: string;
  pid: number;
  repoPath: string;
  scriptId: string;
  taskId: string;
};

export type DevServerStopAllResult = {
  stoppedScripts: StoppedDevServerScript[];
};

export type CreateDevServerServiceInput = {
  eventBus?: HostEventBusPort;
  processPort?: DevServerProcessPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
};

export type DevServerTaskInput = {
  repoPath: string;
  taskId: string;
};

const nowIso = (): string => new Date().toISOString();

const groupKey = (repoPath: string, taskId: string): string => `${repoPath}::${taskId}`;

export const createDevServerService = ({
  eventBus,
  processPort,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateDevServerServiceInput): DisposableDevServerService => {
  const groups = new Map<string, DevServerGroupRuntime>();

  const publish = (event: DevServerEvent): void => {
    eventBus?.publish(DEV_SERVER_EVENT_CHANNEL, devServerEventSchema.parse(event));
  };

  const emitSnapshot = (runtime: DevServerGroupRuntime): void => {
    publish({ type: "snapshot", state: runtime.state });
  };

  const getWorktreePath = async (repoPath: string, taskId: string): Promise<string | null> => {
    const worktree = taskWorktreeService
      ? await taskWorktreeService.getTaskWorktree({ repoPath, taskId })
      : null;
    return worktree?.workingDirectory ?? null;
  };

  const getRuntime = async (
    taskId: string,
    repoConfig: RepoConfig,
    worktreePath: string | null,
  ): Promise<DevServerGroupRuntime> => {
    const key = groupKey(repoConfig.repoPath, taskId);
    const existing = groups.get(key);
    if (existing) {
      syncGroupState(existing.state, repoConfig, taskId, worktreePath);
      return existing;
    }

    const runtime = {
      processes: new Map<string, DevServerProcessHandle>(),
      state: buildGroupState(repoConfig, taskId, worktreePath, nowIso()),
    };
    groups.set(key, runtime);
    return runtime;
  };

  const resolveRuntime = async (
    repoPath: string,
    taskId: string,
  ): Promise<{
    repoConfig: RepoConfig;
    runtime: DevServerGroupRuntime;
  }> => {
    const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const worktreePath = await getWorktreePath(repoPath, taskId);
    const runtime = await getRuntime(taskId, repoConfig, worktreePath);
    return { repoConfig, runtime };
  };

  const updateScriptState = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    update: (script: DevServerScriptState) => void,
  ): void => {
    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    if (!script) {
      throw new Error(`Unknown dev server script: ${scriptId}`);
    }

    update(script);
    runtime.state.updatedAt = nowIso();
    publish({
      type: "script_status_changed",
      repoPath: runtime.state.repoPath,
      taskId: runtime.state.taskId,
      script,
      updatedAt: runtime.state.updatedAt,
    });
  };

  const pushTerminalChunk = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    data: string,
  ): void => {
    if (data.length === 0) {
      return;
    }

    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    if (!script) {
      return;
    }

    const terminalChunk = {
      scriptId,
      sequence: nextTerminalSequence(script),
      data,
      timestamp: nowIso(),
    };
    script.bufferedTerminalChunks.push(terminalChunk);
    trimTerminalChunks(script.bufferedTerminalChunks);
    runtime.state.updatedAt = nowIso();
    publish({
      type: "terminal_chunk",
      repoPath: runtime.state.repoPath,
      taskId: runtime.state.taskId,
      terminalChunk,
    });
  };

  const appendTerminalSystemMessage = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    message: string,
  ): void => {
    pushTerminalChunk(runtime, scriptId, formatTerminalSystemMessage(message));
  };

  const markStartFailed = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    message: string,
    exitCode: number | null = null,
  ): void => {
    updateScriptState(runtime, scriptId, (script) => {
      script.status = "failed";
      script.pid = null;
      script.startedAt = null;
      script.exitCode = exitCode;
      script.lastError = message;
    });
    appendTerminalSystemMessage(runtime, scriptId, message);
  };

  const handleProcessExit = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    pid: number,
    exitCode: number | null,
    signal: string | null,
    error: string | null,
  ): void => {
    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    const isStartingWithoutRecordedPid = script?.pid === null && script.status === "starting";
    if (!script || (script.pid !== pid && !isStartingWithoutRecordedPid)) {
      return;
    }

    runtime.processes.delete(scriptId);
    const expectedStop = script.status === "stopping";
    const message = error ?? devServerExitMessage(exitCode, signal);
    if (!expectedStop) {
      appendTerminalSystemMessage(runtime, scriptId, message);
    }

    updateScriptState(runtime, scriptId, (state) => {
      state.pid = null;
      state.startedAt = null;
      state.exitCode = exitCode;
      if (expectedStop) {
        state.status = "stopped";
        state.lastError = null;
      } else {
        state.status = "failed";
        state.lastError = message;
      }
    });
  };

  const startScript = async (
    runtime: DevServerGroupRuntime,
    worktreePath: string,
    scriptConfig: RepoConfig["devServers"][number],
  ): Promise<void> => {
    if (!processPort) {
      throw new Error("Dev server process port is required to start builder dev servers.");
    }

    updateScriptState(runtime, scriptConfig.id, (script) => {
      script.status = "starting";
      script.pid = null;
      script.startedAt = null;
      script.exitCode = null;
      script.lastError = null;
      script.bufferedTerminalChunks = [];
    });
    appendTerminalSystemMessage(runtime, scriptConfig.id, `Starting \`${scriptConfig.command}\``);

    try {
      const handle = await processPort.start({
        command: scriptConfig.command,
        cwd: worktreePath,
        env: {
          CLICOLOR_FORCE: DEV_SERVER_CLICOLOR_FORCE,
          COLORTERM: DEV_SERVER_COLORTERM,
          FORCE_COLOR: DEV_SERVER_FORCE_COLOR,
          TERM: DEV_SERVER_TERM,
        },
        onExit: ({ pid, exitCode, signal, error }) =>
          handleProcessExit(runtime, scriptConfig.id, pid, exitCode, signal, error),
        onOutput: ({ data }) =>
          pushTerminalChunk(runtime, scriptConfig.id, formatTerminalProcessOutput(data)),
      });
      const script = runtime.state.scripts.find(
        (candidate) => candidate.scriptId === scriptConfig.id,
      );
      if (script?.status !== "starting") {
        throw new Error(script?.lastError ?? "Dev server exited before startup completed.");
      }
      runtime.processes.set(scriptConfig.id, handle);
      const startedAt = nowIso();
      updateScriptState(runtime, scriptConfig.id, (script) => {
        script.status = "running";
        script.pid = handle.pid;
        script.startedAt = startedAt;
        script.exitCode = null;
        script.lastError = null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const script = runtime.state.scripts.find(
        (candidate) => candidate.scriptId === scriptConfig.id,
      );
      if (script?.status === "failed") {
        throw error;
      }
      const exitCode = error instanceof DevServerProcessStartExitError ? error.exitCode : null;
      markStartFailed(runtime, scriptConfig.id, message, exitCode);
      throw error;
    }
  };

  const stopRuntime = async (runtime: DevServerGroupRuntime): Promise<string[]> => {
    const targets: Array<{
      handle: DevServerProcessHandle;
      scriptId: string;
    }> = [];
    const errors: string[] = [];

    for (const script of runtime.state.scripts) {
      script.bufferedTerminalChunks = [];
      if (script.pid === null) {
        if (script.status !== "stopped" || script.exitCode !== null || script.lastError !== null) {
          updateScriptState(runtime, script.scriptId, (state) => {
            state.status = "stopped";
            state.startedAt = null;
            state.exitCode = null;
            state.lastError = null;
          });
        }
        continue;
      }

      const handle = runtime.processes.get(script.scriptId);
      if (!handle) {
        const message = `Dev server process handle missing for pid ${script.pid}.`;
        errors.push(`Failed stopping dev server ${script.scriptId}: ${message}`);
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
      targets.push({ handle, scriptId: script.scriptId });
    }

    for (const target of targets) {
      try {
        await target.handle.stop();
        runtime.processes.delete(target.scriptId);
        const script = runtime.state.scripts.find(
          (candidate) => candidate.scriptId === target.scriptId,
        );
        if (script?.pid === target.handle.pid) {
          updateScriptState(runtime, target.scriptId, (state) => {
            state.status = "stopped";
            state.pid = null;
            state.startedAt = null;
            state.lastError = null;
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed stopping dev server ${target.scriptId}: ${message}`);
        updateScriptState(runtime, target.scriptId, (script) => {
          script.status = "failed";
          script.lastError = message;
        });
      }
    }

    return errors;
  };

  const listRunningScripts = (runtime: DevServerGroupRuntime): StoppedDevServerScript[] =>
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

  const service: DevServerService = {
    async getState(input) {
      const { repoPath, taskId } = input;
      const { runtime } = await resolveRuntime(repoPath, taskId);
      return devServerGroupStateSchema.parse(runtime.state);
    },

    async restart(input) {
      const { repoPath, taskId } = input;
      await service.stop({ repoPath, taskId });
      return service.start({ repoPath, taskId });
    },

    async start(input) {
      const { repoPath, taskId } = input;
      const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      if (repoConfig.devServers.length === 0) {
        throw new Error(
          `No builder dev server scripts are configured for ${repoConfig.repoPath}. Add them in repository settings first.`,
        );
      }

      const worktreePath = await getWorktreePath(repoPath, taskId);
      if (!worktreePath) {
        throw new Error(
          `Builder continuation cannot start until a builder worktree exists for task ${taskId}. Start Builder first.`,
        );
      }

      const runtime = await getRuntime(taskId, repoConfig, worktreePath);
      if (runtime.state.scripts.some(scriptHasLiveProcess)) {
        throw new Error(
          `Dev servers are already running for task ${taskId}. Stop or restart them instead.`,
        );
      }

      emitSnapshot(runtime);
      const errors: string[] = [];
      for (const script of repoConfig.devServers) {
        try {
          await startScript(runtime, worktreePath, script);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      emitSnapshot(runtime);
      if (errors.length === 0 || runtime.state.scripts.some(scriptHasLiveProcess)) {
        return devServerGroupStateSchema.parse(runtime.state);
      }

      throw new Error(errors.join("\n"));
    },

    async stop(input) {
      const { repoPath, taskId } = input;
      const { runtime } = await resolveRuntime(repoPath, taskId);
      const errors = await stopRuntime(runtime);
      emitSnapshot(runtime);
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }

      return devServerGroupStateSchema.parse(runtime.state);
    },
  };

  return {
    ...service,
    async stopAll() {
      const errors: string[] = [];
      const stoppedScripts: StoppedDevServerScript[] = [];
      for (const runtime of groups.values()) {
        stoppedScripts.push(...listRunningScripts(runtime));
        errors.push(...(await stopRuntime(runtime)));
        emitSnapshot(runtime);
      }
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }
      return { stoppedScripts };
    },
  };
};
