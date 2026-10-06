import type { ClaudeLaunchPolicyPort } from "../../application/runtimes/claude-launch-policy";
import type { Effect } from "effect";
import {
  createClaudeAgentSdkEventHub,
  createClaudeLiveSessionAdapterPreparer,
} from "../../adapters/agent-sessions/claude-live-session-adapter";
import { createClaudeAgentSdkService } from "../../adapters/claude/claude-agent-sdk-service";
import { createClaudeAgentSdkSessionStore } from "../../adapters/claude/claude-agent-sdk-session-store";
import type { ClaudeMcpBridgeConnectionResolver } from "../../adapters/claude/claude-agent-sdk-types";
import { createClaudeRuntimeStarter } from "../../adapters/claude/claude-runtime-starter";
import type { HostRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { ClaudeRuntimeSessionOperationsPort } from "../../adapters/runtimes/runtime-session-operations";
import type { RuntimeWorkingDirectoryDependencies } from "../../application/runtimes/runtime-working-directory";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export type ClaudeRuntimeComposition = {
  sessionOperations: ClaudeRuntimeSessionOperationsPort;
  runtimeStarter: RuntimeStarterPort;
};

export type CreateClaudeRuntimeCompositionInput = {
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  readEnv: () => NodeJS.ProcessEnv;
  resolveMcpBridgeConnection: ClaudeMcpBridgeConnectionResolver;
  runtimeExecutableProbe: RuntimeExecutableProbePort;
  runtimeDistribution: HostRuntimeDistribution;
  launchPolicy: ClaudeLaunchPolicyPort;
  toolDiscovery: ToolDiscoveryPort;
  workingDirectoryDependencies: RuntimeWorkingDirectoryDependencies;
};

/**
 * Composes the shared Claude runtime of this host.
 * The session store and event hub live as long as the host.
 * Each runtime start creates one `ClaudeAgentSdkService` with its own file-search cache.
 * A runtime release stops every session of that start, in all repositories, and disposes the service.
 * Each session resolves the MCP bridge from its own repository.
 */
export const createClaudeRuntimeComposition = ({
  liveSessionLifecycle,
  onBackgroundFailure,
  readEnv,
  resolveMcpBridgeConnection,
  runtimeExecutableProbe,
  runtimeDistribution,
  launchPolicy,
  toolDiscovery,
  workingDirectoryDependencies,
}: CreateClaudeRuntimeCompositionInput): ClaudeRuntimeComposition => {
  const eventHub = createClaudeAgentSdkEventHub();
  const sessionStore = createClaudeAgentSdkSessionStore({ emit: eventHub.emit });
  const prepareLiveSessionAdapter: Parameters<
    typeof createClaudeRuntimeStarter
  >[0]["prepareLiveSessionAdapter"] = (runtime, claudeExecutablePath) => {
    const agentSdkServiceInput: Parameters<typeof createClaudeAgentSdkService>[0] = {
      claudeExecutablePath,
      launchPolicy,
      emit: eventHub.emit,
      onBackgroundFailure,
      // Each runtime start reads the environment once, like the other runtime processes.
      processEnv: readEnv(),
      resolveMcpBridgeConnection,
      runtimeDistribution,
      sessionStore,
      toolDiscovery,
    };
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
    runtimeStarter: createClaudeRuntimeStarter({
      liveSessionLifecycle,
      prepareLiveSessionAdapter,
      runtimeExecutableProbe,
      toolDiscovery,
    }),
  };
};
