import type { Effect } from "effect";
import {
  createClaudeAgentSdkEventHub,
  createClaudeLiveSessionAdapterPreparer,
} from "../../adapters/agent-sessions/claude-live-session-adapter";
import { createClaudeAgentSdkService } from "../../adapters/claude/claude-agent-sdk-service";
import { createClaudeAgentSdkSessionStore } from "../../adapters/claude/claude-agent-sdk-session-store";
import type { ClaudeMcpBridgeConnectionResolver } from "../../adapters/claude/claude-agent-sdk-types";
import { createClaudeWorkspaceRuntimeStarter } from "../../adapters/claude/claude-workspace-runtime-starter";
import type { HostRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { ClaudeRuntimeSessionOperationsPort } from "../../adapters/runtimes/runtime-session-operations";
import type { RuntimeWorkingDirectoryDependencies } from "../../application/runtimes/runtime-working-directory";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

type ClaudeRuntimeSessionOperations = Exclude<ClaudeRuntimeSessionOperationsPort, undefined>;

export type ClaudeRuntimeComposition = {
  sessionOperations: ClaudeRuntimeSessionOperations;
  workspaceStarter: RuntimeWorkspaceStarterPort;
};

export type CreateClaudeRuntimeCompositionInput = {
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  processEnv?: NodeJS.ProcessEnv;
  resolveMcpBridgeConnection: ClaudeMcpBridgeConnectionResolver;
  runtimeExecutableProbe: RuntimeExecutableProbePort;
  runtimeDistribution: HostRuntimeDistribution;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
  workingDirectoryDependencies: RuntimeWorkingDirectoryDependencies;
};

export const createClaudeRuntimeComposition = ({
  liveSessionLifecycle,
  onBackgroundFailure,
  processEnv,
  resolveMcpBridgeConnection,
  runtimeExecutableProbe,
  runtimeDistribution,
  settingsConfig,
  toolDiscovery,
  workingDirectoryDependencies,
}: CreateClaudeRuntimeCompositionInput): ClaudeRuntimeComposition => {
  const eventHub = createClaudeAgentSdkEventHub();
  const sessionStore = createClaudeAgentSdkSessionStore({ emit: eventHub.emit });
  const prepareLiveSessionAdapter: Parameters<
    typeof createClaudeWorkspaceRuntimeStarter
  >[0]["prepareLiveSessionAdapter"] = (runtime, claudeExecutablePath) => {
    const agentSdkServiceInput: Parameters<typeof createClaudeAgentSdkService>[0] = {
      claudeExecutablePath,
      emit: eventHub.emit,
      onBackgroundFailure,
      resolveMcpBridgeConnection,
      runtimeDistribution,
      sessionStore,
      toolDiscovery,
    };
    if (processEnv) {
      agentSdkServiceInput.processEnv = processEnv;
    }
    return createClaudeLiveSessionAdapterPreparer({
      eventHub,
      liveSessionLifecycle,
      service: createClaudeAgentSdkService(agentSdkServiceInput),
      sessionStore,
      workingDirectoryDependencies,
    })(runtime);
  };

  return {
    sessionOperations: {
      stopSession: sessionStore.stopSession,
      probeSessionStatus: sessionStore.probeSessionStatus,
    },
    workspaceStarter: createClaudeWorkspaceRuntimeStarter({
      liveSessionLifecycle,
      prepareLiveSessionAdapter,
      runtimeExecutableProbe,
      settingsConfig,
      toolDiscovery,
    }),
  };
};
