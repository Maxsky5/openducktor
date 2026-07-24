import { describe, expect, test } from "bun:test";
import {
  agentSessionContextUsageSchema,
  agentSessionLiveEnvelopeSchema,
  agentSessionLiveLoadContextInputSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveRefreshInputSchema,
  agentSessionLiveReplyApprovalInputSchema,
  agentSessionLiveSnapshotSchema,
} from "./agent-session-live-schemas";
import type { AgentSessionLiveRef } from "./agent-session-schemas";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread-1",
} as const satisfies AgentSessionLiveRef;

const snapshot = {
  ref,
  activity: "waiting_for_permission",
  title: "Implement live state",
  startedAt: "2026-07-16T10:00:00.000Z",
  pendingApprovals: [
    {
      requestId: "opaque-request-1",
      requestType: "command_execution",
      title: "Run tests",
      command: { command: "bun test", workingDirectory: "/repo/worktree" },
      supportedReplyOutcomes: ["approve_once", "reject"],
    },
  ],
  pendingQuestions: [],
  contextUsage: null,
} as const;

describe("agent-session live contracts", () => {
  test("parses snapshots with explicit unknown or populated context usage", () => {
    expect(agentSessionLiveSnapshotSchema.parse(snapshot)).toEqual(snapshot);

    const populated = {
      ...snapshot,
      contextUsage: {
        totalTokens: 12_000,
        contextWindow: 200_000,
        outputLimit: 32_000,
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "build",
      },
    };
    expect(agentSessionLiveSnapshotSchema.parse(populated)).toEqual(populated);
  });

  test("requires finite nonnegative context numbers and ISO timestamps", () => {
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(agentSessionContextUsageSchema.safeParse({ totalTokens: invalid }).success).toBe(
        false,
      );
    }

    expect(
      agentSessionLiveSnapshotSchema.safeParse({ ...snapshot, startedAt: "last Tuesday" }).success,
    ).toBe(false);
  });

  test("keeps missing point reads distinct from idle live sessions", () => {
    expect(
      agentSessionLiveReadResultSchema.parse({
        type: "live",
        session: { ...snapshot, activity: "idle" },
      }),
    ).toEqual({ type: "live", session: { ...snapshot, activity: "idle" } });
    expect(agentSessionLiveReadResultSchema.parse({ type: "missing", ref })).toEqual({
      type: "missing",
      ref,
    });
    expect(
      agentSessionLiveReadResultSchema.safeParse({
        type: "missing",
        ref,
        activity: "idle",
      }).success,
    ).toBe(false);
  });

  test("rejects runtime-native routing fields from public inputs and pending requests", () => {
    expect(
      agentSessionLiveRefreshInputSchema.safeParse({
        repoPath: "/repo",
        runtimeId: "runtime-private",
      }).success,
    ).toBe(false);
    expect(
      agentSessionLiveSnapshotSchema.safeParse({
        ...snapshot,
        pendingApprovals: [
          {
            ...snapshot.pendingApprovals[0],
            requestInstanceId: "codex-native-id",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      agentSessionLiveReplyApprovalInputSchema.safeParse({
        ...ref,
        requestId: { runtimeId: "runtime-private", nativeRequestId: 7 },
        outcome: "approve_once",
      }).success,
    ).toBe(false);
  });

  test("accepts only an optional normalized workflow scope for context loading", () => {
    expect(
      agentSessionLiveLoadContextInputSchema.parse({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    ).toEqual({
      ...ref,
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    expect(agentSessionLiveLoadContextInputSchema.parse(ref)).toEqual(ref);

    for (const nativeField of [
      { runtimeId: "runtime-private" },
      { runtimePolicy: { kind: "codex" } },
      { sessionScope: { kind: "workflow", taskId: "task-1", role: "build", runtimeId: "x" } },
    ]) {
      expect(
        agentSessionLiveLoadContextInputSchema.safeParse({ ...ref, ...nativeField }).success,
      ).toBe(false);
    }
  });

  test("routes ordered envelope variants by repository without attachment identity", () => {
    const variants = [
      { type: "snapshot", repoPath: ref.repoPath, sessions: [snapshot] },
      { type: "session_upsert", session: snapshot },
      { type: "session_removed", ref },
      {
        type: "transcript_event",
        event: {
          type: "assistant_delta",
          externalSessionId: ref.externalSessionId,
          timestamp: "2026-07-16T10:00:01.000Z",
          sessionRef: ref,
          channel: "text",
          delta: "hello",
        },
      },
      {
        type: "catalog_invalidated",
        scope: {
          repoPath: ref.repoPath,
          runtimeKind: ref.runtimeKind,
          workingDirectory: ref.workingDirectory,
        },
      },
      {
        type: "slash_command_catalog_updated",
        scope: {
          repoPath: ref.repoPath,
          runtimeKind: "claude",
          workingDirectory: ref.workingDirectory,
        },
        catalog: {
          commands: [
            {
              id: "review",
              trigger: "review",
              title: "review",
              source: "command",
              hints: [],
            },
          ],
        },
      },
      {
        type: "transcript_gap",
        repoPath: ref.repoPath,
        message: "Host event replay skipped transcript events.",
      },
      {
        type: "fault",
        repoPath: ref.repoPath,
        message: "Runtime disconnected",
        operation: "agentSessionLive.observe",
        ref,
      },
    ] as const;

    for (const variant of variants) {
      expect(agentSessionLiveEnvelopeSchema.parse(variant)).toEqual(variant);
      expect(
        agentSessionLiveEnvelopeSchema.safeParse({
          ...variant,
          attachmentId: "obsolete-attachment",
        }).success,
      ).toBe(false);
    }
  });
});
