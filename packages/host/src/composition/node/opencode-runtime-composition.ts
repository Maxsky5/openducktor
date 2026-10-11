import type { ManagedMcpServerResolver } from "@openducktor/core";
import { createOpenCodeCreationSettings } from "../../application/workspaces/opencode-creation-settings";
import {
  createPrepareOpencodeSessionRuntime,
  createOpenCodeRuntimeProbes,
  OpenCodeOperationError,
  type OpenCodeRuntimeConnection,
  type ReadOpencodeDirectory,
} from "@openducktor/adapters-opencode-sdk";
import { Effect, Exit } from "effect";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import type { OpenDucktorMcpServerConfigResolver } from "../../adapters/mcp/openducktor-mcp-server-config";
import { createOpenCodeRuntimeStarter } from "../../adapters/opencode/opencode-runtime-starter";
import type { TaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import {
  causeToHostBoundaryError,
  HostResourceError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export type CreateOpenCodeRuntimeCompositionInput = {
  /** Process working directory of the shared OpenCode server, such as the user home directory. */
  launchDirectory: string;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  readEnv: () => NodeJS.ProcessEnv;
  resolveMcpServerConfig: OpenDucktorMcpServerConfigResolver;
  settingsConfig: SettingsConfigPort;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
  toolDiscovery: ToolDiscoveryPort;
};

type OpenCodeRuntimeComposition = {
  runtimeStarter: RuntimeStarterPort;
  sessionOperations: RuntimeSessionOperations;
};

export const createOpenCodeRuntimeComposition = ({
  launchDirectory,
  liveSessionLifecycle,
  readEnv,
  resolveMcpServerConfig,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  toolDiscovery,
}: CreateOpenCodeRuntimeCompositionInput): OpenCodeRuntimeComposition => {
  const connections = new Map<string, OpenCodeRuntimeConnection>();
  const requireConnection = (runtimeId: string) =>
    Effect.suspend(() => {
      const connection = connections.get(runtimeId);
      return connection
        ? Effect.succeed(createOpenCodeRuntimeProbes(connection))
        : Effect.fail(
            new HostResourceError({
              resource: "OpenCode connection",
              message:
                "The owned OpenCode V2 connection closed. Restart OpenCode from Diagnostics.",
            }),
          );
    });
  const creationSettings = createOpenCodeCreationSettings(settingsConfig);
  const readDirectory: ReadOpencodeDirectory = (directory, read) =>
    Effect.runPromise(
      taskSessionLifecycleCoordinator.runWorktreeRead(
        directory,
        Effect.gen(function* () {
          if (!(yield* settingsConfig.pathExists(directory))) {
            return null;
          }
          return yield* Effect.tryPromise({
            try: read,
            catch: (cause) =>
              cause instanceof OpenCodeOperationError
                ? cause
                : toHostOperationError(cause, "opencode-live-session.read-directory", {
                    directory,
                  }),
          });
        }),
      ),
    );
  const resolveOpencodeMcpServerConfig: ManagedMcpServerResolver = async (repoPath) => {
    const exit = await Effect.runPromiseExit(resolveMcpServerConfig(repoPath));
    if (Exit.isSuccess(exit)) return exit.value;
    throw causeToHostBoundaryError(exit.cause);
  };

  const runtimeStarter = createOpenCodeRuntimeStarter({
    onConnectionReady: (connection) => {
      connections.set(connection.runtimeId, connection);
    },
    onConnectionClosed: (runtimeId) => {
      connections.delete(runtimeId);
    },
    toolDiscovery,
    readEnv,
    launchDirectory,
    liveSessionLifecycle,
    prepareLiveSessionAdapter: createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle,
      prepareRuntime: createPrepareOpencodeSessionRuntime({
        readDirectory,
        resolveCreationSettings: (scope) => Effect.runPromise(creationSettings.resolve(scope)),
        resolveMcpServerConfig: resolveOpencodeMcpServerConfig,
      }),
    }),
  });
  return {
    runtimeStarter,
    sessionOperations: {
      stopSession: (input, runtime) =>
        requireConnection(runtime.runtimeId).pipe(
          Effect.flatMap((probes) =>
            Effect.tryPromise({
              try: () =>
                probes.stopSession({
                  ...input,
                  repoPath: input.workingDirectory,
                  runtimeKind: "opencode",
                }),
              catch: (cause) => toHostOperationError(cause, "opencode.stopSession"),
            }),
          ),
        ),
      probeSessionStatus: (input, runtime) =>
        requireConnection(runtime.runtimeId).pipe(
          Effect.flatMap((probes) =>
            Effect.tryPromise({
              try: () =>
                probes.probeSessionStatus({
                  ...input,
                  repoPath: input.workingDirectory,
                  runtimeKind: "opencode",
                }),
              catch: (cause) => toHostOperationError(cause, "opencode.probeSessionStatus"),
            }),
          ),
        ),
    },
  };
};
