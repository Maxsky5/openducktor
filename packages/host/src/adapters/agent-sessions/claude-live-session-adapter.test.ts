import { describe, expect, test } from "bun:test";
import {
  type AgentSessionControlSummary,
  RUNTIME_DESCRIPTORS_BY_KIND,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import { AsyncInputQueue } from "../claude/claude-agent-sdk-queue";
import type { ClaudeSessionContext, ClaudeSessionStore } from "../claude/claude-agent-sdk-types";
import {
  createClaudeAgentSdkEventHub,
  createClaudeLiveSessionAdapterPreparer,
} from "./claude-live-session-adapter";

const runtime = {
  kind: "claude" as const,
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace" as const,
  workingDirectory: "/repo",
  runtimeRoute: { type: "host_service" as const, identity: "runtime-1" },
  startedAt: "2026-07-17T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
};

const summary = {
  externalSessionId: "session-1",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  title: "Claude build",
  role: "build",
  startedAt: "2026-07-17T10:01:00.000Z",
  status: "idle",
} as const satisfies AgentSessionControlSummary;

const session: ClaudeSessionContext = {
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: summary.startedAt,
  summary,
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
};

const startInput = {
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo/worktree",
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
  systemPrompt: "Build",
};

const createHarness = async () => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const eventHub = createClaudeAgentSdkEventHub();
  let sendUserMessageImpl: ClaudeAgentSdkService["sendUserMessage"] = () =>
    Effect.die("sendUserMessage was not configured");
  const service = {
    startSession: () => {
      eventHub.emit(session, {
        type: "session_started",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:01:00.000Z",
        message: "Started build session",
      });
      eventHub.emit(session, {
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:01:01.000Z",
      });
      return Effect.succeed(summary);
    },
    sendUserMessage: (input: Parameters<ClaudeAgentSdkService["sendUserMessage"]>[0]) =>
      sendUserMessageImpl(input),
  } as unknown as ClaudeAgentSdkService;
  const liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation"> = {
    runAdapterMutation: (mutation) =>
      Effect.map(mutation, ({ value, changes: mutationChanges }) => {
        changes.push(...mutationChanges);
        return value;
      }),
  };
  const prepare = createClaudeLiveSessionAdapterPreparer({
    eventHub,
    liveSessionLifecycle,
    service,
    sessionStore: {
      get: (externalSessionId) =>
        externalSessionId === session.externalSessionId
          ? (session as unknown as ReturnType<ClaudeSessionStore["get"]>)
          : undefined,
    } as ClaudeSessionStore,
  });
  const prepared = await Effect.runPromise(prepare(runtime));
  await Effect.runPromise(prepared.startForwarding());
  return {
    adapter: prepared.adapter as AgentSessionRuntimeAdapterPort,
    changes,
    eventHub,
    setSendUserMessage: (implementation: ClaudeAgentSdkService["sendUserMessage"]) => {
      sendUserMessageImpl = implementation;
    },
  };
};

const transcriptEventTypes = (changes: readonly AgentSessionLiveAdapterChange[]): string[] =>
  changes.flatMap((change) => (change.type === "transcript_event" ? [change.event.type] : []));

describe("Claude host live-session adapter", () => {
  test("publishes the running start snapshot before suppressing SDK initialization idle", async () => {
    const harness = await createHarness();

    await expect(
      Effect.runPromise(harness.adapter.startSession(startInput)),
    ).resolves.toMatchObject({
      externalSessionId: "session-1",
      status: "running",
    });

    expect(harness.changes[0]).toMatchObject({
      type: "session_upsert",
      snapshot: { activity: "running" },
    });
    expect(transcriptEventTypes(harness.changes)).toEqual(["session_started"]);
  });

  test("publishes accepted input before draining its runtime response", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setSendUserMessage((input) => {
      harness.eventHub.emit(session, {
        type: "session_status",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:02:00.000Z",
        status: { type: "busy", message: null },
      });
      harness.eventHub.emit(session, {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:02:01.000Z",
        messageId: "assistant-1",
        message: "Done",
      });
      harness.eventHub.emit(session, {
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:02:02.000Z",
      });
      return Effect.succeed({
        type: "user_message" as const,
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-17T10:01:59.000Z",
        messageId: "user-1",
        message: "Start",
        parts: [{ kind: "text" as const, text: "Start" }],
        state: "read" as const,
      });
    });

    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Start" }],
      }),
    );

    expect(transcriptEventTypes(harness.changes)).toEqual([
      "user_message",
      "session_status",
      "assistant_message",
      "session_idle",
    ]);
  });
});
