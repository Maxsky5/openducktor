import {
  type DevServerEvent,
  type DevServerScriptState,
  devServerEventSchema,
  devServerGroupStateSchema,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  errorMessage,
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import {
  type DevServerProcessHandle,
  DevServerProcessStartExitError,
  devServerExitMessage,
} from "../../ports/dev-server-process-port";
import {
  listRunningScripts,
  markScriptProcessHandleMissing,
  stopScriptProcessHandle,
} from "./dev-server-runtime-scripts";
import type {
  CreateDevServerServiceInput,
  DevServerService,
  DevServerServiceError,
  DisposableDevServerService,
  StoppedDevServerScript,
} from "./dev-server-service-types";
import {
  createDevServerStartFailureError,
  type FailedDevServerScriptStart,
  stopStartedScriptsAfterStartFailure,
} from "./dev-server-start-failure";
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

export type {
  CreateDevServerServiceInput,
  DevServerService,
  DevServerServiceError,
  DevServerStopAllResult,
  DevServerTaskInput,
  DisposableDevServerService,
  StoppedDevServerScript,
} from "./dev-server-service-types";

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
  const getWorktreePath = (repoPath: string, taskId: string) =>
    Effect.gen(function* () {
      const worktree = taskWorktreeService
        ? yield* taskWorktreeService.getTaskWorktree({ repoPath, taskId })
        : null;
      return worktree?.workingDirectory ?? null;
    });
  const getRuntime = (taskId: string, repoConfig: RepoConfig, worktreePath: string | null) =>
    Effect.sync(() => {
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
    });
  const resolveRuntime = (
    repoPath: string,
    taskId: string,
  ): Effect.Effect<
    {
      repoConfig: RepoConfig;
      runtime: DevServerGroupRuntime;
    },
    DevServerServiceError
  > =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const worktreePath = yield* getWorktreePath(repoPath, taskId);
      const runtime = yield* getRuntime(taskId, repoConfig, worktreePath);
      return { repoConfig, runtime };
    });
  const updateScriptState = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    update: (script: DevServerScriptState) => void,
  ): void => {
    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    if (!script) {
      throw new HostInvariantError({
        invariant: "dev_server_script_known",
        message: `Unknown dev server script: ${scriptId}`,
        details: { scriptId },
      });
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
  const startScript = (
    runtime: DevServerGroupRuntime,
    worktreePath: string,
    scriptConfig: RepoConfig["devServers"][number],
  ) =>
    Effect.gen(function* () {
      if (!processPort) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "DevServerProcessPort",
            operation: "dev_server.start_script",
            message: "Dev server process port is required to start builder dev servers.",
          }),
        );
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
      const handle = yield* processPort
        .start({
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
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const script = runtime.state.scripts.find(
                (candidate) => candidate.scriptId === scriptConfig.id,
              );
              if (script?.status !== "failed") {
                const exitCode =
                  error instanceof DevServerProcessStartExitError ? error.exitCode : null;
                markStartFailed(runtime, scriptConfig.id, errorMessage(error), exitCode);
              }
              return yield* Effect.fail(error);
            }),
          ),
        );
      const script = runtime.state.scripts.find(
        (candidate) => candidate.scriptId === scriptConfig.id,
      );
      if (script?.status !== "starting") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "dev_server.start_script",
            message: script?.lastError ?? "Dev server exited before startup completed.",
            details: { scriptId: scriptConfig.id },
          }),
        );
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
    });
  const stopRuntime = (runtime: DevServerGroupRuntime) =>
    Effect.gen(function* () {
      const targets: Array<{
        handle: DevServerProcessHandle;
        scriptId: string;
      }> = [];
      const errors: string[] = [];
      for (const script of runtime.state.scripts) {
        script.bufferedTerminalChunks = [];
        if (script.pid === null) {
          if (
            script.status !== "stopped" ||
            script.exitCode !== null ||
            script.lastError !== null
          ) {
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
          const message = markScriptProcessHandleMissing({
            pid: script.pid,
            runtime,
            scriptId: script.scriptId,
            updateScriptState,
          });
          errors.push(`Failed stopping dev server ${script.scriptId}: ${message}`);
          continue;
        }
        updateScriptState(runtime, script.scriptId, (state) => {
          state.status = "stopping";
          state.lastError = null;
        });
        targets.push({ handle, scriptId: script.scriptId });
      }
      for (const target of targets) {
        const stopError = yield* stopScriptProcessHandle({
          handle: target.handle,
          runtime,
          scriptId: target.scriptId,
          updateScriptState,
        });
        if (stopError !== null) {
          errors.push(`Failed stopping dev server ${target.scriptId}: ${stopError}`);
        }
      }
      return errors;
    });
  const service: DevServerService = {
    getState(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId } = input;
        const { runtime } = yield* resolveRuntime(repoPath, taskId);
        return devServerGroupStateSchema.parse(runtime.state);
      });
    },
    restart(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId } = input;
        yield* service.stop({ repoPath, taskId });
        return yield* service.start({ repoPath, taskId });
      });
    },
    start(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId } = input;
        const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
        if (repoConfig.devServers.length === 0) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "devServers",
              message: `No builder dev server scripts are configured for ${repoConfig.repoPath}. Add them in repository settings first.`,
              details: { repoPath: repoConfig.repoPath },
            }),
          );
        }
        const worktreePath = yield* getWorktreePath(repoPath, taskId);
        if (!worktreePath) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Builder continuation cannot start until a builder worktree exists for task ${taskId}. Start Builder first.`,
              details: { repoPath, taskId },
            }),
          );
        }
        const runtime = yield* getRuntime(taskId, repoConfig, worktreePath);
        if (runtime.state.scripts.some(scriptHasLiveProcess)) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Dev servers are already running for task ${taskId}. Stop or restart them instead.`,
              details: { repoPath, taskId },
            }),
          );
        }
        emitSnapshot(runtime);
        let failedScript: FailedDevServerScriptStart | null = null;
        for (const script of repoConfig.devServers) {
          const startResult = yield* Effect.either(startScript(runtime, worktreePath, script));
          if (startResult._tag === "Left") {
            failedScript = {
              command: script.command,
              message: errorMessage(startResult.left),
              name: script.name,
              scriptId: script.id,
            };
            break;
          }
        }
        if (failedScript) {
          const { cleanupErrors, stoppedScripts } = yield* stopStartedScriptsAfterStartFailure(
            runtime,
            updateScriptState,
          );
          emitSnapshot(runtime);
          return yield* Effect.fail(
            createDevServerStartFailureError({
              cleanupErrors,
              failedScript,
              repoPath,
              stoppedScripts,
              taskId,
            }),
          );
        }
        emitSnapshot(runtime);
        if (runtime.state.scripts.some(scriptHasLiveProcess)) {
          return devServerGroupStateSchema.parse(runtime.state);
        }
        return yield* Effect.fail(
          new HostOperationError({
            operation: "dev_server.start",
            message: "Dev server start completed without any live script processes.",
            details: { repoPath, taskId },
          }),
        );
      });
    },
    stop(input) {
      return Effect.gen(function* () {
        const { repoPath, taskId } = input;
        const { runtime } = yield* resolveRuntime(repoPath, taskId);
        const errors = yield* stopRuntime(runtime);
        emitSnapshot(runtime);
        if (errors.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "dev_server.stop",
              message: errors.join("\n"),
              details: { repoPath, taskId },
            }),
          );
        }
        return devServerGroupStateSchema.parse(runtime.state);
      });
    },
  };
  const disposableService: DisposableDevServerService = {
    ...service,
    stopAll() {
      return Effect.gen(function* () {
        const errors: string[] = [];
        const stoppedScripts: StoppedDevServerScript[] = [];
        for (const runtime of groups.values()) {
          stoppedScripts.push(...listRunningScripts(runtime));
          errors.push(...(yield* stopRuntime(runtime)));
          emitSnapshot(runtime);
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
    },
  };
  return disposableService;
};
