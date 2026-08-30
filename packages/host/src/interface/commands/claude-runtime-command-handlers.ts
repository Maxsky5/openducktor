import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  type ClaudeRuntimeCommandContract,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import {
  type ClaudeWorkspaceWorkingDirectoryDependencies,
  requireClaudeWorkspaceWorkingDirectory,
  requireLiveClaudeWorkspaceRuntime,
} from "../../application/runtimes/claude-workspace-runtime";
import {
  type HostError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { commandInputRecordSchema, type HostCommandArgs, requireRecord } from "./command-inputs";

const requireClaudeRuntimeWorkingDirectory = (
  runtimeRegistry: RuntimeRegistryPort,
  dependencies: ClaudeWorkspaceWorkingDirectoryDependencies,
  input: { repoPath: string; runtimeKind: string; workingDirectory: string },
) =>
  requireLiveClaudeWorkspaceRuntime(runtimeRegistry, input).pipe(
    Effect.flatMap(() => requireClaudeWorkspaceWorkingDirectory(dependencies, input)),
  );

const toClaudeCommandValidationError = (
  command: string,
  cause: unknown,
): HostValidationErrorAggregate => {
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

type ClaudeRuntimeCommandService = Pick<
  ClaudeAgentSdkService,
  | "listAvailableModels"
  | "listAvailableSkills"
  | "listAvailableSlashCommands"
  | "listAvailableSubagents"
  | "loadFileStatus"
  | "loadSessionDiff"
  | "loadSessionHistory"
  | "loadSessionTodos"
  | "searchFiles"
>;

const createClaudeCommandHandler = <Input, Response>(
  service: ClaudeRuntimeCommandService,
  contract: ClaudeRuntimeCommandContract<Input, Response>,
  invoke: (
    service: ClaudeRuntimeCommandService,
    input: Input,
  ) => Effect.Effect<Response, HostError>,
) => {
  const command = contract.command;
  return (args: HostCommandArgs) =>
    Effect.gen(function* () {
      const input = yield* Effect.try({
        try: () => {
          const envelope = requireRecord(
            commandInputRecordSchema.safeParse(args),
            `${command} args`,
          );
          return contract.inputSchema.parse(
            requireRecord(commandInputRecordSchema.safeParse(envelope.input), `${command} input`),
          );
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
  service: ClaudeRuntimeCommandService,
  runtimeRegistry: RuntimeRegistryPort,
  dependencies: ClaudeWorkspaceWorkingDirectoryDependencies,
) =>
  ({
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels,
      (runtimeService, input) =>
        requireLiveClaudeWorkspaceRuntime(runtimeRegistry, input).pipe(
          Effect.flatMap(() => runtimeService.listAvailableModels(input)),
        ),
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands,
      (runtimeService, input) =>
        requireClaudeRuntimeWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
          Effect.flatMap(() => runtimeService.listAvailableSlashCommands(input)),
        ),
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills,
      (runtimeService, input) =>
        requireClaudeRuntimeWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
          Effect.flatMap(() => runtimeService.listAvailableSkills(input)),
        ),
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents,
      (runtimeService, input) =>
        requireClaudeRuntimeWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
          Effect.flatMap(() => runtimeService.listAvailableSubagents(input)),
        ),
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles,
      (runtimeService, input) =>
        requireClaudeRuntimeWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
          Effect.flatMap(() => runtimeService.searchFiles(input)),
        ),
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory,
      (runtimeService, input) =>
        requireClaudeRuntimeWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
          Effect.flatMap(() => {
            const historyInput: Parameters<typeof runtimeService.loadSessionHistory>[0] = {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
              runtimePolicy: input.runtimePolicy,
            };
            if (input.sessionScope) historyInput.sessionScope = input.sessionScope;
            if (input.model) historyInput.model = input.model;
            if (input.systemPromptContext) {
              historyInput.systemPromptContext = input.systemPromptContext;
            }
            if (input.limit !== undefined) historyInput.limit = input.limit;
            return runtimeService.loadSessionHistory(historyInput);
          }),
        ),
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos,
      (runtimeService, input) => {
        const todosInput: Parameters<typeof runtimeService.loadSessionTodos>[0] = {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
          runtimePolicy: input.runtimePolicy,
        };
        if (input.model) todosInput.model = input.model;
        if (input.sessionScope) todosInput.sessionScope = input.sessionScope;
        return requireClaudeRuntimeWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
          Effect.flatMap(() => runtimeService.loadSessionTodos(todosInput)),
        );
      },
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff,
      (runtimeService, input) => {
        const diffInput: Parameters<typeof runtimeService.loadSessionDiff>[0] = {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
        };
        if (input.runtimeHistoryAnchor) {
          diffInput.runtimeHistoryAnchor = input.runtimeHistoryAnchor;
        }
        return runtimeService.loadSessionDiff(diffInput);
      },
    ),
    [CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus.command]: createClaudeCommandHandler(
      service,
      CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus,
      (runtimeService, input) => runtimeService.loadFileStatus(input),
    ),
  }) satisfies HostCommandHandlerDefinitions;
