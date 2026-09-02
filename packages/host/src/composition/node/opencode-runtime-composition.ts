import {
  createPrepareOpencodeSessionRuntime,
  type ReadOpencodeDirectory,
} from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  createOpenCodeWorkspaceRuntimeStarter,
  type OpenCodeMcpBridgeConnectionResolver,
} from "../../adapters/opencode/opencode-workspace-runtime-starter";
import type { HostRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { TaskSessionBootstrapCoordinator } from "../../application/tasks/worktrees/task-session-bootstrap-coordinator";
import { toHostOperationError } from "../../effect/host-errors";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export type CreateOpenCodeRuntimeCompositionInput = {
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  processEnv: NodeJS.ProcessEnv;
  resolveMcpBridgeConnection: OpenCodeMcpBridgeConnectionResolver;
  runtimeDistribution: HostRuntimeDistribution;
  settingsConfig: SettingsConfigPort;
  taskSessionBootstrapCoordinator: TaskSessionBootstrapCoordinator;
  toolDiscovery: ToolDiscoveryPort;
};

export const createOpenCodeRuntimeComposition = ({
  liveSessionLifecycle,
  processEnv,
  resolveMcpBridgeConnection,
  runtimeDistribution,
  settingsConfig,
  taskSessionBootstrapCoordinator,
  toolDiscovery,
}: CreateOpenCodeRuntimeCompositionInput): RuntimeWorkspaceStarterPort => {
  const readDirectory: ReadOpencodeDirectory = (directory, read) =>
    Effect.runPromise(
      taskSessionBootstrapCoordinator.runWorktreeRead(
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

  return createOpenCodeWorkspaceRuntimeStarter({
    toolDiscovery,
    settingsConfig,
    processEnv,
    runtimeDistribution,
    liveSessionLifecycle,
    prepareLiveSessionAdapter: createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle,
      prepareRuntime: createPrepareOpencodeSessionRuntime({
        readDirectory,
      }),
    }),
    resolveMcpBridgeConnection,
  });
};
