import {
  AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS,
  type AgentRuntimeQueryCommandContract,
  type RepoRuntimeRef,
  runtimeKindSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import {
  runtimeQueryError,
  type RuntimeQueryError,
  type RuntimeQueryIdentity,
} from "../../ports/runtime-query-error";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";

export const createAgentRuntimeQueryCommandHandlers = (service: AgentRuntimeQueryPort) =>
  ({
    agent_runtime_list_models: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listModels,
      (input) => service.listAvailableModels(input),
      (input, result) => result.runtime === undefined || result.runtime.kind === input.runtimeKind,
    ),
    agent_runtime_list_slash_commands: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listSlashCommands,
      (input) => service.listAvailableSlashCommands(input),
    ),
    agent_runtime_list_skills: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listSkills,
      (input) => service.listAvailableSkills(input),
    ),
    agent_runtime_list_subagents: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.listSubagents,
      (input) => service.listAvailableSubagents(input),
    ),
    agent_runtime_search_files: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.searchFiles,
      (input) => service.searchFiles(input),
    ),
    agent_runtime_load_session_history: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionHistory,
      (input) => service.loadSessionHistory(input),
    ),
    agent_runtime_load_session_todos: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionTodos,
      (input) => service.loadSessionTodos(input),
    ),
    agent_runtime_load_session_diff: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionDiff,
      (input) => service.loadSessionDiff(input),
    ),
    agent_runtime_file_status: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.fileStatus,
      (input) => service.loadFileStatus(input),
    ),
  }) satisfies HostCommandHandlerDefinitions;

const envelopeSchema = z.object({ input: z.unknown() }).strict();
const identitySchema = z.object({
  repoPath: z.string().optional().catch(undefined),
  runtimeKind: runtimeKindSchema.optional().catch(undefined),
  workingDirectory: z.string().optional().catch(undefined),
  externalSessionId: z.string().optional().catch(undefined),
});

const createQueryHandler =
  <Input extends RepoRuntimeRef, Result>(
    contract: AgentRuntimeQueryCommandContract<Input, Result>,
    invoke: (input: Input) => Effect.Effect<Result, RuntimeQueryError>,
    validateIdentity?: (input: Input, result: Result) => boolean,
  ) =>
  (args: HostCommandArgs) =>
    Effect.gen(function* () {
      const identityResult = identitySchema.safeParse(args?.input);
      const identity: RuntimeQueryIdentity = identityResult.success ? identityResult.data : {};
      const input = yield* Effect.try({
        try: () => contract.inputSchema.parse(envelopeSchema.parse(args).input),
        catch: (cause) =>
          runtimeQueryError(
            contract.command,
            identity,
            "invalid_input",
            "The runtime query input is invalid. Check its repository, runtime, directory, session, and policy fields.",
            cause,
          ),
      });
      const output = yield* invoke(input);
      const result = yield* Effect.try({
        try: () => contract.responseSchema.parse(output),
        catch: (cause) =>
          runtimeQueryError(
            contract.command,
            input,
            "invalid_runtime_response",
            "The runtime returned invalid query data. Check the host runtime logs and update the runtime.",
            cause,
          ),
      });
      if (validateIdentity && !validateIdentity(input, result)) {
        return yield* runtimeQueryError(
          contract.command,
          input,
          "invalid_runtime_response",
          "The runtime returned data for a different runtime or session. Reload the runtime data.",
        );
      }
      return result;
    });
