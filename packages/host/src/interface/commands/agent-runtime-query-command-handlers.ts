import {
  AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS,
  type AgentRuntimeCatalog,
  type AgentRuntimePreviewModelsInput,
  type AgentRuntimeQueryCommandContract,
  type RepoRuntimeRef,
  runtimeKindSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { ClaudeToolCatalogPort } from "../../ports/claude-tool-catalog-port";
import { HostValidationError } from "../../effect/host-errors";
import {
  runtimeQueryError,
  type RuntimeQueryError,
  type RuntimeQueryIdentity,
} from "../../ports/runtime-query-error";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";

export const createAgentRuntimeQueryCommandHandlers = (
  service: AgentRuntimeQueryPort,
  previewModels: (
    input: AgentRuntimePreviewModelsInput,
  ) => Effect.Effect<AgentRuntimeCatalog, RuntimeQueryError>,
  claudeToolCatalog: ClaudeToolCatalogPort,
) =>
  ({
    agent_runtime_claude_tool_catalog: (args) =>
      Effect.gen(function* () {
        const contract = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.claudeToolCatalog;
        const input = yield* Effect.try({
          try: () => contract.inputSchema.parse(envelopeSchema.parse(args).input),
          catch: (cause) =>
            new HostValidationError({
              field: "input",
              message: "Select a ready Claude runtime and retry the tool catalog read.",
              cause,
            }),
        });
        const result = yield* claudeToolCatalog.load(input);
        return yield* Effect.try({
          try: () => contract.responseSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              field: "claudeToolCatalog",
              message: "Claude returned invalid tool metadata. Update Claude Code and retry.",
              cause,
            }),
        });
      }),
    agent_runtime_preview_models: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.previewModels,
      previewModels,
      (input, result) => result.runtime?.kind === input.runtimeKind,
    ),
    agent_runtime_load_catalog: createQueryHandler(
      AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadCatalog,
      (input) => service.loadRuntimeCatalog(input),
      (input, result) => result.runtime === undefined || result.runtime.kind === input.runtimeKind,
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
  ): ((args: HostCommandArgs) => Effect.Effect<Result, RuntimeQueryError>) =>
  (args) =>
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
