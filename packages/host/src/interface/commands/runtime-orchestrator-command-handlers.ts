import {
  agentSessionStopTargetSchema,
  runtimeKindInputSchema,
  runtimeRestartInputSchema,
} from "@openducktor/contracts";
import type { HostRuntimeService } from "../../application/runtimes/host-runtime-service";
import type { RuntimeOrchestratorService } from "../../application/runtimes/runtime-orchestrator-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  type HostCommandArgs,
  parseCommandInput,
  requireRecord,
} from "./command-inputs";

const parseAgentSessionStopInput = (args: HostCommandArgs) => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "agent_session_stop input",
  );
  const parsed = agentSessionStopTargetSchema.safeParse(record.request);
  if (parsed.success) return parsed.data;
  throw new HostValidationError({
    message: `agent_session_stop input.request is invalid: ${parsed.error.message}`,
    field: "request",
    cause: parsed.error,
  });
};

export const createRuntimeOrchestratorCommandHandlers = (
  runtimeOrchestratorService: RuntimeOrchestratorService,
  hostRuntimeService: HostRuntimeService,
) =>
  ({
    agent_session_stop: (args) =>
      runtimeOrchestratorService.agentSessionStop(parseAgentSessionStopInput(args)),
    runtime_status: () => hostRuntimeService.snapshot(),
    runtime_require: (args) =>
      hostRuntimeService.requireRuntime(
        parseCommandInput(runtimeKindInputSchema, args, "runtime_require").runtimeKind,
      ),
    runtime_restart_impact: (args) =>
      hostRuntimeService.restartImpact(
        parseCommandInput(runtimeKindInputSchema, args, "runtime_restart_impact").runtimeKind,
      ),
    runtime_restart: (args) => {
      const input = parseCommandInput(runtimeRestartInputSchema, args, "runtime_restart");
      return hostRuntimeService.restart(input.runtimeKind, input.confirmation);
    },
  }) satisfies HostCommandHandlerDefinitions;
