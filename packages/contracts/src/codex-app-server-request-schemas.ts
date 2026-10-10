import { z, type JSONType } from "zod";
import {
  codexUint32Schema,
  codexUint64Schema,
  codexUsizeSchema,
} from "./codex-app-server-number-schemas";

const codexAppServerJsonValueSchema = z.json();
const codexAppServerJsonObjectSchema = z.record(z.string(), codexAppServerJsonValueSchema);

export const codexAppServerReasoningEffortSchema = z.string().min(1);

export type CodexAppServerRequestReasoningEffort = z.output<
  typeof codexAppServerReasoningEffortSchema
>;

const nullableString = z.string().nullable().optional();
const nullableBoolean = z.boolean().nullable().optional();
const nullableUint32 = codexUint32Schema.nullable().optional();
export const codexAppServerApprovalsReviewerSchema = z.enum([
  "auto_review",
  "guardian_subagent",
  "user",
]);
const personalitySchema = z.enum(["friendly", "none", "pragmatic"]);
const sortDirectionSchema = z.enum(["asc", "desc"]);
const turnItemsViewSchema = z.enum(["notLoaded", "summary", "full"]);
const sandboxModeSchema = z.enum(["danger-full-access", "read-only", "workspace-write"]);
export const codexAppServerMultiAgentModeSchema = z.union([
  z.enum(["explicitRequestOnly", "proactive"]),
  z.strictObject({ custom: z.string() }),
]);

export const codexAppServerApprovalPolicySchema = z.union([
  z.enum(["never", "on-request", "untrusted"]),
  z.strictObject({
    granular: z.strictObject({
      mcp_elicitations: z.boolean(),
      request_permissions: z.boolean(),
      rules: z.boolean(),
      sandbox_approval: z.boolean(),
      skill_approval: z.boolean(),
    }),
  }),
]);

export const codexAppServerSandboxPolicySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("dangerFullAccess") }),
  z.strictObject({
    type: z.literal("externalSandbox"),
    networkAccess: z.enum(["restricted", "enabled"]),
  }),
  z.strictObject({ type: z.literal("readOnly"), networkAccess: z.boolean() }),
  z.strictObject({
    type: z.literal("workspaceWrite"),
    excludeSlashTmp: z.boolean(),
    excludeTmpdirEnvVar: z.boolean(),
    networkAccess: z.boolean(),
    writableRoots: z.array(z.string()),
  }),
]);

const textElementSchema = z.strictObject({
  byteRange: z.strictObject({ start: codexUsizeSchema, end: codexUsizeSchema }),
  placeholder: z.string().nullable(),
});

export const codexAppServerUserInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: z.string(),
    text_elements: z.array(textElementSchema),
  }),
  z.strictObject({
    type: z.literal("image"),
    detail: z.enum(["auto", "low", "high", "original"]).nullable().optional(),
    url: z.string(),
  }),
  z.strictObject({
    type: z.literal("localImage"),
    detail: z.enum(["auto", "low", "high", "original"]).nullable().optional(),
    path: z.string(),
  }),
  z.strictObject({ type: z.literal("audio"), url: z.string() }),
  z.strictObject({ type: z.literal("localAudio"), path: z.string() }),
  z.strictObject({ type: z.literal("mention"), name: z.string(), path: z.string() }),
  z.strictObject({ type: z.literal("skill"), name: z.string(), path: z.string() }),
]);

const responseItemMetadataSchema = z.strictObject({ turn_id: z.string().optional() });

const responseItemContentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("input_text"), text: z.string() }),
  z.strictObject({
    type: z.literal("input_image"),
    image_url: z.string(),
    detail: z.enum(["auto", "low", "high", "original"]).optional(),
  }),
  z.strictObject({ type: z.literal("input_audio"), audio_url: z.string() }),
  z.strictObject({ type: z.literal("output_text"), text: z.string() }),
]);

const agentMessageInputContentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("input_text"), text: z.string() }),
  z.strictObject({ type: z.literal("encrypted_content"), encrypted_content: z.string() }),
]);

const functionCallOutputContentItemSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("input_text"), text: z.string() }),
  z.strictObject({
    type: z.literal("input_image"),
    image_url: z.string(),
    detail: z.enum(["auto", "low", "high", "original"]).optional(),
  }),
  z.strictObject({ type: z.literal("input_audio"), audio_url: z.string() }),
  z.strictObject({ type: z.literal("encrypted_content"), encrypted_content: z.string() }),
]);

const functionCallOutputBodySchema = z.union([
  z.string(),
  z.array(functionCallOutputContentItemSchema),
]);

const localShellActionSchema = z.strictObject({
  type: z.literal("exec"),
  command: z.array(z.string()),
  timeout_ms: codexUint64Schema.nullable(),
  working_directory: z.string().nullable(),
  env: z.record(z.string(), z.string()).nullable(),
  user: z.string().nullable(),
});

const webSearchActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("search"),
    query: z.string().optional(),
    queries: z.array(z.string()).optional(),
  }),
  z.strictObject({ type: z.literal("open_page"), url: z.string().optional() }),
  z.strictObject({
    type: z.literal("find_in_page"),
    url: z.string().optional(),
    pattern: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("other") }),
]);

const responseItemFields = {
  id: z.string().optional(),
  internal_chat_message_metadata_passthrough: responseItemMetadataSchema.optional(),
};

export const codexAppServerResponseItemSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("message"),
    ...responseItemFields,
    role: z.string(),
    content: z.array(responseItemContentSchema),
    phase: z.enum(["commentary", "final_answer"]).optional(),
  }),
  z.strictObject({
    type: z.literal("agent_message"),
    ...responseItemFields,
    author: z.string(),
    recipient: z.string(),
    content: z.array(agentMessageInputContentSchema),
  }),
  z.strictObject({
    type: z.literal("reasoning"),
    ...responseItemFields,
    summary: z.array(z.strictObject({ type: z.literal("summary_text"), text: z.string() })),
    content: z
      .array(
        z.discriminatedUnion("type", [
          z.strictObject({ type: z.literal("reasoning_text"), text: z.string() }),
          z.strictObject({ type: z.literal("text"), text: z.string() }),
        ]),
      )
      .optional(),
    encrypted_content: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("local_shell_call"),
    ...responseItemFields,
    call_id: z.string().nullable(),
    status: z.enum(["completed", "in_progress", "incomplete"]),
    action: localShellActionSchema,
  }),
  z.strictObject({
    type: z.literal("function_call"),
    ...responseItemFields,
    name: z.string(),
    namespace: z.string().optional(),
    arguments: z.string(),
    encrypted_function_args: z.array(z.string()).optional(),
    call_id: z.string(),
  }),
  z.strictObject({
    type: z.literal("tool_search_call"),
    ...responseItemFields,
    call_id: z.string().nullable(),
    status: z.string().optional(),
    execution: z.string(),
    arguments: codexAppServerJsonValueSchema,
  }),
  z.strictObject({
    type: z.literal("function_call_output"),
    ...responseItemFields,
    call_id: z.string(),
    output: functionCallOutputBodySchema,
  }),
  z.strictObject({
    type: z.literal("custom_tool_call"),
    ...responseItemFields,
    status: z.string().optional(),
    call_id: z.string(),
    name: z.string(),
    namespace: z.string().optional(),
    input: z.string(),
  }),
  z.strictObject({
    type: z.literal("custom_tool_call_output"),
    ...responseItemFields,
    call_id: z.string(),
    name: z.string().optional(),
    output: functionCallOutputBodySchema,
  }),
  z.strictObject({
    type: z.literal("tool_search_output"),
    ...responseItemFields,
    call_id: z.string().nullable(),
    status: z.string(),
    execution: z.string(),
    tools: z.array(codexAppServerJsonValueSchema),
  }),
  z.strictObject({
    type: z.literal("web_search_call"),
    ...responseItemFields,
    status: z.string().optional(),
    action: webSearchActionSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("image_generation_call"),
    ...responseItemFields,
    status: z.string(),
    revised_prompt: z.string().optional(),
    result: z.string(),
  }),
  z.strictObject({
    type: z.literal("compaction"),
    ...responseItemFields,
    encrypted_content: z.string(),
  }),
  z.strictObject({ type: z.literal("compaction_trigger") }),
  z.strictObject({
    type: z.literal("context_compaction"),
    ...responseItemFields,
    encrypted_content: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("other") }),
]);

const threadConfigurationFields = {
  model: nullableString,
  modelProvider: nullableString,
  serviceTier: nullableString,
  cwd: nullableString,
  runtimeWorkspaceRoots: z.array(z.string()).nullable().optional(),
  approvalPolicy: codexAppServerApprovalPolicySchema.nullable().optional(),
  approvalsReviewer: codexAppServerApprovalsReviewerSchema.nullable().optional(),
  sandbox: sandboxModeSchema.nullable().optional(),
  permissions: nullableString,
  config: codexAppServerJsonObjectSchema.nullable().optional(),
  baseInstructions: nullableString,
  developerInstructions: nullableString,
};

const turnEnvironmentSchema = z.strictObject({
  environmentId: z.string(),
  cwd: z.string(),
  runtimeWorkspaceRoots: z.array(z.string()).nullable().optional(),
});

const dynamicToolFunctionFields = {
  name: z.string(),
  description: z.string(),
  inputSchema: codexAppServerJsonValueSchema,
  deferLoading: z.boolean().optional(),
};

const codexAppServerDynamicToolFunctionSpecSchema = z.strictObject(dynamicToolFunctionFields);
const codexAppServerDynamicToolFunctionSchema = codexAppServerDynamicToolFunctionSpecSchema.extend({
  type: z.literal("function"),
});

const dynamicToolSchema = z.discriminatedUnion("type", [
  codexAppServerDynamicToolFunctionSchema,
  z.strictObject({
    type: z.literal("namespace"),
    name: z.string(),
    description: z.string(),
    tools: z.array(z.strictObject({ type: z.literal("function"), ...dynamicToolFunctionFields })),
  }),
]);

const selectedCapabilityRootSchema = z.strictObject({
  id: z.string(),
  location: z.strictObject({
    type: z.literal("environment"),
    environmentId: z.string(),
    path: z.string(),
  }),
});

const initialTurnsPageSchema = z.strictObject({
  limit: nullableUint32,
  sortDirection: sortDirectionSchema.nullable().optional(),
  itemsView: turnItemsViewSchema.nullable().optional(),
});

const additionalContextEntrySchema = z.strictObject({
  value: z.string(),
  kind: z.enum(["untrusted", "application"]),
});

const collaborationModeSchema = z.strictObject({
  mode: z.enum(["plan", "default"]),
  settings: z.strictObject({
    model: z.string(),
    reasoning_effort: codexAppServerReasoningEffortSchema.nullable(),
    developer_instructions: z.string().nullable(),
  }),
});

export const codexAppServerRequestParamsSchemas = {
  initialize: z.strictObject({
    clientInfo: z.strictObject({
      name: z.string(),
      title: z.string().nullable(),
      version: z.string(),
    }),
    capabilities: z
      .strictObject({
        experimentalApi: z.boolean(),
        requestAttestation: z.boolean(),
        mcpServerOpenaiFormElicitation: z.boolean().optional(),
        optOutNotificationMethods: z.array(z.string()).nullable().optional(),
        extensions: codexAppServerJsonObjectSchema.nullable().optional(),
      })
      .nullable(),
  }),
  "model/list": z.strictObject({
    cursor: nullableString,
    limit: nullableUint32,
    includeHidden: nullableBoolean,
  }),
  "thread/fork": z.strictObject({
    threadId: z.string(),
    lastTurnId: nullableString,
    beforeTurnId: nullableString,
    path: nullableString,
    ...threadConfigurationFields,
    ephemeral: z.boolean().optional(),
    threadSource: nullableString,
    excludeTurns: z.boolean().optional(),
    deferGoalContinuation: z.boolean().optional(),
  }),
  "thread/list": z.strictObject({
    cursor: nullableString,
    limit: nullableUint32,
    sortKey: z
      .enum(["created_at", "updated_at", "recency_at", "section_position"])
      .nullable()
      .optional(),
    sortDirection: sortDirectionSchema.nullable().optional(),
    modelProviders: z.array(z.string()).nullable().optional(),
    sourceKinds: z
      .array(
        z.enum([
          "cli",
          "vscode",
          "exec",
          "appServer",
          "subAgent",
          "subAgentReview",
          "subAgentCompact",
          "subAgentThreadSpawn",
          "subAgentOther",
          "unknown",
        ]),
      )
      .nullable()
      .optional(),
    archived: nullableBoolean,
    sectionId: nullableString,
    projectId: nullableString,
    cwd: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    useStateDbOnly: z.boolean().optional(),
    searchTerm: nullableString,
    parentThreadId: nullableString,
    ancestorThreadId: nullableString,
  }),
  "thread/loaded/list": z.strictObject({ cursor: nullableString, limit: nullableUint32 }),
  "thread/read": z.strictObject({ threadId: z.string(), includeTurns: z.boolean().optional() }),
  "thread/resume": z.strictObject({
    threadId: z.string(),
    history: z.array(codexAppServerResponseItemSchema).nullable().optional(),
    path: nullableString,
    ...threadConfigurationFields,
    personality: personalitySchema.nullable().optional(),
    excludeTurns: z.boolean().optional(),
    initialTurnsPage: initialTurnsPageSchema.nullable().optional(),
  }),
  "thread/start": z.strictObject({
    ...threadConfigurationFields,
    allowProviderModelFallback: z.boolean().optional(),
    serviceName: nullableString,
    personality: personalitySchema.nullable().optional(),
    multiAgentMode: codexAppServerMultiAgentModeSchema.nullable().optional(),
    ephemeral: nullableBoolean,
    historyMode: z.enum(["legacy", "paginated"]).nullable().optional(),
    sessionStartSource: z.enum(["clear", "startup"]).nullable().optional(),
    threadSource: nullableString,
    projectId: nullableString,
    environments: z.array(turnEnvironmentSchema).nullable().optional(),
    dynamicTools: z.array(dynamicToolSchema).nullable().optional(),
    selectedCapabilityRoots: z.array(selectedCapabilityRootSchema).nullable().optional(),
    mockExperimentalField: nullableString,
    experimentalRawEvents: z.boolean().optional(),
  }),
  "thread/name/set": z.strictObject({ threadId: z.string(), name: z.string() }),
  "thread/compact/start": z.strictObject({ threadId: z.string() }),
  "thread/turns/list": z.strictObject({
    threadId: z.string(),
    cursor: nullableString,
    limit: nullableUint32,
    sortDirection: sortDirectionSchema.nullable().optional(),
    itemsView: turnItemsViewSchema.nullable().optional(),
  }),
  "skills/list": z.strictObject({
    cwds: z.array(z.string()).optional(),
    forceReload: z.boolean().optional(),
  }),
  "turn/start": z.strictObject({
    threadId: z.string(),
    clientUserMessageId: nullableString,
    input: z.array(codexAppServerUserInputSchema),
    responsesapiClientMetadata: z.record(z.string(), z.string()).nullable().optional(),
    additionalContext: z.record(z.string(), additionalContextEntrySchema).nullable().optional(),
    environments: z.array(turnEnvironmentSchema).nullable().optional(),
    cwd: nullableString,
    runtimeWorkspaceRoots: z.array(z.string()).nullable().optional(),
    approvalPolicy: codexAppServerApprovalPolicySchema.nullable().optional(),
    approvalsReviewer: codexAppServerApprovalsReviewerSchema.nullable().optional(),
    sandboxPolicy: codexAppServerSandboxPolicySchema.nullable().optional(),
    permissions: nullableString,
    model: nullableString,
    serviceTier: nullableString,
    effort: codexAppServerReasoningEffortSchema.nullable().optional(),
    summary: z.enum(["auto", "concise", "detailed", "none"]).nullable().optional(),
    personality: personalitySchema.nullable().optional(),
    outputSchema: codexAppServerJsonValueSchema.nullable().optional(),
    collaborationMode: collaborationModeSchema.nullable().optional(),
    multiAgentMode: codexAppServerMultiAgentModeSchema.nullable().optional(),
  }),
  "turn/steer": z.strictObject({
    threadId: z.string(),
    clientUserMessageId: nullableString,
    input: z.array(codexAppServerUserInputSchema),
    responsesapiClientMetadata: z.record(z.string(), z.string()).nullable().optional(),
    additionalContext: z.record(z.string(), additionalContextEntrySchema).nullable().optional(),
    expectedTurnId: z.string(),
  }),
  "turn/interrupt": z.strictObject({ threadId: z.string(), turnId: z.string() }),
  gitDiffToRemote: z.strictObject({ cwd: z.string() }),
  fuzzyFileSearch: z.strictObject({
    query: z.string(),
    roots: z.array(z.string()),
    cancellationToken: z.string().nullable(),
  }),
};

export const codexAppServerClientRequestSchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("initialize"),
    params: codexAppServerRequestParamsSchemas.initialize,
  }),
  z.strictObject({
    method: z.literal("model/list"),
    params: codexAppServerRequestParamsSchemas["model/list"],
  }),
  z.strictObject({
    method: z.literal("thread/fork"),
    params: codexAppServerRequestParamsSchemas["thread/fork"],
  }),
  z.strictObject({
    method: z.literal("thread/list"),
    params: codexAppServerRequestParamsSchemas["thread/list"],
  }),
  z.strictObject({
    method: z.literal("thread/loaded/list"),
    params: codexAppServerRequestParamsSchemas["thread/loaded/list"],
  }),
  z.strictObject({
    method: z.literal("thread/read"),
    params: codexAppServerRequestParamsSchemas["thread/read"],
  }),
  z.strictObject({
    method: z.literal("thread/resume"),
    params: codexAppServerRequestParamsSchemas["thread/resume"],
  }),
  z.strictObject({
    method: z.literal("thread/start"),
    params: codexAppServerRequestParamsSchemas["thread/start"],
  }),
  z.strictObject({
    method: z.literal("thread/name/set"),
    params: codexAppServerRequestParamsSchemas["thread/name/set"],
  }),
  z.strictObject({
    method: z.literal("thread/compact/start"),
    params: codexAppServerRequestParamsSchemas["thread/compact/start"],
  }),
  z.strictObject({
    method: z.literal("thread/turns/list"),
    params: codexAppServerRequestParamsSchemas["thread/turns/list"],
  }),
  z.strictObject({
    method: z.literal("skills/list"),
    params: codexAppServerRequestParamsSchemas["skills/list"],
  }),
  z.strictObject({
    method: z.literal("turn/start"),
    params: codexAppServerRequestParamsSchemas["turn/start"],
  }),
  z.strictObject({
    method: z.literal("turn/steer"),
    params: codexAppServerRequestParamsSchemas["turn/steer"],
  }),
  z.strictObject({
    method: z.literal("turn/interrupt"),
    params: codexAppServerRequestParamsSchemas["turn/interrupt"],
  }),
  z.strictObject({
    method: z.literal("gitDiffToRemote"),
    params: codexAppServerRequestParamsSchemas.gitDiffToRemote,
  }),
  z.strictObject({
    method: z.literal("fuzzyFileSearch"),
    params: codexAppServerRequestParamsSchemas.fuzzyFileSearch,
  }),
]);

export type CodexAppServerRequestParamsMap = {
  [Method in keyof typeof codexAppServerRequestParamsSchemas]: z.output<
    (typeof codexAppServerRequestParamsSchemas)[Method]
  >;
};
export type CodexAppServerReasoningEffort = CodexAppServerRequestReasoningEffort;
export type CodexAppServerReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type CodexAppServerPersonality = z.output<typeof personalitySchema>;
export type CodexAppServerSortDirection = z.output<typeof sortDirectionSchema>;
export type CodexAppServerTurnItemsView = z.output<typeof turnItemsViewSchema>;
export type CodexAppServerSandboxMode = z.output<typeof sandboxModeSchema>;
export type CodexAppServerAskForApproval = z.output<typeof codexAppServerApprovalPolicySchema>;
export type CodexAppServerApprovalsReviewer = z.output<
  typeof codexAppServerApprovalsReviewerSchema
>;
export type CodexAppServerSandboxPolicy = z.output<typeof codexAppServerSandboxPolicySchema>;
export type CodexAppServerMultiAgentMode = z.output<typeof codexAppServerMultiAgentModeSchema>;
export type CodexAppServerTurnEnvironmentParams = z.output<typeof turnEnvironmentSchema>;
export type CodexAppServerDynamicToolSpec = z.output<typeof dynamicToolSchema>;
export type CodexAppServerDynamicToolFunctionSpec = z.output<
  typeof codexAppServerDynamicToolFunctionSpecSchema
>;
export type CodexAppServerSelectedCapabilityRoot = z.output<typeof selectedCapabilityRootSchema>;
export type CodexAppServerInitializeParams = CodexAppServerRequestParamsMap["initialize"];
export type CodexAppServerClientInfo = CodexAppServerInitializeParams["clientInfo"];
export type CodexAppServerInitializeCapabilities = Exclude<
  CodexAppServerInitializeParams["capabilities"],
  null
>;
export type CodexAppServerThreadStartParams = CodexAppServerRequestParamsMap["thread/start"];
export type CodexAppServerThreadResumeParams = CodexAppServerRequestParamsMap["thread/resume"];
export type CodexAppServerThreadForkParams = CodexAppServerRequestParamsMap["thread/fork"];
export type CodexAppServerThreadSetNameParams = CodexAppServerRequestParamsMap["thread/name/set"];
export type CodexAppServerThreadCompactStartParams =
  CodexAppServerRequestParamsMap["thread/compact/start"];
export type CodexAppServerThreadListParams = CodexAppServerRequestParamsMap["thread/list"];
export type CodexAppServerThreadLoadedListParams =
  CodexAppServerRequestParamsMap["thread/loaded/list"];
export type CodexAppServerThreadReadParams = CodexAppServerRequestParamsMap["thread/read"];
export type CodexAppServerThreadTurnsListParams =
  CodexAppServerRequestParamsMap["thread/turns/list"];
export type CodexAppServerSkillsListParams = CodexAppServerRequestParamsMap["skills/list"];
export type CodexAppServerTurnStartParams = CodexAppServerRequestParamsMap["turn/start"];
export type CodexAppServerUserInput = z.output<typeof codexAppServerUserInputSchema>;
export type CodexAppServerTurnSteerParams = CodexAppServerRequestParamsMap["turn/steer"];
export type CodexAppServerTurnInterruptParams = CodexAppServerRequestParamsMap["turn/interrupt"];
export type CodexAppServerModelListParams = CodexAppServerRequestParamsMap["model/list"];
export type CodexAppServerGitDiffToRemoteParams = CodexAppServerRequestParamsMap["gitDiffToRemote"];
export type CodexAppServerFuzzyFileSearchParams = CodexAppServerRequestParamsMap["fuzzyFileSearch"];
type CodexAppServerClientRequestSchemaMap = typeof codexAppServerRequestParamsSchemas;
type CodexAppServerParsedClientRequestMap = {
  [Method in keyof CodexAppServerClientRequestSchemaMap]: {
    method: Method;
    params: z.output<CodexAppServerClientRequestSchemaMap[Method]>;
  };
};
type CodexAppServerClientRequestCandidate = {
  method: keyof CodexAppServerClientRequestSchemaMap;
  params: CodexAppServerRequestParamsMap[keyof CodexAppServerRequestParamsMap];
};
export type CodexAppServerParsedClientRequest = z.output<typeof codexAppServerClientRequestSchema>;

export function parseCodexAppServerClientRequest<
  Method extends keyof CodexAppServerClientRequestSchemaMap,
>(value: {
  method: Method;
  params: CodexAppServerRequestParamsMap[Method];
}): CodexAppServerParsedClientRequestMap[Method];
export function parseCodexAppServerClientRequest(
  value: CodexAppServerClientRequestCandidate,
): CodexAppServerParsedClientRequest;
export function parseCodexAppServerClientRequest(
  value: JSONType,
): CodexAppServerParsedClientRequest;
export function parseCodexAppServerClientRequest(
  value: JSONType | CodexAppServerClientRequestCandidate,
): CodexAppServerParsedClientRequest {
  return codexAppServerClientRequestSchema.parse(value);
}
