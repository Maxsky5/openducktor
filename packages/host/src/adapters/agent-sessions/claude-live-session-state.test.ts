import { describe, expect, test } from "bun:test";
import {
  type AgentSessionControlSummary,
  RUNTIME_DESCRIPTORS_BY_KIND,
} from "@openducktor/contracts";
import { AsyncInputQueue } from "../claude/claude-agent-sdk-queue";
import type { ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import { createClaudeLiveSessionState } from "./claude-live-session-state";

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
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
};

const ref = {
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

describe("Claude host live-session state", () => {
  test("retains a subagent permission only on the child snapshot", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const childExternalSessionId = "session-1::claude-subagent::child-1";

    state.applyEvent(session, {
      type: "approval_required",
      externalSessionId: childExternalSessionId,
      timestamp: "2026-07-17T10:02:00.000Z",
      requestId: "opaque-1",
      requestType: "command_execution",
      title: "Approve Bash",
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "child-1",
    });

    expect(state.readRetainedSnapshot(ref)).toMatchObject({
      type: "live",
      session: { pendingApprovals: [] },
    });
    expect(
      state.readRetainedSnapshot({ ...ref, externalSessionId: childExternalSessionId }),
    ).toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_permission",
        parentExternalSessionId: "session-1",
        pendingApprovals: [{ requestId: "opaque-1" }],
      },
    });
  });

  test("retains nested subagent ancestry from the emitting transcript", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const childExternalSessionId = "session-1::claude-subagent::child-1";
    const grandchildExternalSessionId = `${childExternalSessionId}::claude-subagent::grandchild-1`;

    state.applyEvent(session, {
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      part: {
        kind: "subagent",
        messageId: "root-assistant",
        partId: "claude-subagent:child-1",
        correlationKey: "child-1",
        status: "running",
        externalSessionId: childExternalSessionId,
      },
    });
    state.applyEvent(session, {
      type: "assistant_part",
      externalSessionId: childExternalSessionId,
      timestamp: "2026-07-17T10:02:01.000Z",
      part: {
        kind: "subagent",
        messageId: "child-assistant",
        partId: "claude-subagent:grandchild-1",
        correlationKey: "grandchild-1",
        status: "running",
        externalSessionId: grandchildExternalSessionId,
      },
    });

    expect(
      state.readRetainedSnapshot({ ...ref, externalSessionId: childExternalSessionId }),
    ).toMatchObject({
      type: "live",
      session: { parentExternalSessionId: "session-1" },
    });
    expect(
      state.readRetainedSnapshot({ ...ref, externalSessionId: grandchildExternalSessionId }),
    ).toMatchObject({
      type: "live",
      session: { parentExternalSessionId: childExternalSessionId },
    });
  });

  test("drops late root and subagent events after release until an explicit resume", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const childExternalSessionId = "session-1::claude-subagent::child-1";

    expect(state.removeSession(ref)).toEqual([{ type: "session_removed", ref }]);
    expect(
      state.applyEvent(session, {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:02:00.000Z",
        messageId: "late-root",
        message: "Late root response",
      }),
    ).toEqual([]);
    expect(
      state.applyEvent(session, {
        type: "approval_required",
        externalSessionId: childExternalSessionId,
        timestamp: "2026-07-17T10:02:01.000Z",
        requestId: "late-child",
        requestType: "command_execution",
        title: "Late child approval",
        parentExternalSessionId: "session-1",
        childExternalSessionId,
        subagentCorrelationKey: "child-1",
      }),
    ).toEqual([]);
    expect(state.readRetainedSnapshot(ref)).toEqual({ type: "missing", ref });

    expect(state.retainControlSummary({ ...summary, status: "running" })).toContainEqual({
      type: "session_upsert",
      snapshot: expect.objectContaining({ activity: "running", ref }),
    });
    expect(
      state.applyEvent(session, {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:02:02.000Z",
        messageId: "resumed-root",
        message: "Resumed response",
      }),
    ).toContainEqual({
      type: "transcript_event",
      event: expect.objectContaining({ messageId: "resumed-root" }),
    });
  });

  test("does not overwrite newer streamed context with an explicit load", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const revision = state.contextRevision(ref);
    state.applyEvent(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:00.000Z",
      totalTokens: 99,
      contextWindow: 200,
    });

    expect(state.applyLoadedContext(ref, { totalTokens: 12 }, revision)).toEqual({
      value: { totalTokens: 99, contextWindow: 200 },
      changes: [],
    });
  });

  test("advances context revisions only for streamed context events", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const revision = state.contextRevision(ref);

    state.applyLoadedContext(ref, { totalTokens: 100, contextWindow: 200 }, revision);
    state.applyEvent(session, {
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:00.000Z",
      status: { type: "busy", message: null },
    });
    expect(state.contextRevision(ref)).toBe(revision);

    state.applyEvent(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:01.000Z",
      totalTokens: 100,
      contextWindow: 200,
    });
    expect(state.contextRevision(ref)).toBe(revision + 1);
  });

  test("scopes context refresh errors to the affected session", () => {
    const state = createClaudeLiveSessionState({ runtime });

    expect(
      state.applyEvent(session, {
        type: "session_context_error",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:03:02.000Z",
        message: "Context refresh timed out.",
      }),
    ).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        operation: "claude-live-session.load-context",
        message: "Context refresh timed out.",
        ref,
      },
    ]);
  });

  test("ignores late context refresh errors after session removal", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    state.removeSession(ref);

    expect(
      state.applyEvent(session, {
        type: "session_context_error",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:03:03.000Z",
        message: "Context refresh was interrupted.",
      }),
    ).toEqual([]);
  });

  test("keeps a no-message session idle when its start event arrives", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);

    expect(
      state.applyEvent(session, {
        type: "session_started",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:03:04.000Z",
        message: "Started build session",
      }),
    ).toEqual([
      {
        type: "transcript_event",
        event: expect.objectContaining({ type: "session_started" }),
      },
    ]);
    expect(state.readRetainedSnapshot(ref)).toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
  });

  test("keeps retained session state after a recoverable turn error", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary({ ...summary, status: "running" });

    expect(
      state.applyEvent(session, {
        type: "turn_error",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:03:05.000Z",
        message: "Claude turn failed.",
      }),
    ).toEqual([
      {
        type: "transcript_event",
        event: expect.objectContaining({ type: "turn_error" }),
      },
    ]);
    state.applyEvent(session, {
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:06.000Z",
    });
    expect(state.readRetainedSnapshot(ref)).toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
  });

  test("removes subagent snapshots owned by a retracted assistant message", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const childExternalSessionId = "session-1::claude-subagent::child-1";
    const childRef = { ...ref, externalSessionId: childExternalSessionId };
    const retainedChildExternalSessionId = "session-1::claude-subagent::child-2";
    const retainedChildRef = { ...ref, externalSessionId: retainedChildExternalSessionId };

    state.applyEvent(session, {
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:05.000Z",
      part: {
        kind: "subagent",
        messageId: "assistant-with-subagent",
        partId: "claude-subagent:child-1",
        correlationKey: "child-1",
        status: "running",
        externalSessionId: childExternalSessionId,
      },
    });
    state.applyEvent(session, {
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:05.000Z",
      part: {
        kind: "subagent",
        messageId: "unrelated-assistant",
        partId: "claude-subagent:child-2",
        correlationKey: "child-2",
        status: "running",
        externalSessionId: retainedChildExternalSessionId,
      },
    });
    expect(state.readRetainedSnapshot(childRef)).toMatchObject({ type: "live" });

    expect(
      state.applyEvent(session, {
        type: "transcript_retracted",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:03:06.000Z",
        messageIds: ["assistant-with-subagent"],
      }),
    ).toEqual([
      {
        type: "transcript_event",
        event: expect.objectContaining({
          type: "transcript_retracted",
          messageIds: ["assistant-with-subagent"],
        }),
      },
      { type: "session_removed", ref: childRef },
    ]);
    expect(state.readRetainedSnapshot(ref)).toMatchObject({ type: "live" });
    expect(state.readRetainedSnapshot(childRef)).toEqual({ type: "missing", ref: childRef });
    expect(state.readRetainedSnapshot(retainedChildRef)).toMatchObject({ type: "live" });
  });

  test("removes retained session state after a terminal stream finish", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary({ ...summary, status: "running" });

    expect(
      state.applyEvent(session, {
        type: "session_finished",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:03:05.000Z",
        message: "Claude stream failed.",
      }),
    ).toEqual([
      {
        type: "transcript_event",
        event: expect.objectContaining({ type: "session_finished" }),
      },
      { type: "session_removed", ref },
    ]);
    expect(state.readRetainedSnapshot(ref)).toEqual({ type: "missing", ref });
  });

  test("keeps an independent fork when its source session finishes", () => {
    const state = createClaudeLiveSessionState({ runtime });
    const forkExternalSessionId = "session-fork";
    const forkRef = { ...ref, externalSessionId: forkExternalSessionId };
    const childExternalSessionId = "session-1::claude-subagent::child-1";
    const childRef = { ...ref, externalSessionId: childExternalSessionId };
    const forkSummary = { ...summary, externalSessionId: forkExternalSessionId };
    const forkSession: ClaudeSessionContext = {
      ...session,
      externalSessionId: forkExternalSessionId,
      summary: forkSummary,
    };

    state.retainControlSummary(summary);
    state.retainControlSummary(forkSummary, { parentExternalSessionId: "session-1" });
    state.applyEvent(session, {
      type: "approval_required",
      externalSessionId: childExternalSessionId,
      timestamp: "2026-07-17T10:02:00.000Z",
      requestId: "child-approval",
      requestType: "command_execution",
      title: "Approve Bash",
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "child-1",
    });

    const changes = state.applyEvent(session, {
      type: "session_finished",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:03:05.000Z",
      message: "Source session finished.",
    });

    expect(changes).toContainEqual({ type: "session_removed", ref });
    expect(changes).toContainEqual({ type: "session_removed", ref: childRef });
    expect(changes).not.toContainEqual({ type: "session_removed", ref: forkRef });
    expect(state.readRetainedSnapshot(forkRef)).toMatchObject({
      type: "live",
      session: { parentExternalSessionId: "session-1" },
    });
    expect(
      state.applyEvent(forkSession, {
        type: "assistant_message",
        externalSessionId: forkExternalSessionId,
        timestamp: "2026-07-17T10:03:06.000Z",
        messageId: "fork-assistant",
        message: "Fork is still live.",
      }),
    ).toContainEqual({
      type: "transcript_event",
      event: expect.objectContaining({ messageId: "fork-assistant" }),
    });
  });

  test("replaces stale retained context when no newer context update arrives", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const firstRevision = state.contextRevision(ref);
    state.applyLoadedContext(ref, { totalTokens: 99, contextWindow: 200 }, firstRevision);
    const refreshRevision = state.contextRevision(ref);

    expect(
      state.applyLoadedContext(ref, { totalTokens: 120, contextWindow: 200 }, refreshRevision),
    ).toMatchObject({
      value: { totalTokens: 120, contextWindow: 200 },
      changes: [{ type: "session_upsert" }],
    });
  });

  test("keeps retained context when a direct context read returns null", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);
    const firstRevision = state.contextRevision(ref);
    state.applyLoadedContext(ref, { totalTokens: 99, contextWindow: 200 }, firstRevision);

    expect(state.applyLoadedContext(ref, null, state.contextRevision(ref))).toEqual({
      value: { totalTokens: 99, contextWindow: 200 },
      changes: [],
    });
  });

  test("preserves retained activity when an already-live session is resumed", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary({ ...summary, status: "running" });
    state.applyEvent(session, {
      type: "approval_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve Bash",
    });

    state.retainControlSummary(summary, { preserveRetainedActivity: true });

    expect(state.readRetainedSnapshot(ref)).toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_permission",
        pendingApprovals: [{ requestId: "approval-1" }],
      },
    });
  });

  test("publishes assistant duration through the normalized transcript", () => {
    const state = createClaudeLiveSessionState({ runtime });
    state.retainControlSummary(summary);

    expect(
      state.applyEvent(session, {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:04:00.000Z",
        messageId: "assistant-1",
        message: "Done",
        durationMs: 4_200,
      }),
    ).toContainEqual({
      type: "transcript_event",
      event: expect.objectContaining({
        type: "assistant_message",
        messageId: "assistant-1",
        durationMs: 4_200,
      }),
    });
  });

  test("publishes the authoritative slash-command replacement catalog", () => {
    const state = createClaudeLiveSessionState({ runtime });
    const catalog = {
      commands: [
        {
          id: "review",
          trigger: "review",
          title: "review",
          source: "command" as const,
          hints: [],
        },
      ],
    };

    expect(
      state.applyEvent(session, {
        type: "runtime_slash_commands_changed",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:05:00.000Z",
        catalog,
      }),
    ).toEqual([
      {
        type: "slash_command_catalog_updated",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        catalog,
      },
    ]);
  });
});
