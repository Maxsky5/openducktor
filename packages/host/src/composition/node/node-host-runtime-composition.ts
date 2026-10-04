import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  type HostRuntimeStatus,
  type RuntimeKind,
  resolveCodexEffectivePolicy,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createCodexLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/codex-live-session-adapter";
import { createCodexRuntimeStarter } from "../../adapters/codex/codex-runtime-starter";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createOpenDucktorMcpServerConfigResolver } from "../../adapters/mcp/openducktor-mcp-server-config";
import type { RuntimeAdmissionGate } from "../../adapters/runtimes/runtime-admission";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import { createRuntimeSessionOperations } from "../../adapters/runtimes/runtime-session-operations";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createClaudeLaunchPolicy } from "../../application/runtimes/claude-launch-policy";
import { createHostRuntimeService } from "../../application/runtimes/host-runtime-service";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import type { TaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import {
  loadGlobalConfig,
  type WorkspaceSettingsService,
} from "../../application/workspaces/workspace-settings-model";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../host-lifecycle";
import { resolveClaudeMcpBridgeConnection } from "./claude-mcp-bridge-connection";
import { createClaudeRuntimeComposition } from "./claude-runtime-composition";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import { createOpenCodeRuntimeComposition } from "./opencode-runtime-composition";
import { createRuntimeStatusPublisher } from "./runtime-lifecycle-publisher";
import { describeRuntimeStatusChange } from "./runtime-status-log";
import { guardRuntimeStart } from "./user-path-start-guard";

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
  runtimeAdmission,
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
  runtimeAdmission: RuntimeAdmissionGate;
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
    processEnvironment,
    runtimeDistribution,
    runtimeExecutableProbes,
    runtimeHealth,
    toolDiscovery,
  } = defaultPorts;
  const processEnv = processEnvironment.environment;
  const mcpServerConfigFor = (runtimeName: string) =>
    createOpenDucktorMcpServerConfigResolver({
      resolveBridge,
      runtimeDistribution,
      runtimeName,
      toolDiscovery,
    });
  // Shared runtimes start in the user home directory. Each operation names its own directory.
  const launchDirectory = homedir();
  const claudeRuntime = createClaudeRuntimeComposition({
    launchPolicy: createClaudeLaunchPolicy(settingsConfig),
    liveSessionLifecycle: liveState,
    onBackgroundFailure,
    processEnv,
    runtimeExecutableProbe: runtimeExecutableProbes.claude,
    runtimeDistribution,
    toolDiscovery,
    workingDirectoryDependencies,
    resolveMcpBridgeConnection: (repoPath) =>
      resolveClaudeMcpBridgeConnection(resolveBridge(), repoPath),
  });
  const codexStarterInput: Parameters<typeof createCodexRuntimeStarter>[0] = {
    toolDiscovery,
    codexAppServer: codexTransportRegistry,
    launchDirectory,
    liveSessionLifecycle: liveState,
    prepareLiveSessionAdapter: createCodexLiveSessionAdapterPreparer({
      prepareImageGenerations: defaultPorts.imageWorkers.prepareHistory,
      liveSessionLifecycle: liveState,
      codexAppServer,
      onBackgroundFailure,
      resolveMcpServerConfig: mcpServerConfigFor("Codex"),
      resolveRuntimePolicy: (scope) =>
        loadGlobalConfig(settingsConfig).pipe(
          Effect.map(({ agentRuntimes: { codex } }) =>
            resolveCodexEffectivePolicy(codex, scope.kind === "workflow" ? scope.role : null),
          ),
        ),
    }),
    processEnv,
  };
  if (clientVersion) codexStarterInput.clientVersion = clientVersion;
  const runtimeStarters = {
    claude: claudeRuntime.runtimeStarter,
    codex: createCodexRuntimeStarter(codexStarterInput),
    opencode: createOpenCodeRuntimeComposition({
      launchDirectory,
      liveSessionLifecycle: liveState,
      processEnv,
      resolveMcpServerConfig: mcpServerConfigFor("OpenCode"),
      settingsConfig,
      taskSessionLifecycleCoordinator,
      toolDiscovery,
    }),
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
  const lastRuntimeStates = new Map<RuntimeKind, HostRuntimeStatus["state"]>();
  // Every runtime state change reaches the host log, even when no frontend is connected.
  const onRuntimeStatusChanged = (status: HostRuntimeStatus) => {
    publishRuntimeStatus(status);
    const log = describeRuntimeStatusChange(
      lastRuntimeStates.get(status.kind),
      status,
      descriptorFor(status.kind).label,
    );
    lastRuntimeStates.set(status.kind, status.state);
    if (!log) return;
    Effect.runFork(
      writeHostLifecycleLog(lifecycleLogger, log.level, log.message).pipe(
        Effect.catchAll(onBackgroundFailure),
      ),
    );
  };
  const registry = createRuntimeRegistry({
    admission: runtimeAdmission,
    starter: guardRuntimeStart(
      configuredRuntimeStarter ?? {
        startRuntime: (runtimeInput) =>
          runtimeStarters[runtimeInput.runtimeKind].startRuntime(runtimeInput),
      },
      processEnvironment,
    ),
    descriptorFor,
    onStatusChanged: onRuntimeStatusChanged,
    probeVersion: (kind, executablePath) =>
      runtimeHealth.getRuntimeHealth(kind, executablePath).pipe(
        Effect.map((health) => health.version),
        Effect.orElseSucceed(() => null),
      ),
    sessionOperations: createRuntimeSessionOperations({
      codexAppServer,
      claudeAgentSdk: claudeRuntime.sessionOperations,
    }),
  });
  const hostRuntimeService = createHostRuntimeService({
    hostInstanceId,
    registry,
    settingsConfig,
    settingsService: workspaceSettingsService,
    liveSessions: liveState,
    toolDiscovery,
    logError: (message) =>
      writeHostLifecycleLog(lifecycleLogger, "error", message).pipe(Effect.ignore),
  });
  return { descriptorFor, hostRuntimeService, registry };
};
