import { z } from "zod";
import {
  agentFileDiffsSchema,
  agentFileStatusesSchema,
  agentModelCatalogSchema,
  agentSessionHistoryMessageSchema,
  agentSessionHistorySchema,
  agentSessionTodosSchema,
} from "./agent-engine-schemas";
import { repoRuntimeRefSchema } from "./agent-runtime-schemas";
import {
  agentFileReferenceSchema,
  agentSessionTodoItemSchema,
  agentStreamPartSchema,
  agentUserMessageDisplayPartSchema,
} from "./agent-session-event-schemas";
import {
  type AgentTranscriptModelSelection,
  agentSessionLiveRefSchema,
  agentSessionWorkflowScopeSchema,
  runtimeWorkingDirectoryRefSchema,
} from "./agent-session-schemas";
import { skillCatalogSchema } from "./skill-schemas";
import { slashCommandCatalogSchema } from "./slash-command-schemas";
import { subagentCatalogSchema } from "./subagent-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);
const claudeRuntimeKindSchema = z.literal("claude");
const optionalFromNullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export type ClaudeAgentModelSelection = Omit<AgentTranscriptModelSelection, "runtimeKind"> & {
  runtimeKind?: "claude";
};

const inferredClaudeAgentModelSelectionSchema = z.object({
  runtimeKind: claudeRuntimeKindSchema.optional(),
  providerId: nonEmptyStringSchema,
  modelId: nonEmptyStringSchema,
  variant: optionalFromNullable(nonEmptyStringSchema),
  profileId: optionalFromNullable(nonEmptyStringSchema),
});
export const claudeAgentModelSelectionSchema =
  inferredClaudeAgentModelSelectionSchema as unknown as z.ZodType<ClaudeAgentModelSelection>;

export const claudeRepoRuntimeRefSchema = repoRuntimeRefSchema.extend({
  runtimeKind: claudeRuntimeKindSchema,
});
export type ClaudeRepoRuntimeRef = z.infer<typeof claudeRepoRuntimeRefSchema>;

export const claudeRuntimeWorkingDirectoryRefSchema = runtimeWorkingDirectoryRefSchema.extend({
  runtimeKind: claudeRuntimeKindSchema,
});
export type ClaudeRuntimeWorkingDirectoryRef = z.infer<
  typeof claudeRuntimeWorkingDirectoryRefSchema
>;

export const claudeAgentSessionRefSchema = agentSessionLiveRefSchema.extend({
  runtimeKind: claudeRuntimeKindSchema,
});
export type ClaudeAgentSessionRef = z.infer<typeof claudeAgentSessionRefSchema>;

export const claudeAgentRuntimePolicySchema = z
  .object({
    kind: claudeRuntimeKindSchema,
  })
  .strict();
export type ClaudeAgentRuntimePolicy = z.infer<typeof claudeAgentRuntimePolicySchema>;

export const claudeWorkflowSessionScopeSchema = agentSessionWorkflowScopeSchema;
export type ClaudeWorkflowSessionScope = z.infer<typeof claudeWorkflowSessionScopeSchema>;

const claudePolicyBoundSessionRefSchema = claudeAgentSessionRefSchema.extend({
  runtimePolicy: claudeAgentRuntimePolicySchema,
  sessionScope: claudeWorkflowSessionScopeSchema.optional(),
  model: claudeAgentModelSelectionSchema.optional(),
});

export const claudeListAgentModelsInputSchema = claudeRepoRuntimeRefSchema;
export type ClaudeListAgentModelsInput = z.infer<typeof claudeListAgentModelsInputSchema>;

export const claudeListAgentSlashCommandsInputSchema = claudeRuntimeWorkingDirectoryRefSchema;
export type ClaudeListAgentSlashCommandsInput = z.infer<
  typeof claudeListAgentSlashCommandsInputSchema
>;

export const claudeListAgentSkillsInputSchema = claudeRuntimeWorkingDirectoryRefSchema;
export type ClaudeListAgentSkillsInput = z.infer<typeof claudeListAgentSkillsInputSchema>;

export const claudeListAgentSubagentsInputSchema = claudeRuntimeWorkingDirectoryRefSchema;
export type ClaudeListAgentSubagentsInput = z.infer<typeof claudeListAgentSubagentsInputSchema>;

export const claudeFileReferenceSchema = agentFileReferenceSchema;
export type ClaudeFileReference = z.infer<typeof claudeFileReferenceSchema>;

export const claudeSearchAgentFilesInputSchema = claudeRuntimeWorkingDirectoryRefSchema.extend({
  query: z.string(),
});
export type ClaudeSearchAgentFilesInput = z.infer<typeof claudeSearchAgentFilesInputSchema>;

export const claudeLoadAgentSessionHistoryInputSchema = claudePolicyBoundSessionRefSchema.extend({
  systemPromptContext: z
    .object({
      systemPrompt: z.string(),
      startedAt: nonEmptyStringSchema,
    })
    .optional(),
  limit: z.number().int().positive().optional(),
});
export type ClaudeLoadAgentSessionHistoryInput = z.infer<
  typeof claudeLoadAgentSessionHistoryInputSchema
>;

export const claudeLoadAgentSessionTodosInputSchema = claudePolicyBoundSessionRefSchema;
export type ClaudeLoadAgentSessionTodosInput = z.infer<
  typeof claudeLoadAgentSessionTodosInputSchema
>;

export const claudeLoadAgentSessionDiffInputSchema = claudeRuntimeWorkingDirectoryRefSchema.extend({
  externalSessionId: nonEmptyStringSchema,
  runtimeHistoryAnchor: nonEmptyStringSchema.optional(),
});
export type ClaudeLoadAgentSessionDiffInput = z.infer<typeof claudeLoadAgentSessionDiffInputSchema>;

export const claudeLoadAgentFileStatusInputSchema = claudeRuntimeWorkingDirectoryRefSchema;
export type ClaudeLoadAgentFileStatusInput = z.infer<typeof claudeLoadAgentFileStatusInputSchema>;

export const claudeAgentModelCatalogSchema = agentModelCatalogSchema;
export type ClaudeAgentModelCatalog = z.infer<typeof claudeAgentModelCatalogSchema>;

export const claudeFileSearchResultSchema = agentFileReferenceSchema;
export const claudeFileSearchResultsSchema = z.array(claudeFileSearchResultSchema);
export type ClaudeFileSearchResult = z.infer<typeof claudeFileSearchResultSchema>;

export const claudeAgentUserMessageDisplayPartSchema = agentUserMessageDisplayPartSchema;
export const claudeAgentStreamPartSchema = agentStreamPartSchema;
export const claudeAgentSessionHistoryMessageSchema = agentSessionHistoryMessageSchema;
export type ClaudeAgentSessionHistoryMessage = z.infer<
  typeof claudeAgentSessionHistoryMessageSchema
>;
export const claudeAgentSessionHistorySchema = agentSessionHistorySchema;
export const claudeAgentSessionTodoItemSchema = agentSessionTodoItemSchema;
export const claudeAgentSessionTodosSchema = agentSessionTodosSchema;
export const claudeFileDiffsSchema = agentFileDiffsSchema;
export const claudeFileStatusesSchema = agentFileStatusesSchema;

export type ClaudeRuntimeCommandContract<Input = unknown, Response = unknown> = {
  command: string;
  inputSchema: { parse(value: unknown): Input };
  responseSchema: { parse(value: unknown): Response };
};

export const CLAUDE_RUNTIME_COMMAND_CONTRACTS = {
  listModels: {
    command: "claude_runtime_list_models",
    inputSchema: claudeListAgentModelsInputSchema,
    responseSchema: claudeAgentModelCatalogSchema,
  },
  listSlashCommands: {
    command: "claude_runtime_list_slash_commands",
    inputSchema: claudeListAgentSlashCommandsInputSchema,
    responseSchema: slashCommandCatalogSchema,
  },
  listSkills: {
    command: "claude_runtime_list_skills",
    inputSchema: claudeListAgentSkillsInputSchema,
    responseSchema: skillCatalogSchema,
  },
  listSubagents: {
    command: "claude_runtime_list_subagents",
    inputSchema: claudeListAgentSubagentsInputSchema,
    responseSchema: subagentCatalogSchema,
  },
  searchFiles: {
    command: "claude_runtime_search_files",
    inputSchema: claudeSearchAgentFilesInputSchema,
    responseSchema: claudeFileSearchResultsSchema,
  },
  loadSessionHistory: {
    command: "claude_runtime_load_session_history",
    inputSchema: claudeLoadAgentSessionHistoryInputSchema,
    responseSchema: claudeAgentSessionHistorySchema,
  },
  loadSessionTodos: {
    command: "claude_runtime_load_session_todos",
    inputSchema: claudeLoadAgentSessionTodosInputSchema,
    responseSchema: claudeAgentSessionTodosSchema,
  },
  loadSessionDiff: {
    command: "claude_runtime_load_session_diff",
    inputSchema: claudeLoadAgentSessionDiffInputSchema,
    responseSchema: claudeFileDiffsSchema,
  },
  fileStatus: {
    command: "claude_runtime_file_status",
    inputSchema: claudeLoadAgentFileStatusInputSchema,
    responseSchema: claudeFileStatusesSchema,
  },
} as const satisfies Record<string, ClaudeRuntimeCommandContract>;

type ClaudeRuntimeCommandContractMap = typeof CLAUDE_RUNTIME_COMMAND_CONTRACTS;
type ClaudeRuntimeCommandContractValue =
  ClaudeRuntimeCommandContractMap[keyof ClaudeRuntimeCommandContractMap];

export type ClaudeRuntimeCommandName = ClaudeRuntimeCommandContractValue["command"];
export type ClaudeRuntimeCommandContractFor<Command extends ClaudeRuntimeCommandName> = Extract<
  ClaudeRuntimeCommandContractValue,
  { command: Command }
>;
export type ClaudeRuntimeCommandInput<Command extends ClaudeRuntimeCommandName> = z.input<
  ClaudeRuntimeCommandContractFor<Command>["inputSchema"]
>;
export type ClaudeRuntimeCommandOutput<Command extends ClaudeRuntimeCommandName> = z.output<
  ClaudeRuntimeCommandContractFor<Command>["responseSchema"]
>;

export const CLAUDE_RUNTIME_HOST_COMMAND_NAMES = Object.values(CLAUDE_RUNTIME_COMMAND_CONTRACTS)
  .map((contract) => contract.command)
  .sort();

export const CLAUDE_RUNTIME_COMMAND_CONTRACTS_BY_COMMAND = {
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff,
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus.command]:
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus,
} satisfies Record<ClaudeRuntimeCommandName, ClaudeRuntimeCommandContractValue>;
