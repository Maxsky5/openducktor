import type { HostCommandHandlers } from "./host-command-router";
import type { RuntimeOrchestratorService } from "./runtime-orchestrator-service";

export const createRuntimeOrchestratorCommandHandlers = (
  runtimeOrchestratorService: RuntimeOrchestratorService,
): HostCommandHandlers => ({
  agent_session_stop: (args) => runtimeOrchestratorService.agentSessionStop(args),
  runtime_ensure: (args) => runtimeOrchestratorService.runtimeEnsure(args),
  runtime_list: (args) => runtimeOrchestratorService.runtimeList(args),
  runtime_startup_status: (args) => runtimeOrchestratorService.runtimeStartupStatus(args),
  runtime_stop: (args) => runtimeOrchestratorService.runtimeStop(args),
  repo_runtime_health: (args) => runtimeOrchestratorService.repoRuntimeHealth(args),
  repo_runtime_health_status: (args) => runtimeOrchestratorService.repoRuntimeHealthStatus(args),
});
