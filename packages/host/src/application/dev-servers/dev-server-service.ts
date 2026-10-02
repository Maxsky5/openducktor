import {
  type DevServerCommandInput,
  type DevServerScriptState,
  devServerGroupStateSchema,
  formatDevServerOwnerKey,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  errorMessage,
  HostInvariantError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import type { DevServerProcessHandle } from "../../ports/dev-server-process-port";
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
  type DevServerGroupRuntime,
  inspectDevServerWorkspaceActivity,
  nowIso,
  scriptHasLiveProcess,
  syncGroupState,
  syncRuntimeTerminalSources,
} from "./dev-server-state";
import {
  createDevServerRuntimeResolver,
  type RetiredDevServerOrder,
} from "./dev-server-runtime-resolver";
import { stopAllDevServers } from "./dev-server-shutdown";
import { createDevServerScriptStarter } from "./dev-server-script-starter";

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
  terminalSources,
  taskWorktreeService,
  workspaceSessions,
  workspaceSettingsService,
}: CreateDevServerServiceInput): DisposableDevServerService => {
  const groups = new Map<string, Map<string, DevServerGroupRuntime>>();
  const retiredOrder: RetiredDevServerOrder = {
    revision: null,
  };
  const { publish, publishSnapshot } = createDevServerEventPublisher(eventBus);
  const resolveRuntime = createDevServerRuntimeResolver({
    groups,
    retiredOrder,
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
  const startScript = createDevServerScriptStarter({
    processPort,
    terminalSources,
    updateScriptState,
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
          if (
            !runtime.processes.has(failedScript.scriptId) &&
            !runtime.unresolvedStops.has(failedScript.scriptId)
          ) {
            updateScriptState(runtime, failedScript.scriptId, (script) => {
              script.status = "failed";
              script.lastError = failedScript.message;
            });
          }
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
      syncRuntimeTerminalSources(runtime);
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
        const ownerKey = formatDevServerOwnerKey(owner);
        const runtime = repoGroups?.get(ownerKey);
        if (runtime) {
          for (const output of runtime.terminalOutputs.values()) output.release();
          runtime.terminalOutputs.clear();
          // A restored session must outrank state cached before its archive.
          retiredOrder.revision = Math.max(retiredOrder.revision ?? 0, runtime.state.revision);
          repoGroups?.delete(ownerKey);
        }
        if (repoGroups?.size === 0) groups.delete(repoPath);
      }),
    stopAll: () => stopAllDevServers(groups, stopRuntime, publishSnapshot),
  };
  return disposableService;
};
