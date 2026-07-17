import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  type ClaudeRuntimeCommandContract,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import { requireLiveClaudeWorkspaceRuntime } from "../../application/runtimes/claude-workspace-runtime";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { HostCommandHandler, HostCommandHandlers } from "../router/host-command-router";
import { requireRecord } from "./command-inputs";

const toClaudeCommandValidationError = (command: string, cause: unknown): HostValidationError => {
  if (cause instanceof HostValidationError) {
    return cause;
  }
  return new HostValidationError({
    message: cause instanceof Error ? cause.message : String(cause),
    field: "args",
    cause,
    details: { command },
  });
};

const createClaudeCommandHandler = <Input, Response>(
  service: ClaudeAgentSdkService,
  contract: ClaudeRuntimeCommandContract<Input, Response>,
  invoke: (service: ClaudeAgentSdkService, input: Input) => Effect.Effect<unknown, HostError>,
): HostCommandHandler => {
  const command = contract.command;
  return (args) =>
    Effect.gen(function* () {
      const input = yield* Effect.try({
        try: () => {
          const envelope = requireRecord(args, `${command} args`);
          return contract.inputSchema.parse(requireRecord(envelope.input, `${command} input`));
        },
        catch: (cause) => toClaudeCommandValidationError(command, cause),
      });
      const output = yield* invoke(service, input);
      return yield* Effect.try({
        try: () => contract.responseSchema.parse(output),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            field: "result",
            cause,
            details: { command },
          }),
      });
    });
};

export const createClaudeRuntimeCommandHandlers = (
  service: ClaudeAgentSdkService,
  runtimeRegistry: RuntimeRegistryPort,
): HostCommandHandlers => ({
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels,
    (runtimeService, input) => runtimeService.listAvailableModels(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands,
    (runtimeService, input) => runtimeService.listAvailableSlashCommands(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills,
    (runtimeService, input) => runtimeService.listAvailableSkills(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents,
    (runtimeService, input) => runtimeService.listAvailableSubagents(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles,
    (runtimeService, input) => runtimeService.searchFiles(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory,
    (runtimeService, input) =>
      requireLiveClaudeWorkspaceRuntime(runtimeRegistry, input).pipe(
        Effect.flatMap(() =>
          runtimeService.loadSessionHistory({
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            runtimePolicy: input.runtimePolicy,
            ...(input.sessionScope ? { sessionScope: input.sessionScope } : {}),
            ...(input.systemPromptContext
              ? { systemPromptContext: input.systemPromptContext }
              : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          }),
        ),
      ),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos,
    (runtimeService, input) => runtimeService.loadSessionTodos(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff,
    (runtimeService, input) =>
      runtimeService.loadSessionDiff({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        ...(input.runtimeHistoryAnchor ? { runtimeHistoryAnchor: input.runtimeHistoryAnchor } : {}),
      }),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus,
    (runtimeService, input) => runtimeService.loadFileStatus(input),
  ),
});
