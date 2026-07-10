import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  type ClaudeRuntimeCommandName,
} from "@openducktor/contracts";
import type {
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListAgentSubagentsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import { Effect } from "effect";
import type {
  ClaudeAgentSdkService,
  ClaudeAgentSdkServiceError,
} from "../../application/runtimes/claude-agent-sdk-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandler, HostCommandHandlers } from "../router/host-command-router";
import { requireRecord } from "./command-inputs";

type ClaudeRuntimeCommandContract =
  (typeof CLAUDE_RUNTIME_COMMAND_CONTRACTS)[keyof typeof CLAUDE_RUNTIME_COMMAND_CONTRACTS];

type ClaudeAgentSdkServiceCommand<Input> = (
  service: ClaudeAgentSdkService,
  input: Input,
) => Effect.Effect<unknown, ClaudeAgentSdkServiceError>;

type ClaudeAgentSdkServiceCommandDispatcher = (
  service: ClaudeAgentSdkService,
  input: unknown,
) => Effect.Effect<unknown, ClaudeAgentSdkServiceError>;

const typedClaudeServiceCommand =
  <Input>(invoke: ClaudeAgentSdkServiceCommand<Input>): ClaudeAgentSdkServiceCommandDispatcher =>
  (service, input) =>
    invoke(service, input as Input);

const CLAUDE_AGENT_SDK_SERVICE_COMMANDS = {
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels.command]:
    typedClaudeServiceCommand<ListAgentModelsInput>((service, input) =>
      service.listAvailableModels(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands.command]:
    typedClaudeServiceCommand<ListAgentSlashCommandsInput>((service, input) =>
      service.listAvailableSlashCommands(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills.command]:
    typedClaudeServiceCommand<ListAgentSkillsInput>((service, input) =>
      service.listAvailableSkills(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents.command]:
    typedClaudeServiceCommand<ListAgentSubagentsInput>((service, input) =>
      service.listAvailableSubagents(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles.command]:
    typedClaudeServiceCommand<SearchAgentFilesInput>((service, input) =>
      service.searchFiles(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory.command]:
    typedClaudeServiceCommand<LoadAgentSessionHistoryInput>((service, input) =>
      service.loadSessionHistory(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos.command]:
    typedClaudeServiceCommand<LoadAgentSessionTodosInput>((service, input) =>
      service.loadSessionTodos(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff.command]:
    typedClaudeServiceCommand<LoadAgentSessionDiffInput>((service, input) =>
      service.loadSessionDiff(input),
    ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus.command]:
    typedClaudeServiceCommand<LoadAgentFileStatusInput>((service, input) =>
      service.loadFileStatus(input),
    ),
} satisfies Record<ClaudeRuntimeCommandName, ClaudeAgentSdkServiceCommandDispatcher>;

const toClaudeCommandValidationError = (
  command: ClaudeRuntimeCommandName,
  cause: unknown,
): HostValidationError => {
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

const parseCommandInput = (
  command: ClaudeRuntimeCommandName,
  contract: ClaudeRuntimeCommandContract,
  args: Record<string, unknown> | undefined,
): unknown => {
  const envelope = requireRecord(args, `${command} args`);
  return contract.inputSchema.parse(requireRecord(envelope.input, `${command} input`));
};

const createClaudeCommandHandler = (
  service: ClaudeAgentSdkService,
  contract: ClaudeRuntimeCommandContract,
): HostCommandHandler => {
  const command = contract.command;
  const serviceCommand = CLAUDE_AGENT_SDK_SERVICE_COMMANDS[command];
  return (args) =>
    Effect.gen(function* () {
      const input = yield* Effect.try({
        try: () => parseCommandInput(command, contract, args),
        catch: (cause) => toClaudeCommandValidationError(command, cause),
      });
      const output = yield* serviceCommand(service, input);
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
): HostCommandHandlers =>
  Object.fromEntries(
    Object.values(CLAUDE_RUNTIME_COMMAND_CONTRACTS).map((contract) => [
      contract.command,
      createClaudeCommandHandler(service, contract),
    ]),
  ) as HostCommandHandlers;
