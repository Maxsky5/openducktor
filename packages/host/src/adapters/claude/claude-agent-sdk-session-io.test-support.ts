import { mock } from "bun:test";
import type {
  Query,
  SDKControlGetContextUsageResponse,
  SDKControlInitializeResponse,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import type { HostOperationError } from "../../effect/host-errors";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { ClaudeSession, ClaudeSessionQuery } from "./claude-agent-sdk-types";

export const ignoreClaudeBackgroundFailure = (_failure: HostOperationError) => Effect.void;

export const createClaudeQueryFixture = (query: Partial<ClaudeSessionQuery>): Query => {
  const overrides = { ...query };
  const stream = isClaudeMessageStream(query) ? query : emptyClaudeMessageStream();
  return Object.assign(stream, defaultQueryControls(), overrides);
};

export const createClaudeContextUsageResponse = (
  totalTokens: number,
  maxTokens: number,
): SDKControlGetContextUsageResponse => ({
  agents: [],
  apiUsage: null,
  categories: [],
  gridRows: [],
  isAutoCompactEnabled: false,
  maxTokens,
  memoryFiles: [],
  mcpTools: [],
  model: "test-model",
  percentage: maxTokens === 0 ? 0 : (totalTokens / maxTokens) * 100,
  rawMaxTokens: maxTokens,
  totalTokens,
});

export const createClaudeSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  query: createClaudeQueryFixture({}),
  queue: new AsyncInputQueue<SDKUserMessage>(),
  runtimeId: "claude-runtime-1",
  startedAt: "2026-06-25T20:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
  ...overrides,
});

const emptySdkMessages: SDKMessage[] = [];

const emptyClaudeMessageStream = async function* (): AsyncGenerator<SDKMessage, void> {
  yield* emptySdkMessages;
};

const isClaudeMessageStream = (
  query: Partial<ClaudeSessionQuery>,
): query is Partial<ClaudeSessionQuery> & AsyncGenerator<SDKMessage, void> =>
  Symbol.asyncIterator in query;

const defaultInitializationResponse = (): SDKControlInitializeResponse => ({
  commands: [],
  agents: [],
  output_style: "default",
  available_output_styles: [],
  models: [],
  account: {},
});

type ClaudeQueryControlMethods = Pick<
  Query,
  | "accountInfo"
  | "applyFlagSettings"
  | "backgroundTasks"
  | "close"
  | "getContextUsage"
  | "initializationResult"
  | "interrupt"
  | "mcpServerStatus"
  | "readFile"
  | "reconnectMcpServer"
  | "reinitialize"
  | "reloadPlugins"
  | "reloadSkills"
  | "rewindFiles"
  | "seedReadState"
  | "setMaxThinkingTokens"
  | "setMcpPermissionModeOverride"
  | "setMcpServers"
  | "setModel"
  | "setPermissionMode"
  | "stopTask"
  | "streamInput"
  | "supportedAgents"
  | "supportedCommands"
  | "supportedModels"
  | "toggleMcpServer"
  | "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"
>;

const unusedQueryControl = async (): Promise<never> => {
  throw new Error("Claude query control is not configured for this test.");
};

const defaultQueryControls = (): ClaudeQueryControlMethods => ({
  accountInfo: mock(unusedQueryControl),
  applyFlagSettings: mock(async () => {}),
  backgroundTasks: mock(unusedQueryControl),
  close: mock(() => {}),
  getContextUsage: mock(async () => createClaudeContextUsageResponse(0, 0)),
  initializationResult: mock(async () => defaultInitializationResponse()),
  interrupt: mock(unusedQueryControl),
  mcpServerStatus: mock(async () => []),
  readFile: mock(unusedQueryControl),
  reconnectMcpServer: mock(unusedQueryControl),
  reinitialize: mock(unusedQueryControl),
  reloadPlugins: mock(unusedQueryControl),
  reloadSkills: mock(unusedQueryControl),
  rewindFiles: mock(unusedQueryControl),
  seedReadState: mock(unusedQueryControl),
  setMaxThinkingTokens: mock(unusedQueryControl),
  setMcpPermissionModeOverride: mock(unusedQueryControl),
  setMcpServers: mock(unusedQueryControl),
  setModel: mock(async () => {}),
  setPermissionMode: mock(unusedQueryControl),
  stopTask: mock(unusedQueryControl),
  streamInput: mock(unusedQueryControl),
  supportedAgents: mock(unusedQueryControl),
  supportedCommands: mock(unusedQueryControl),
  supportedModels: mock(unusedQueryControl),
  toggleMcpServer: mock(unusedQueryControl),
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: mock(unusedQueryControl),
});

export const emptyClaudeQuery = (): ClaudeSession["query"] =>
  createClaudeQueryFixture(
    Object.assign(
      (async function* (): AsyncGenerator<SDKMessage> {
        yield* emptySdkMessages;
      })(),
      defaultQueryControls(),
    ),
  );

export const claudeQueryWithMessages = (messages: SDKMessage[]): ClaudeSession["query"] =>
  createClaudeQueryFixture(
    Object.assign(
      (async function* (): AsyncGenerator<SDKMessage> {
        yield* messages;
      })(),
      defaultQueryControls(),
    ),
  );

export const openClaudeQueryWithMessages = (messages: SDKMessage[]) => {
  let release!: () => void;
  const openStream = new Promise<void>((resolve) => {
    release = resolve;
  });
  const query = createClaudeQueryFixture(
    Object.assign(
      (async function* (): AsyncGenerator<SDKMessage> {
        yield* messages;
        await openStream;
      })(),
      {
        ...defaultQueryControls(),
        close: mock(() => {
          release();
        }),
      },
    ),
  );
  return { query, release } satisfies { query: ClaudeSession["query"]; release: () => void };
};

export const throwingClaudeQuery = (
  error: Error,
  messages: SDKMessage[] = emptySdkMessages,
): ClaudeSession["query"] =>
  createClaudeQueryFixture(
    Object.assign(
      (async function* (): AsyncGenerator<SDKMessage> {
        yield* messages;
        throw error;
      })(),
      defaultQueryControls(),
    ),
  );

export const waitForTimers = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};
