import { mock } from "bun:test";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { ClaudeSession } from "./claude-agent-sdk-types";

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
  query: {} as ClaudeSession["query"],
  queue: new AsyncInputQueue<SDKUserMessage>(),
  runtimeId: "claude-runtime-1",
  startedAt: "2026-06-25T20:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    role: "build",
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  ...overrides,
});

const emptySdkMessages: SDKMessage[] = [];

const defaultQueryControls = () => ({
  close: mock(() => {}),
  getContextUsage: mock(async () => ({
    totalTokens: 0,
    maxTokens: 0,
  })),
});

export const emptyClaudeQuery = (): ClaudeSession["query"] =>
  Object.assign(
    (async function* (): AsyncGenerator<SDKMessage> {
      yield* emptySdkMessages;
    })(),
    defaultQueryControls(),
  ) as unknown as ClaudeSession["query"];

export const claudeQueryWithMessages = (messages: SDKMessage[]): ClaudeSession["query"] =>
  Object.assign(
    (async function* (): AsyncGenerator<SDKMessage> {
      yield* messages;
    })(),
    defaultQueryControls(),
  ) as unknown as ClaudeSession["query"];

export const openClaudeQueryWithMessages = (
  messages: SDKMessage[],
): { query: ClaudeSession["query"]; release: () => void } => {
  let release!: () => void;
  const openStream = new Promise<void>((resolve) => {
    release = resolve;
  });
  const query = Object.assign(
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
  ) as unknown as ClaudeSession["query"];
  return { query, release };
};

export const throwingClaudeQuery = (error: Error): ClaudeSession["query"] =>
  Object.assign(
    (async function* (): AsyncGenerator<SDKMessage> {
      yield* emptySdkMessages;
      throw error;
    })(),
    defaultQueryControls(),
  ) as unknown as ClaudeSession["query"];

export const waitForTimers = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};
