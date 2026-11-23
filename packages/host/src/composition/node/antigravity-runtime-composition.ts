import {
  type AntigravityRuntimeConfig,
  resolveAntigravitySessionMode,
} from "@openducktor/contracts";
import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import { createAntigravityLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/antigravity-live-session-adapter";
import { createAntigravityRuntimeStarter } from "../../adapters/antigravity/antigravity-runtime-starter";
import { AntigravityRuntimeSessions } from "../../adapters/antigravity/antigravity-runtime-sessions";
import type { CodexDirectoryMatcher } from "../../adapters/codex/codex-directory-identity";
import { createWorkspaceFileSearch } from "../../adapters/file-search/workspace-file-search";
import type { OpenDucktorMcpServerConfigResolver } from "../../adapters/mcp/openducktor-mcp-server-config";
import type { RuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export type AntigravityRuntimeComposition = {
  readonly sessionOperations: RuntimeSessionOperations;
  readonly runtimeStarter: RuntimeStarterPort;
};

/**
 * Composes the shared Antigravity runtime of this host. Each runtime start prepares one live
 * adapter for one `agy acp` process, and the session operations find it by its runtime ID.
 */
export const createAntigravityRuntimeComposition = ({
  attachmentStageDirectory,
  clientVersion,
  directoriesMatch,
  launchDirectory,
  liveSessionLifecycle,
  readEnv,
  readRuntimeSettings,
  resolveMcpServerConfig,
  resolveWorkflowRolePolicy,
  toolDiscovery,
}: {
  attachmentStageDirectory: string;
  clientVersion: string | undefined;
  directoriesMatch: CodexDirectoryMatcher;
  launchDirectory: string;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  readEnv: () => NodeJS.ProcessEnv;
  /** The Antigravity runtime settings. A session reads them when it starts or opens again. */
  readRuntimeSettings: () => Effect.Effect<AntigravityRuntimeConfig, HostError>;
  resolveMcpServerConfig: OpenDucktorMcpServerConfigResolver;
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  toolDiscovery: ToolDiscoveryPort;
}): AntigravityRuntimeComposition => {
  const runtimeSessions = new AntigravityRuntimeSessions();
  const starterInput: Parameters<typeof createAntigravityRuntimeStarter>[0] = {
    launchDirectory,
    liveSessionLifecycle,
    prepareLiveSessionAdapter: createAntigravityLiveSessionAdapterPreparer({
      attachmentStageDirectory,
      createFileSearch: () => createWorkspaceFileSearch(),
      directoriesMatch,
      liveSessionLifecycle,
      readEnv,
      resolveMcpServerConfig,
      resolveSessionMode: (sessionScope) =>
        readRuntimeSettings().pipe(
          Effect.map((settings) =>
            resolveAntigravitySessionMode(
              settings,
              sessionScope.kind === "workflow" ? sessionScope.role : null,
            ),
          ),
        ),
      resolveWorkflowRolePolicy,
      runtimeSessions,
    }),
    readEnv,
    toolDiscovery,
  };
  if (clientVersion) starterInput.clientVersion = clientVersion;
  return {
    runtimeStarter: createAntigravityRuntimeStarter(starterInput),
    sessionOperations: runtimeSessions.operations,
  };
};
