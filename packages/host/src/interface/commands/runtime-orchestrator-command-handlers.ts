import { agentSessionStopTargetSchema } from "@openducktor/contracts";
import type {
  RuntimeListInput,
  RuntimeOrchestratorService,
  RuntimeRepoInput,
  RuntimeStopInput,
} from "../../application/runtimes/runtime-orchestrator-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireString } from "./command-inputs";

const parseRuntimeListInput = (args: Record<string, unknown> | undefined): RuntimeListInput => {
  const record = requireRecord(args, "runtime_list input");
  const runtimeKind = requireString(record.runtimeKind, "runtimeKind");
  const repoPath = optionalString(record.repoPath, "repoPath");
  return repoPath ? { runtimeKind, repoPath } : { runtimeKind };
};

const parseRuntimeRepoInput = (
  args: Record<string, unknown> | undefined,
  label: string,
): RuntimeRepoInput => {
  const record = requireRecord(args, `${label} input`);
  return {
    runtimeKind: requireString(record.runtimeKind, "runtimeKind"),
    repoPath: requireString(record.repoPath, "repoPath"),
  };
};

const parseRuntimeStopInput = (args: Record<string, unknown> | undefined): RuntimeStopInput => {
  const record = requireRecord(args, "runtime_stop input");
  return { runtimeId: requireString(record.runtimeId, "runtimeId") };
};

const parseAgentSessionStopInput = (args: Record<string, unknown> | undefined) => {
  const record = requireRecord(args, "agent_session_stop input");
  const parsed = agentSessionStopTargetSchema.safeParse(record.request);
  if (parsed.success) {
    return parsed.data;
  }

  throw new HostValidationError({
    message: `agent_session_stop input.request is invalid: ${parsed.error.message}`,
    field: "request",
    cause: parsed.error,
  });
};

export const createRuntimeOrchestratorCommandHandlers = (
  runtimeOrchestratorService: RuntimeOrchestratorService,
): HostCommandHandlers => ({
  agent_session_stop: (args) =>
    runtimeOrchestratorService.agentSessionStop(parseAgentSessionStopInput(args)),
  runtime_ensure: (args) =>
    runtimeOrchestratorService.runtimeEnsure(parseRuntimeRepoInput(args, "runtime_ensure")),
  runtime_require: (args) =>
    runtimeOrchestratorService.runtimeRequire(parseRuntimeRepoInput(args, "runtime_require")),
  runtime_list: (args) => runtimeOrchestratorService.runtimeList(parseRuntimeListInput(args)),
  runtime_startup_status: (args) =>
    runtimeOrchestratorService.runtimeStartupStatus(
      parseRuntimeRepoInput(args, "runtime_startup_status"),
    ),
  runtime_stop: (args) => runtimeOrchestratorService.runtimeStop(parseRuntimeStopInput(args)),
  repo_runtime_health: (args) =>
    runtimeOrchestratorService.repoRuntimeHealth(
      parseRuntimeRepoInput(args, "repo_runtime_health"),
    ),
  repo_runtime_health_status: (args) =>
    runtimeOrchestratorService.repoRuntimeHealthStatus(
      parseRuntimeRepoInput(args, "repo_runtime_health_status"),
    ),
});
