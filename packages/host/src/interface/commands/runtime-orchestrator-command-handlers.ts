import { agentSessionStopTargetSchema } from "@openducktor/contracts";
import type {
  RuntimeListInput,
  RuntimeOrchestratorService,
  RuntimeRepoInput,
  RuntimeStopInput,
} from "../../application/runtimes/runtime-orchestrator-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputOptionalStringSchema,
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  optionalString,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseRuntimeListInput = (args: HostCommandArgs): RuntimeListInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), "runtime_list input");
  const runtimeKind = requireString(
    commandInputStringSchema.safeParse(record.runtimeKind),
    "runtimeKind",
  );
  const repoPath = optionalString(
    commandInputOptionalStringSchema.safeParse(record.repoPath),
    "repoPath",
  );
  return repoPath ? { runtimeKind, repoPath } : { runtimeKind };
};

const parseRuntimeRepoInput = (args: HostCommandArgs, label: string): RuntimeRepoInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), `${label} input`);
  return {
    runtimeKind: requireString(
      commandInputStringSchema.safeParse(record.runtimeKind),
      "runtimeKind",
    ),
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
  };
};

const parseRuntimeStopInput = (args: HostCommandArgs): RuntimeStopInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), "runtime_stop input");
  return {
    runtimeId: requireString(commandInputStringSchema.safeParse(record.runtimeId), "runtimeId"),
  };
};

const parseAgentSessionStopInput = (args: HostCommandArgs) => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "agent_session_stop input",
  );
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
) =>
  ({
    agent_session_stop: (args) =>
      runtimeOrchestratorService.agentSessionStop(parseAgentSessionStopInput(args)),
    runtime_ensure: (args) =>
      runtimeOrchestratorService.runtimeEnsure(parseRuntimeRepoInput(args, "runtime_ensure")),
    runtime_require: (args) =>
      runtimeOrchestratorService.runtimeRequire(parseRuntimeRepoInput(args, "runtime_require")),
    runtime_list: (args) => runtimeOrchestratorService.runtimeList(parseRuntimeListInput(args)),
    runtime_stop: (args) => runtimeOrchestratorService.runtimeStop(parseRuntimeStopInput(args)),
    repo_runtime_health: (args) =>
      runtimeOrchestratorService.repoRuntimeHealth(
        parseRuntimeRepoInput(args, "repo_runtime_health"),
      ),
    repo_runtime_health_status: (args) =>
      runtimeOrchestratorService.repoRuntimeHealthStatus(
        parseRuntimeRepoInput(args, "repo_runtime_health_status"),
      ),
  }) satisfies HostCommandHandlerDefinitions;
