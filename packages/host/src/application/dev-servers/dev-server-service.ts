import {
  type DevServerCommandInput,
  type DevServerScriptState,
  devServerGroupStateSchema,
  formatDevServerOwnerKey,
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
import { createDevServerEventPublisher } from "./dev-server-event-publisher";
import {
  DEV_SERVER_CLICOLOR_FORCE,
  DEV_SERVER_COLORTERM,
  DEV_SERVER_FORCE_COLOR,
  DEV_SERVER_TERM,
  type DevServerGroupRuntime,
  inspectDevServerWorkspaceActivity,
  nowIso,
  scriptHasLiveProcess,
  startTerminalRun,
  syncGroupState,
  syncRuntimeTerminalBufferByteCounts,
} from "./dev-server-state";
import { createDevServerRuntimeResolver } from "./dev-server-runtime-resolver";
import { stopAllDevServers } from "./dev-server-shutdown";

export type {
  CreateDevServerServiceInput,
  DevServerService,
  DevServerServiceError,
  DevServerStopAllResult,
  DisposableDevServerService,
  StoppedDevServerScript,
} from "./dev-server-service-types";
export const createDevServerService = ({
  withProcessStartAdmission,
  eventBus,
  processPort,
  taskWorktreeService,
  workspaceSessions,
  workspaceSettingsService,
}: CreateDevServerServiceInput): DisposableDevServerService => {
  const hostInstanceId = globalThis.crypto.randomUUID();
  const groups = new Map<string, Map<string, DevServerGroupRuntime>>();
  const { publish, publishSnapshot, terminalWriter } = createDevServerEventPublisher(eventBus);
  const resolveRuntime = createDevServerRuntimeResolver({
    groups,
    taskWorktreeService,
    workspaceSessions,
    workspaceSettingsService,
  });
  const withOwnerGate = <A, E, R>(
    input: DevServerCommandInput,
    operation: Effect.Effect<A, E, R>,
  ) =>
    input.owner.kind === "workspace_session" && workspaceSessions
      ? workspaceSessions.operationGate.run(input.owner, operation)
      : operation;
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
    runtime.state.revision += 1;
    runtime.state.updatedAt = nowIso();
    publish({
      type: "script_status_changed",
      repoPath: runtime.state.repoPath,
      owner: runtime.state.owner,
      script,
      revision: runtime.state.revision,
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
    runtime.unresolvedStops.delete(scriptId);
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
    workingDirectory: string,
    scriptConfig: RepoConfig["devServers"][number],
  ) =>
    Effect.gen(function* () {
      if (!processPort) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "DevServerProcessPort",
            operation: "dev_server.start_script",
            message: "Dev server process port is required to start dev servers.",
          }),
        );
      }
      updateScriptState(runtime, scriptConfig.id, (script) => {
        script.status = "starting";
        script.startedCommand = scriptConfig.command;
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
          cwd: workingDirectory,
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
        if (stopResult._tag === "Left") {
          runtime.processes.set(scriptConfig.id, handle);
          runtime.unresolvedStops.add(scriptConfig.id);
          markStartFailed(runtime, scriptConfig.id, errorMessage(stopResult.left));
        }
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
        const handle = runtime.processes.get(script.scriptId);
        if (script.pid === null && !handle && !runtime.unresolvedStops.has(script.scriptId)) {
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
  const startCore = (input: DevServerCommandInput) =>
    Effect.gen(function* () {
      const knownRepoConfig =
        input.owner.kind === "task"
          ? yield* workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath)
          : undefined;
      const start = Effect.gen(function* () {
        const { repoConfig, runtime, workingDirectory } = yield* resolveRuntime(
          input,
          true,
          knownRepoConfig,
        );
        if (repoConfig.devServers.length === 0) {
          return yield* new HostValidationError({
            field: "devServers",
            message:
              input.owner.kind === "task"
                ? `No builder dev server scripts are configured for ${repoConfig.repoPath}. Add them in repository settings first.`
                : `No dev server scripts are configured for ${repoConfig.repoPath}. Add them in repository settings first.`,
          });
        }
        if (!workingDirectory) {
          return yield* new HostValidationError({
            field: "owner",
            message:
              input.owner.kind === "task"
                ? `Builder continuation cannot start until a task worktree exists for task ${input.owner.taskId}. Start Builder first.`
                : `Workspace Session ${input.owner.sessionId} has no execution directory. Restore its target before starting dev servers.`,
          });
        }
        if (
          runtime.processes.size > 0 ||
          runtime.unresolvedStops.size > 0 ||
          runtime.state.scripts.some(
            (script) =>
              scriptHasLiveProcess(script) ||
              script.status === "starting" ||
              script.status === "running" ||
              script.status === "stopping",
          )
        ) {
          return yield* new HostValidationError({
            field: "owner",
            message:
              input.owner.kind === "task"
                ? `Dev servers are already running for task ${input.owner.taskId}. Stop or restart them instead.`
                : `Dev servers are already active for Workspace Session ${input.owner.sessionId}. Stop or restart them instead.`,
            details: input,
          });
        }
        runtime.state.workingDirectory = workingDirectory;
        publishSnapshot(runtime);
        let failedScript: FailedDevServerScriptStart | null = null;
        for (const script of repoConfig.devServers) {
          const result = yield* Effect.either(startScript(runtime, workingDirectory, script));
          if (result._tag === "Left") {
            failedScript = {
              command: script.command,
              message: errorMessage(result.left),
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
          publishSnapshot(runtime);
          return yield* new HostOperationError({
            operation: "dev_server.start",
            message: [
              "Failed to start all configured dev server scripts.",
              `Failed starting dev server ${failedScript.scriptId}: ${failedScript.message}`,
              ...cleanupErrors,
            ].join("\n"),
            details: {
              cleanupErrors,
              failedScripts: [failedScript],
              stoppedScripts,
              ...input,
            },
          });
        }
        publishSnapshot(runtime);
        if (runtime.state.scripts.some(scriptHasLiveProcess)) {
          return devServerGroupStateSchema.parse(runtime.state);
        }
        return yield* new HostOperationError({
          operation: "dev_server.start",
          message: "Dev server start completed without any live script processes.",
          details: input,
        });
      });
      return yield* (
        withProcessStartAdmission?.(knownRepoConfig?.repoPath ?? input.repoPath, start) ?? start
      );
    });
  const stopCore = (input: DevServerCommandInput) =>
    Effect.gen(function* () {
      const { repoConfig, runtime, workingDirectory } = yield* resolveRuntime(input);
      const errors = yield* stopRuntime(runtime);
      if (errors.length > 0) {
        publishSnapshot(runtime);
        return yield* new HostOperationError({
          operation: "dev_server.stop",
          message: errors.join("\n"),
          details: input,
        });
      }
      syncGroupState(
        runtime.state,
        repoConfig,
        input.owner,
        workingDirectory,
        runtime.unresolvedStops,
      );
      syncRuntimeTerminalBufferByteCounts(runtime);
      publishSnapshot(runtime);
      return devServerGroupStateSchema.parse(runtime.state);
    });
  const service: DevServerService = {
    getState: (input) =>
      resolveRuntime(input).pipe(
        Effect.map(({ runtime }) => devServerGroupStateSchema.parse(runtime.state)),
      ),
    inspectWorkspaceActivity: (input) =>
      Effect.sync(() => inspectDevServerWorkspaceActivity(groups, input.repoPath)),
    restart: (input) =>
      withOwnerGate(
        input,
        Effect.gen(function* () {
          yield* stopCore(input);
          return yield* startCore(input);
        }),
      ),
    start: (input) => withOwnerGate(input, startCore(input)),
    stop: (input) => withOwnerGate(input, stopCore(input)),
    stopWorkspaceSession: (input) => stopCore(input),
  };
  const disposableService: DisposableDevServerService = {
    ...service,
    forgetWorkspaceSession: ({ repoPath, owner }) =>
      Effect.sync(() => {
        const repoGroups = groups.get(repoPath);
        repoGroups?.delete(formatDevServerOwnerKey(owner));
        if (repoGroups?.size === 0) groups.delete(repoPath);
      }),
    stopAll: () => stopAllDevServers(groups, stopRuntime, publishSnapshot),
  };
  return disposableService;
};
