import type { ManagedMcpServerResolver } from "@openducktor/core";
import { createOpenCodeCreationSettings } from "../../application/workspaces/opencode-creation-settings";
import {
  createPrepareOpencodeSessionRuntime,
  type ReadOpencodeDirectory,
} from "@openducktor/adapters-opencode-sdk";
import { Effect, Exit } from "effect";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import type { OpenDucktorMcpServerConfigResolver } from "../../adapters/mcp/openducktor-mcp-server-config";
import { createOpenCodeRuntimeStarter } from "../../adapters/opencode/opencode-runtime-starter";
import type { TaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { causeToHostBoundaryError, toHostOperationError } from "../../effect/host-errors";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
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

export const createOpenCodeRuntimeComposition = ({
  launchDirectory,
  liveSessionLifecycle,
  readEnv,
  resolveMcpServerConfig,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  toolDiscovery,
}: CreateOpenCodeRuntimeCompositionInput): RuntimeStarterPort => {
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
              toHostOperationError(cause, "opencode-live-session.read-directory", { directory }),
          });
        }),
      ),
    );
  const resolveOpencodeMcpServerConfig: ManagedMcpServerResolver = async (repoPath) => {
    const exit = await Effect.runPromiseExit(resolveMcpServerConfig(repoPath));
    if (Exit.isSuccess(exit)) return exit.value;
    throw causeToHostBoundaryError(exit.cause);
  };

  return createOpenCodeRuntimeStarter({
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
};
