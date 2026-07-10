import { z } from "zod";
import {
  runtimeDescriptorSchema,
  runtimeSubagentExecutionModeSchema,
} from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { fileContentSchema, fileDiffSchema, fileStatusSchema } from "./git-schemas";
import { skillCatalogSchema, skillDescriptorSchema } from "./skill-schemas";
import { slashCommandCatalogSchema } from "./slash-command-schemas";
import { subagentCatalogSchema, subagentDescriptorSchema } from "./subagent-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);
const claudeRuntimeKindSchema = z.literal("claude");
const optionalFromNullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export const claudeAgentModelSelectionSchema = z.object({
  runtimeKind: claudeRuntimeKindSchema.optional(),
  providerId: nonEmptyStringSchema,
  modelId: nonEmptyStringSchema,
  variant: optionalFromNullable(nonEmptyStringSchema),
  profileId: optionalFromNullable(nonEmptyStringSchema),
});
export type ClaudeAgentModelSelection = z.infer<typeof claudeAgentModelSelectionSchema>;

export const claudeRepoRuntimeRefSchema = z.object({
  repoPath: nonEmptyStringSchema,
  runtimeKind: claudeRuntimeKindSchema,
});
export type ClaudeRepoRuntimeRef = z.infer<typeof claudeRepoRuntimeRefSchema>;

export const claudeRuntimeWorkingDirectoryRefSchema = claudeRepoRuntimeRefSchema.extend({
  workingDirectory: nonEmptyStringSchema,
});
export type ClaudeRuntimeWorkingDirectoryRef = z.infer<
  typeof claudeRuntimeWorkingDirectoryRefSchema
>;

export const claudeAgentSessionRefSchema = claudeRuntimeWorkingDirectoryRefSchema.extend({
  externalSessionId: nonEmptyStringSchema,
});
export type ClaudeAgentSessionRef = z.infer<typeof claudeAgentSessionRefSchema>;

export const claudeAgentRuntimePolicySchema = z
  .object({
    kind: claudeRuntimeKindSchema,
  })
  .strict();
export type ClaudeAgentRuntimePolicy = z.infer<typeof claudeAgentRuntimePolicySchema>;

export const claudeWorkflowSessionScopeSchema = z
  .object({
    kind: z.literal("workflow"),
    taskId: nonEmptyStringSchema,
    role: agentRoleSchema,
  })
  .strict();
export type ClaudeWorkflowSessionScope = z.infer<typeof claudeWorkflowSessionScopeSchema>;

const claudePolicyBoundSessionRefSchema = claudeAgentSessionRefSchema.extend({
  runtimePolicy: claudeAgentRuntimePolicySchema,
  sessionScope: claudeWorkflowSessionScopeSchema.optional(),
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

export const claudeFileReferenceSchema = z.object({
  id: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: z.enum(["directory", "css", "code", "image", "video", "default"]),
});
export type ClaudeFileReference = z.infer<typeof claudeFileReferenceSchema>;

const claudeAttachmentReferenceSchema = z
  .object({
    id: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    kind: z.enum(["image", "audio", "video", "pdf"]),
    mime: nonEmptyStringSchema.optional(),
    localPreviewAvailable: z.boolean().optional(),
  })
  .passthrough();

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

const claudeModelAttachmentSupportSchema = z.object({
  image: z.boolean(),
  audio: z.boolean(),
  video: z.boolean(),
  pdf: z.boolean(),
  mimeTypes: z
    .object({
      image: z.array(nonEmptyStringSchema).optional(),
      audio: z.array(nonEmptyStringSchema).optional(),
      video: z.array(nonEmptyStringSchema).optional(),
      pdf: z.array(nonEmptyStringSchema).optional(),
    })
    .optional(),
});

const claudeAgentModelDescriptorSchema = z.object({
  id: nonEmptyStringSchema,
  providerId: nonEmptyStringSchema,
  providerName: nonEmptyStringSchema,
  modelId: nonEmptyStringSchema,
  modelName: nonEmptyStringSchema,
  variants: z.array(z.string()),
  contextWindow: z.number().int().positive().optional(),
  outputLimit: z.number().int().positive().optional(),
  attachmentSupport: claudeModelAttachmentSupportSchema.optional(),
  liveSessionUpdates: z
    .object({
      profile: z.boolean().optional(),
      variants: z.array(z.string()).optional(),
    })
    .optional(),
});

const claudeAgentDescriptorSchema = z.object({
  id: nonEmptyStringSchema.optional(),
  label: nonEmptyStringSchema.optional(),
  name: nonEmptyStringSchema.optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  hidden: z.boolean().optional(),
  native: z.boolean().optional(),
  color: nonEmptyStringSchema.optional(),
});

export const claudeAgentModelCatalogSchema = z.object({
  runtime: runtimeDescriptorSchema.optional(),
  models: z.array(claudeAgentModelDescriptorSchema),
  defaultModelsByProvider: z.record(z.string(), z.string()),
  profiles: z.array(claudeAgentDescriptorSchema).optional(),
});
export type ClaudeAgentModelCatalog = z.infer<typeof claudeAgentModelCatalogSchema>;

export const claudeFileSearchResultSchema = claudeFileReferenceSchema;
export const claudeFileSearchResultsSchema = z.array(claudeFileSearchResultSchema);
export type ClaudeFileSearchResult = z.infer<typeof claudeFileSearchResultSchema>;

const claudeAgentUserMessageSourceTextSchema = z.object({
  value: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const claudeAgentUserMessageDisplayPartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string(),
    synthetic: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("file_reference"),
    file: claudeFileReferenceSchema,
    sourceText: claudeAgentUserMessageSourceTextSchema.optional(),
  }),
  z.object({
    kind: z.literal("skill_mention"),
    skill: skillDescriptorSchema,
    sourceText: claudeAgentUserMessageSourceTextSchema.optional(),
  }),
  z.object({
    kind: z.literal("subagent_reference"),
    subagent: subagentDescriptorSchema,
    sourceText: claudeAgentUserMessageSourceTextSchema.optional(),
  }),
  z.object({
    kind: z.literal("attachment"),
    attachment: claudeAttachmentReferenceSchema,
  }),
]);

const claudeAgentToolTypeSchema = z.enum([
  "bash",
  "read",
  "list",
  "search",
  "web",
  "todo",
  "file_edit",
  "workflow",
  "question",
  "generic",
]);

export const claudeAgentStreamPartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    messageId: nonEmptyStringSchema,
    partId: nonEmptyStringSchema,
    text: z.string(),
    synthetic: z.boolean().optional(),
    completed: z.boolean(),
  }),
  z.object({
    kind: z.literal("reasoning"),
    messageId: nonEmptyStringSchema,
    partId: nonEmptyStringSchema,
    text: z.string(),
    completed: z.boolean(),
  }),
  z.object({
    kind: z.literal("tool"),
    messageId: nonEmptyStringSchema,
    partId: nonEmptyStringSchema,
    callId: nonEmptyStringSchema,
    tool: nonEmptyStringSchema,
    toolType: claudeAgentToolTypeSchema,
    status: z.enum(["pending", "running", "completed", "error"]),
    preview: z.string().optional(),
    title: z.string().optional(),
    displayLabel: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    output: z.string().optional(),
    error: z.string().optional(),
    fileDiffs: z.array(fileDiffSchema).optional(),
    fileContent: z.array(fileContentSchema).optional(),
    fileChanges: z.array(fileDiffSchema).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    startedAtMs: z.number().optional(),
    endedAtMs: z.number().optional(),
  }),
  z.object({
    kind: z.literal("step"),
    messageId: nonEmptyStringSchema,
    partId: nonEmptyStringSchema,
    phase: z.enum(["start", "finish"]),
    reason: z.string().optional(),
    cost: z.number().optional(),
    totalTokens: z.number().optional(),
    contextWindow: z.number().optional(),
  }),
  z.object({
    kind: z.literal("subagent"),
    messageId: nonEmptyStringSchema,
    partId: nonEmptyStringSchema,
    correlationKey: nonEmptyStringSchema,
    status: z.enum(["pending", "running", "completed", "cancelled", "error"]),
    agent: z.string().optional(),
    prompt: z.string().optional(),
    description: z.string().optional(),
    error: z.string().optional(),
    externalSessionId: nonEmptyStringSchema.optional(),
    executionMode: runtimeSubagentExecutionModeSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    startedAtMs: z.number().optional(),
    endedAtMs: z.number().optional(),
  }),
]);

export const claudeAgentSessionHistoryMessageSchema = z.discriminatedUnion("role", [
  z.object({
    messageId: nonEmptyStringSchema,
    role: z.literal("user"),
    timestamp: nonEmptyStringSchema,
    text: z.string(),
    displayParts: z.array(claudeAgentUserMessageDisplayPartSchema),
    state: z.enum(["queued", "read"]),
    model: claudeAgentModelSelectionSchema.optional(),
    parts: z.array(claudeAgentStreamPartSchema),
  }),
  z.object({
    messageId: nonEmptyStringSchema,
    role: z.literal("assistant"),
    timestamp: nonEmptyStringSchema,
    text: z.string(),
    durationMs: z.number().optional(),
    totalTokens: z.number().optional(),
    contextWindow: z.number().optional(),
    model: claudeAgentModelSelectionSchema.optional(),
    parts: z.array(claudeAgentStreamPartSchema),
  }),
  z.object({
    messageId: nonEmptyStringSchema,
    role: z.literal("system"),
    timestamp: nonEmptyStringSchema,
    text: z.string(),
    notice: z
      .object({
        tone: z.literal("info"),
        reason: z.literal("session_compacted"),
        title: nonEmptyStringSchema,
      })
      .optional(),
    parts: z.tuple([]),
  }),
]);
export type ClaudeAgentSessionHistoryMessage = z.infer<
  typeof claudeAgentSessionHistoryMessageSchema
>;

export const claudeAgentSessionHistorySchema = z.array(claudeAgentSessionHistoryMessageSchema);

export const claudeAgentSessionTodoItemSchema = z.object({
  id: nonEmptyStringSchema,
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]),
});
export const claudeAgentSessionTodosSchema = z.array(claudeAgentSessionTodoItemSchema);

export const claudeFileDiffsSchema = z.array(fileDiffSchema);
export const claudeFileStatusesSchema = z.array(fileStatusSchema);

type ClaudeRuntimeCommandContract = {
  command: string;
  inputSchema: z.ZodTypeAny;
  responseSchema: z.ZodTypeAny;
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
  .sort() as ClaudeRuntimeCommandName[];

export const CLAUDE_RUNTIME_COMMAND_CONTRACTS_BY_COMMAND = Object.fromEntries(
  Object.values(CLAUDE_RUNTIME_COMMAND_CONTRACTS).map((contract) => [contract.command, contract]),
) as Record<ClaudeRuntimeCommandName, ClaudeRuntimeCommandContractValue>;
