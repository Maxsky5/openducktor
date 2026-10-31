import { z } from "zod";
import {
  claudeToolCatalogInputSchema,
  claudeToolCatalogSchema,
} from "./claude-tool-catalog-schemas";
import {
  agentFileDiffsSchema,
  agentFileStatusesSchema,
  agentSessionHistorySchema,
  agentSessionTodosSchema,
} from "./agent-engine-schemas";
import { agentFileReferenceSchema, agentToolPartSchema } from "./agent-session-event-schemas";
import {
  agentModelSelectionSchema,
  agentSessionLiveRefSchema,
  agentSessionScopeSchema,
  runtimeWorkingDirectoryRefSchema,
} from "./agent-session-schemas";
import { codexEffectivePolicySchema, type CodexEffectivePolicy } from "./config-schemas";
import {
  agentRuntimeCatalogSchema,
  agentRuntimeLoadCatalogInputSchema,
} from "./runtime-catalog-schemas";

export const agentRuntimePreviewModelsInputSchema = z
  .object({
    repoPath: z.string().trim().min(1),
    runtimeKind: z.enum(["claude", "codex", "opencode"]),
  })
  .strict();
export type AgentRuntimePreviewModelsInput = z.infer<typeof agentRuntimePreviewModelsInputSchema>;

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
const historyCommandFields = {
  ...historyFields,
  /**
   * `on_demand` cuts long tool details and marks each cut part with `detailsOmitted`. A remote
   * client sends it only to a host with `REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY`.
   */
  toolDetails: z.literal("on_demand").optional(),
};
/** The wire input of `agent_runtime_load_session_history`. Runtime adapters never see `toolDetails`. */
export const agentRuntimeLoadSessionHistoryCommandInputSchema = z.discriminatedUnion(
  "runtimeKind",
  [
    z.object({ ...historyCommandFields, ...runtimePolicyBindings[0] }).strict(),
    z.object({ ...historyCommandFields, ...runtimePolicyBindings[1] }).strict(),
    z.object({ ...historyCommandFields, ...runtimePolicyBindings[2] }).strict(),
  ],
);
const toolPartFields = {
  ...policyBoundSessionFields,
  partId: z.string().trim().min(1),
  callId: z.string(),
};
export const agentRuntimeLoadSessionToolPartInputSchema = z.discriminatedUnion("runtimeKind", [
  z.object({ ...toolPartFields, ...runtimePolicyBindings[0] }).strict(),
  z.object({ ...toolPartFields, ...runtimePolicyBindings[1] }).strict(),
  z.object({ ...toolPartFields, ...runtimePolicyBindings[2] }).strict(),
]);
export type AgentRuntimeLoadSessionToolPartInput = z.infer<
  typeof agentRuntimeLoadSessionToolPartInputSchema
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
  claudeToolCatalog: {
    command: "agent_runtime_claude_tool_catalog",
    inputSchema: claudeToolCatalogInputSchema,
    responseSchema: claudeToolCatalogSchema,
  },
  previewModels: {
    command: "agent_runtime_preview_models",
    inputSchema: agentRuntimePreviewModelsInputSchema,
    responseSchema: agentRuntimeCatalogSchema,
  },
  loadCatalog: {
    command: "agent_runtime_load_catalog",
    inputSchema: agentRuntimeLoadCatalogInputSchema,
    responseSchema: agentRuntimeCatalogSchema,
  },
  searchFiles: {
    command: "agent_runtime_search_files",
    inputSchema: agentRuntimeSearchFilesInputSchema,
    responseSchema: z.array(agentFileReferenceSchema),
  },
  loadSessionHistory: {
    command: "agent_runtime_load_session_history",
    inputSchema: agentRuntimeLoadSessionHistoryCommandInputSchema,
    responseSchema: agentSessionHistorySchema,
  },
  loadSessionToolPart: {
    command: "agent_runtime_load_session_tool_part",
    inputSchema: agentRuntimeLoadSessionToolPartInputSchema,
    responseSchema: agentToolPartSchema,
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
