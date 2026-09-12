import { z } from "zod";
import {
  agentFileDiffsSchema,
  agentFileStatusesSchema,
  agentModelCatalogSchema,
  agentSessionHistorySchema,
  agentSessionTodosSchema,
} from "./agent-engine-schemas";
import { repoRuntimeRefSchema } from "./agent-runtime-schemas";
import { agentFileReferenceSchema } from "./agent-session-event-schemas";
import {
  agentModelSelectionSchema,
  agentSessionLiveRefSchema,
  agentSessionScopeSchema,
  runtimeWorkingDirectoryRefSchema,
} from "./agent-session-schemas";
import { codexEffectivePolicySchema, type CodexEffectivePolicy } from "./config-schemas";
import { skillCatalogSchema } from "./skill-schemas";
import { slashCommandCatalogSchema } from "./slash-command-schemas";
import { subagentCatalogSchema } from "./subagent-schemas";

const opencodePolicySchema = z.object({ kind: z.literal("opencode") }).strict();
const claudePolicySchema = z.object({ kind: z.literal("claude") }).strict();
const codexPolicySchema = z
  .object({
    kind: z.literal("codex"),
    policy: codexEffectivePolicySchema.transform((policy): CodexEffectivePolicy => {
      const { adjustmentReason, ...fields } = policy;
      return adjustmentReason === undefined ? fields : { ...fields, adjustmentReason };
    }),
  })
  .strict();

export const agentSessionRuntimePolicySchema = z.discriminatedUnion("kind", [
  opencodePolicySchema,
  claudePolicySchema,
  codexPolicySchema,
]);
export type AgentSessionRuntimePolicy = z.infer<typeof agentSessionRuntimePolicySchema>;

const runtimePolicyBindings = [
  { runtimeKind: z.literal("opencode"), runtimePolicy: opencodePolicySchema },
  { runtimeKind: z.literal("claude"), runtimePolicy: claudePolicySchema },
  { runtimeKind: z.literal("codex"), runtimePolicy: codexPolicySchema },
] as const;

export const agentRuntimePolicyBindingSchema = z.discriminatedUnion("runtimeKind", [
  z.object(runtimePolicyBindings[0]).strict(),
  z.object(runtimePolicyBindings[1]).strict(),
  z.object(runtimePolicyBindings[2]).strict(),
]);
export type AgentRuntimePolicyBinding = z.infer<typeof agentRuntimePolicyBindingSchema>;

const policyBoundSessionFields = {
  ...agentSessionLiveRefSchema.shape,
  sessionScope: agentSessionScopeSchema.optional(),
  model: agentModelSelectionSchema.optional(),
  systemPrompt: z.string().optional(),
};

export const policyBoundSessionRefSchema = z.discriminatedUnion("runtimeKind", [
  z.object({ ...policyBoundSessionFields, ...runtimePolicyBindings[0] }).strict(),
  z.object({ ...policyBoundSessionFields, ...runtimePolicyBindings[1] }).strict(),
  z.object({ ...policyBoundSessionFields, ...runtimePolicyBindings[2] }).strict(),
]);
export type PolicyBoundSessionRef = z.infer<typeof policyBoundSessionRefSchema>;

export const agentSessionHistorySystemPromptContextSchema = z
  .object({
    systemPrompt: z.string(),
    startedAt: z.string().trim().min(1),
  })
  .strict();
export type AgentSessionHistorySystemPromptContext = z.infer<
  typeof agentSessionHistorySystemPromptContextSchema
>;

const historyFields = {
  ...policyBoundSessionFields,
  systemPromptContext: agentSessionHistorySystemPromptContextSchema.optional(),
  limit: z.number().int().positive().optional(),
};
export const agentRuntimeLoadSessionHistoryInputSchema = z.discriminatedUnion("runtimeKind", [
  z.object({ ...historyFields, ...runtimePolicyBindings[0] }).strict(),
  z.object({ ...historyFields, ...runtimePolicyBindings[1] }).strict(),
  z.object({ ...historyFields, ...runtimePolicyBindings[2] }).strict(),
]);
export type AgentRuntimeLoadSessionHistoryInput = z.infer<
  typeof agentRuntimeLoadSessionHistoryInputSchema
>;
export const agentRuntimeLoadSessionDiffInputSchema = agentSessionLiveRefSchema.extend({
  runtimeHistoryAnchor: z.string().trim().min(1).optional(),
});
export type AgentRuntimeLoadSessionDiffInput = z.infer<
  typeof agentRuntimeLoadSessionDiffInputSchema
>;
export const agentRuntimeSearchFilesInputSchema = runtimeWorkingDirectoryRefSchema.extend({
  query: z.string(),
});
export type AgentRuntimeSearchFilesInput = z.infer<typeof agentRuntimeSearchFilesInputSchema>;

export type AgentRuntimeQueryCommandContract<Input = unknown, Response = unknown> = {
  command: string;
  inputSchema: z.ZodType<Input>;
  responseSchema: z.ZodType<Response>;
};

export const AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS = {
  listModels: {
    command: "agent_runtime_list_models",
    inputSchema: repoRuntimeRefSchema,
    responseSchema: agentModelCatalogSchema,
  },
  listSlashCommands: {
    command: "agent_runtime_list_slash_commands",
    inputSchema: runtimeWorkingDirectoryRefSchema,
    responseSchema: slashCommandCatalogSchema,
  },
  listSkills: {
    command: "agent_runtime_list_skills",
    inputSchema: runtimeWorkingDirectoryRefSchema,
    responseSchema: skillCatalogSchema,
  },
  listSubagents: {
    command: "agent_runtime_list_subagents",
    inputSchema: runtimeWorkingDirectoryRefSchema,
    responseSchema: subagentCatalogSchema,
  },
  searchFiles: {
    command: "agent_runtime_search_files",
    inputSchema: agentRuntimeSearchFilesInputSchema,
    responseSchema: z.array(agentFileReferenceSchema),
  },
  loadSessionHistory: {
    command: "agent_runtime_load_session_history",
    inputSchema: agentRuntimeLoadSessionHistoryInputSchema,
    responseSchema: agentSessionHistorySchema,
  },
  loadSessionTodos: {
    command: "agent_runtime_load_session_todos",
    inputSchema: policyBoundSessionRefSchema,
    responseSchema: agentSessionTodosSchema,
  },
  loadSessionDiff: {
    command: "agent_runtime_load_session_diff",
    inputSchema: agentRuntimeLoadSessionDiffInputSchema,
    responseSchema: agentFileDiffsSchema,
  },
  fileStatus: {
    command: "agent_runtime_file_status",
    inputSchema: runtimeWorkingDirectoryRefSchema,
    responseSchema: agentFileStatusesSchema,
  },
} as const satisfies Record<string, AgentRuntimeQueryCommandContract>;

type Contract =
  (typeof AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS)[keyof typeof AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS];
export type AgentRuntimeQueryCommandName = Contract["command"];
export const AGENT_RUNTIME_QUERY_HOST_COMMAND_NAMES = Object.values(
  AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS,
)
  .map(({ command }) => command)
  .sort();
