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
  stopStartedScriptsAfterStartFailure,
} from "./dev-server-runtime-scripts";
import type {
  CreateDevServerServiceInput,
  DevServerService,
  DisposableDevServerService,
  FailedDevServerScriptStart,
} from "./dev-server-service-types";
import {
  buildGroupState,
  DEV_SERVER_CLICOLOR_FORCE,
  DEV_SERVER_COLORTERM,
  DEV_SERVER_EVENT_CHANNEL,
  DEV_SERVER_FORCE_COLOR,
  DEV_SERVER_TERM,
  type DevServerGroupRuntime,
  scriptHasLiveProcess,
  startTerminalRun,
  syncGroupState,
  syncRuntimeTerminalBufferByteCounts,
} from "./dev-server-state";
import { createDevServerTerminalWriter } from "./dev-server-terminal-writer";

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
export const createDevServerService = ({
  eventBus,
  processPort,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateDevServerServiceInput): DisposableDevServerService => {
  const hostInstanceId = globalThis.crypto.randomUUID();
  const groups = new Map<string, Map<string, DevServerGroupRuntime>>();
  const publish = (event: DevServerEvent): void =>
    eventBus?.publish(DEV_SERVER_EVENT_CHANNEL, devServerEventSchema.parse(event));
  const terminalWriter = createDevServerTerminalWriter(publish);
  const emitSnapshot = (runtime: DevServerGroupRuntime): void =>
    publish({ type: "snapshot", state: runtime.state });
  const getWorktreePath = (repoPath: string, taskId: string) =>
    Effect.gen(function* () {
      const worktree = taskWorktreeService
        ? yield* taskWorktreeService.getTaskWorktree({ repoPath, taskId })
        : null;
      return worktree?.workingDirectory ?? null;
    });
  const getRuntime = (taskId: string, repoConfig: RepoConfig, worktreePath: string | null) =>
    Effect.sync(() => {
      const repoGroups =
        groups.get(repoConfig.repoPath) ?? new Map<string, DevServerGroupRuntime>();
      const existing = repoGroups.get(taskId);
      if (existing) {
        syncGroupState(existing.state, repoConfig, taskId, worktreePath);
        syncRuntimeTerminalBufferByteCounts(existing);
        return existing;
      }
      const runtime = {
        processes: new Map<string, DevServerProcessHandle>(),
        state: buildGroupState(repoConfig, taskId, worktreePath, nowIso()),
        terminalBufferedBytesByScriptId: new Map<string, number>(),
        terminalNextSequenceByScriptId: new Map<string, number>(),
        terminalRunGeneration: 0,
      };
      repoGroups.set(taskId, runtime);
      groups.set(repoConfig.repoPath, repoGroups);
      return runtime;
    });
  const resolveRuntime = (repoPath: string, taskId: string) =>
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
    terminalWriter.appendSystemMessage(runtime, scriptId, message);
  };
  const handleProcessExit = (
    runtime: DevServerGroupRuntime,
    scriptId: string,
    expectedRunId: string,
    pid: number,
    exitCode: number | null,
    signal: string | null,
    error: string | null,
  ): void => {
    const script = runtime.state.scripts.find((candidate) => candidate.scriptId === scriptId);
    const isStartingWithoutRecordedPid = script?.pid === null && script.status === "starting";
    if (
      !script ||
      script.runIdentity?.runId !== expectedRunId ||
      (script.pid !== pid && !isStartingWithoutRecordedPid)
    ) {
      return;
    }
    runtime.processes.delete(scriptId);
    const expectedStop = script.status === "stopping";
    const message = error ?? devServerExitMessage(exitCode, signal);
    if (!expectedStop) {
      terminalWriter.appendSystemMessage(runtime, scriptId, message);
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
        startTerminalRun(runtime, script, hostInstanceId);
        script.pid = null;
        script.startedAt = null;
        script.exitCode = null;
        script.lastError = null;
      });
      const expectedRunId = runtime.state.scripts.find(
        (candidate) => candidate.scriptId === scriptConfig.id,
      )?.runIdentity?.runId;
      if (!expectedRunId) {
        return yield* Effect.fail(
          new HostInvariantError({
            invariant: "dev_server_script_run_known",
            message: `Dev server script has no active run id: ${scriptConfig.id}`,
          }),
        );
      }
      terminalWriter.appendSystemMessage(
        runtime,
        scriptConfig.id,
        `Starting \`${scriptConfig.command}\``,
      );
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
            handleProcessExit(
              runtime,
              scriptConfig.id,
              expectedRunId,
              pid,
              exitCode,
              signal,
              error,
            ),
          onOutput: ({ data }) =>
            terminalWriter.pushProcessOutput(runtime, scriptConfig.id, expectedRunId, data),
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
        const message = script?.lastError ?? "Dev server exited before startup completed.";
        const stopResult = yield* Effect.either(handle.stop());
        const cleanupMessage =
          stopResult._tag === "Left"
            ? `\nFailed stopping dev server ${scriptConfig.id} after startup failure: ${errorMessage(stopResult.left)}`
            : "";
        return yield* Effect.fail(
          new HostOperationError({
            operation: "dev_server.start_script",
            message: `${message}${cleanupMessage}`,
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
      const stopErrors = yield* Effect.forEach(
        targets,
        (target) =>
          stopScriptProcessHandle({
            handle: target.handle,
            runtime,
            scriptId: target.scriptId,
            updateScriptState,
          }).pipe(Effect.map((stopError) => ({ scriptId: target.scriptId, stopError }))),
        { concurrency: "unbounded" },
      );
      for (const { scriptId, stopError } of stopErrors) {
        if (stopError !== null) {
          errors.push(`Failed stopping dev server ${scriptId}: ${stopError}`);
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
            new HostOperationError({
              operation: "dev_server.start",
              message: [
                "Failed to start all configured dev server scripts.",
                `Failed starting dev server ${failedScript.scriptId}: ${failedScript.message}`,
                ...cleanupErrors,
              ].join("\n"),
              details: {
                cleanupErrors,
                failedScripts: [failedScript],
                repoPath,
                stoppedScripts,
                taskId,
              },
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
        const stoppedScripts: ReturnType<typeof listRunningScripts> = [];
        const runtimes = [...groups.values()].flatMap((repoGroups) => [...repoGroups.values()]);
        const results = yield* Effect.forEach(
          runtimes,
          (runtime) =>
            Effect.gen(function* () {
              const runningScripts = listRunningScripts(runtime);
              const stopErrors = yield* stopRuntime(runtime);
              emitSnapshot(runtime);
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
    },
  };
  return disposableService;
};
