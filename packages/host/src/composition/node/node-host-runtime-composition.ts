import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolveCodexEffectivePolicy, type RuntimeKind } from "@openducktor/contracts";
import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import {
  createRuntimeOrchestrator,
  describeRuntimeStatusChange,
  type RuntimeAdmissionGate,
  type RuntimeObserver,
} from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import { createCodexLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/codex-live-session-adapter";
import { createCodexRuntimeStarter } from "../../adapters/codex/codex-runtime-starter";
import { createCodexDirectoryMatcher } from "../../adapters/codex/codex-directory-identity";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createOpenDucktorMcpServerConfigResolver } from "../../adapters/mcp/openducktor-mcp-server-config";
import { createRuntimeDrivers } from "../../adapters/runtimes/runtime-drivers";
import { createRuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createClaudeLaunchPolicy } from "../../application/runtimes/claude-launch-policy";
import {
  createLiveSessionInventory,
  createRuntimeRegistryPort,
  createRuntimeSettingsSource,
} from "../../application/runtimes/host-runtime-ports";
import { createHostRuntimeService } from "../../application/runtimes/host-runtime-service";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import type { TaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import {
  loadGlobalConfig,
  type WorkspaceSettingsService,
} from "../../application/workspaces/workspace-settings-model";
import { toHostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../host-lifecycle";
import { resolveClaudeMcpBridgeConnection } from "./claude-mcp-bridge-connection";
import { createClaudeRuntimeComposition } from "./claude-runtime-composition";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import { createOpenCodeRuntimeComposition } from "./opencode-runtime-composition";
import { createRuntimeStatusPublisher } from "./runtime-lifecycle-publisher";
import { guardRuntimeStart } from "./user-path-guards";

/** Composes the shared runtime of each kind, its registry, and its lifecycle service. */
export const createNodeHostRuntimeComposition = ({
  clientVersion,
  configuredRuntimeStarter,
  defaultPorts,
  eventBus,
  lifecycleLogger,
  liveState,
  onBackgroundFailure,
  resolveBridge,
  resolveWorkflowRolePolicy,
  runtimeAdmissionGate,
  runtimeDefinitionsService,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  workingDirectoryDependencies,
  workspaceSettingsService,
}: {
  clientVersion: string | undefined;
  configuredRuntimeStarter: RuntimeStarterPort | undefined;
  defaultPorts: NodeHostDefaultPorts;
  eventBus: HostEventBusPort | undefined;
  lifecycleLogger: HostLifecycleLogger;
  liveState: AgentSessionLiveStateService;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  resolveBridge: () => McpHostBridgeServer | undefined;
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  runtimeAdmissionGate: RuntimeAdmissionGate;
  runtimeDefinitionsService: RuntimeDefinitionsService;
  settingsConfig: SettingsConfigPort;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
  workingDirectoryDependencies: Parameters<
    typeof createClaudeRuntimeComposition
  >[0]["workingDirectoryDependencies"];
  workspaceSettingsService: WorkspaceSettingsService;
}) => {
  const {
    codexAppServer,
    codexTransportRegistry,
    runtimeDistribution,
    runtimeExecutableProbes,
    runtimeHealth,
    toolDiscovery,
    userEnvironment,
    readEnv,
  } = defaultPorts;
  const directoriesMatch = createCodexDirectoryMatcher(defaultPorts.filesystem);
  const mcpServerConfigFor = (runtimeKind: RuntimeKind) =>
    createOpenDucktorMcpServerConfigResolver({
      resolveBridge,
      runtimeDistribution,
      runtimeKind,
      toolDiscovery,
    });
  // Shared runtimes start in the user home directory. Each operation names its own directory.
  const launchDirectory = homedir();
  const claudeRuntime = createClaudeRuntimeComposition({
    launchPolicy: createClaudeLaunchPolicy(settingsConfig),
    liveSessionLifecycle: liveState,
    onBackgroundFailure,
    readEnv,
    runtimeExecutableProbe: runtimeExecutableProbes.claude,
    runtimeDistribution,
    toolDiscovery,
    workingDirectoryDependencies,
    resolveMcpBridgeConnection: (repoPath) =>
      resolveClaudeMcpBridgeConnection(resolveBridge(), repoPath),
    resolveWorkflowRolePolicy,
  });
  const codexStarterInput: Parameters<typeof createCodexRuntimeStarter>[0] = {
    toolDiscovery,
    codexAppServer: codexTransportRegistry,
    launchDirectory,
    liveSessionLifecycle: liveState,
    prepareLiveSessionAdapter: createCodexLiveSessionAdapterPreparer({
      directoriesMatch,
      prepareImageGenerations: defaultPorts.imageWorkers.prepareHistory,
      liveSessionLifecycle: liveState,
      codexAppServer,
      onBackgroundFailure,
      resolveMcpServerConfig: mcpServerConfigFor("codex"),
      resolveRuntimePolicy: ({ sessionScope }) =>
        loadGlobalConfig(settingsConfig).pipe(
          Effect.flatMap(({ agentRuntimes: { codex } }) =>
            Effect.try({
              try: () =>
                sessionScope.kind === "workflow"
                  ? resolveCodexEffectivePolicy(
                      codex,
                      sessionScope.role,
                      !resolveWorkflowRolePolicy(sessionScope).readOnly,
                    )
                  : resolveCodexEffectivePolicy(codex, null, false),
              catch: (cause) => toHostOperationError(cause, "codex.resolve-runtime-policy"),
            }),
          ),
        ),
      resolveWorkflowRolePolicy,
    }),
    readEnv,
  };
  if (clientVersion) codexStarterInput.clientVersion = clientVersion;
  const opencodeRuntime = createOpenCodeRuntimeComposition({
    launchDirectory,
    liveSessionLifecycle: liveState,
    readEnv,
    resolveMcpServerConfig: mcpServerConfigFor("opencode"),
    resolveWorkflowRolePolicy,
    settingsConfig,
    taskSessionLifecycleCoordinator,
    toolDiscovery,
  });
  const runtimeStarters = {
    claude: claudeRuntime.runtimeStarter,
    codex: createCodexRuntimeStarter(codexStarterInput),
    opencode: opencodeRuntime.runtimeStarter,
  } satisfies Record<RuntimeKind, RuntimeStarterPort>;
  const descriptorFor = (kind: RuntimeKind) => {
    const descriptor = runtimeDefinitionsService
      .listRuntimeDefinitions()
      .find((definition) => definition.kind === kind);
    if (!descriptor) throw new Error(`Runtime definition for ${kind} is missing.`);
    return descriptor;
  };
  const hostInstanceId = randomUUID();
  const publishRuntimeStatus = eventBus
    ? createRuntimeStatusPublisher(eventBus, hostInstanceId)
    : () => {};
  const writeLog = (level: "info" | "error", message: string) =>
    Effect.runFork(
      writeHostLifecycleLog(lifecycleLogger, level, message).pipe(
        Effect.catch(onBackgroundFailure),
      ),
    );
  // Every runtime state change reaches the host log, even when no frontend is connected.
  const observer: RuntimeObserver = {
    statusChanged: ({ status, previousState }) => {
      publishRuntimeStatus(status);
      const log = describeRuntimeStatusChange(
        previousState,
        status,
        descriptorFor(status.kind).label,
      );
      if (log) writeLog(log.level, log.message);
    },
    backgroundFailure: (message) => writeLog("error", message),
  };
  const startGuard = guardRuntimeStart(
    configuredRuntimeStarter ?? {
      startRuntime: (runtimeInput) =>
        runtimeStarters[runtimeInput.runtimeKind].startRuntime(runtimeInput),
    },
    userEnvironment,
  );
  const orchestrator = createRuntimeOrchestrator({
    drivers: createRuntimeDrivers({
      descriptorFor,
      starters: { opencode: startGuard, codex: startGuard, claude: startGuard },
      sessionOperations: createRuntimeSessionOperations({
        directoriesMatch,
        opencode: opencodeRuntime.sessionOperations,
        codexAppServer,
        claudeAgentSdk: claudeRuntime.sessionOperations,
      }),
      runtimeHealth,
      toolDiscovery,
    }),
    settings: createRuntimeSettingsSource(settingsConfig),
    liveSessions: createLiveSessionInventory(liveState),
    observer,
    admission: runtimeAdmissionGate,
  });
  const hostRuntimeService = createHostRuntimeService({
    hostInstanceId,
    orchestrator,
    settingsService: workspaceSettingsService,
  });
  return { hostInstanceId, hostRuntimeService, registry: createRuntimeRegistryPort(orchestrator) };
};
