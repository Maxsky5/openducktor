import type {
  CodexAppServerConsumedRuntimeNotification,
  CodexAppServerThreadItem,
  CodexAppServerTurn,
} from "@openducktor/contracts";

type CodexCommandExecutionItem = Extract<CodexAppServerThreadItem, { type: "commandExecution" }>;
type CodexCollabAgentToolCallItem = Extract<
  CodexAppServerThreadItem,
  { type: "collabAgentToolCall" }
>;
type CodexDynamicToolCallItem = Extract<CodexAppServerThreadItem, { type: "dynamicToolCall" }>;
type CodexAgentMessageItem = Extract<CodexAppServerThreadItem, { type: "agentMessage" }>;
type CodexUserMessageItem = Extract<CodexAppServerThreadItem, { type: "userMessage" }>;
type CodexSubAgentActivityItem = Extract<CodexAppServerThreadItem, { type: "subAgentActivity" }>;
type CodexMcpToolCallItem = Extract<CodexAppServerThreadItem, { type: "mcpToolCall" }>;
type CodexFileChangeItem = Extract<CodexAppServerThreadItem, { type: "fileChange" }>;
type CodexWebSearchItem = Extract<CodexAppServerThreadItem, { type: "webSearch" }>;
type CodexTokenUsage = Extract<
  CodexAppServerConsumedRuntimeNotification,
  { method: "thread/tokenUsage/updated" }
>["params"]["tokenUsage"];

export const codexTurnFixture = (
  input: Pick<CodexAppServerTurn, "id" | "items" | "status"> & Partial<CodexAppServerTurn>,
): CodexAppServerTurn => ({
  completedAt: null,
  durationMs: null,
  error: null,
  itemsView: "full",
  startedAt: null,
  ...input,
});

const codexTokenUsageBreakdownFixture = (totalTokens: number) => ({
  totalTokens,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

export const codexTokenUsageFixture = (
  totalTokens: number,
  modelContextWindow: number | null = 200_000,
): CodexTokenUsage => ({
  total: codexTokenUsageBreakdownFixture(totalTokens),
  last: codexTokenUsageBreakdownFixture(totalTokens),
  modelContextWindow,
});

export const codexCommandExecutionItemFixture = (
  input: Pick<CodexCommandExecutionItem, "id"> & Partial<CodexCommandExecutionItem>,
): CodexCommandExecutionItem => ({
  type: "commandExecution",
  pluginId: null,
  scriptPath: null,
  command: "true",
  cwd: "/repo",
  processId: null,
  source: "agent",
  status: "completed",
  commandActions: [],
  aggregatedOutput: "",
  exitCode: 0,
  durationMs: null,
  ...input,
});

export const codexCollabAgentToolCallFixture = (
  input: Pick<CodexCollabAgentToolCallItem, "id" | "senderThreadId" | "status" | "tool"> &
    Partial<CodexCollabAgentToolCallItem>,
): CodexCollabAgentToolCallItem => ({
  type: "collabAgentToolCall",
  receiverThreadIds: [],
  prompt: null,
  model: null,
  reasoningEffort: null,
  agentsStates: {},
  ...input,
});

export const codexDynamicToolCallFixture = (
  input: Pick<CodexDynamicToolCallItem, "id" | "tool"> & Partial<CodexDynamicToolCallItem>,
): CodexDynamicToolCallItem => ({
  type: "dynamicToolCall",
  namespace: null,
  arguments: {},
  status: "completed",
  contentItems: null,
  success: true,
  durationMs: null,
  ...input,
});

export const codexAgentMessageItemFixture = (
  input: Pick<CodexAgentMessageItem, "id" | "text"> & Partial<CodexAgentMessageItem>,
): CodexAgentMessageItem => ({
  type: "agentMessage",
  phase: null,
  memoryCitation: null,
  ...input,
});

export const codexUserMessageItemFixture = (
  input: Pick<CodexUserMessageItem, "content" | "id"> & Partial<CodexUserMessageItem>,
): CodexUserMessageItem => ({
  type: "userMessage",
  clientId: null,
  ...input,
});

export const codexSubAgentActivityItemFixture = (
  input: Pick<CodexSubAgentActivityItem, "agentThreadId" | "id" | "kind"> &
    Partial<CodexSubAgentActivityItem>,
): CodexSubAgentActivityItem => ({
  type: "subAgentActivity",
  agentPath: "/root",
  ...input,
});

export const codexMcpToolCallItemFixture = (
  input: Pick<CodexMcpToolCallItem, "id" | "server" | "tool"> & Partial<CodexMcpToolCallItem>,
): CodexMcpToolCallItem => ({
  type: "mcpToolCall",
  status: "completed",
  arguments: {},
  appContext: null,
  pluginId: null,
  readOnlyHint: null,
  result: null,
  error: null,
  durationMs: null,
  ...input,
});

export const codexFileChangeItemFixture = (
  input: Pick<CodexFileChangeItem, "changes" | "id"> & Partial<CodexFileChangeItem>,
): CodexFileChangeItem => ({
  type: "fileChange",
  status: "completed",
  ...input,
});

export const codexWebSearchItemFixture = (
  input: Pick<CodexWebSearchItem, "id" | "query"> & Partial<CodexWebSearchItem>,
): CodexWebSearchItem => ({
  type: "webSearch",
  action: null,
  results: null,
  ...input,
});
