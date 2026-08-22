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
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import type { ClaudeWorkspaceWorkingDirectoryDependencies } from "../../application/runtimes/claude-workspace-runtime";
import type { HostOperationError } from "../../effect/host-errors";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

type ClaudeRuntimeSessionOperations = Exclude<ClaudeRuntimeSessionOperationsPort, undefined>;

export type ClaudeRuntimeComposition = {
  agentSdkService: ClaudeAgentSdkService;
  sessionOperations: ClaudeRuntimeSessionOperations;
  workspaceStarter: RuntimeWorkspaceStarterPort;
};

export type CreateClaudeRuntimeCompositionInput = {
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  onBackgroundFailure: (failure: HostOperationError) => Effect.Effect<void, never>;
  processEnv?: NodeJS.ProcessEnv;
  resolveMcpBridgeConnection: ClaudeMcpBridgeConnectionResolver;
  runtimeExecutableProbe: RuntimeExecutableProbePort;
  runtimeDistribution: HostRuntimeDistribution;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
  workingDirectoryDependencies: ClaudeWorkspaceWorkingDirectoryDependencies;
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
  const agentSdkService = createClaudeAgentSdkService({
    emit: eventHub.emit,
    onBackgroundFailure,
    ...(() => {
      if (processEnv) {
        return { processEnv };
      }
      return {};
    })(),
    resolveMcpBridgeConnection,
    runtimeDistribution,
    settingsConfig,
    sessionStore,
    toolDiscovery,
  });
  const prepareLiveSessionAdapter = createClaudeLiveSessionAdapterPreparer({
    eventHub,
    liveSessionLifecycle,
    service: agentSdkService,
    sessionStore,
    workingDirectoryDependencies,
  });

  return {
    agentSdkService,
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
