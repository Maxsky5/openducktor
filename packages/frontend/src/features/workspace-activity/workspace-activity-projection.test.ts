import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  applyWorkspaceActivityEnvelope,
  emptyWorkspaceActivityProjection,
  type WorkspaceActivityProjection,
} from "./workspace-activity-projection";
import { foldWorkspaceActivityBadges } from "./workspace-activity-state";

const repoPath = "/repo";
const workingDirectory = "/repo";
const runtimeKind = "codex" as const;

const snapshot = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: { repoPath, runtimeKind, workingDirectory, externalSessionId },
  activity: "idle",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-09-15T08:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const key = (externalSessionId: string): string =>
  agentSessionIdentityKey({ externalSessionId, runtimeKind, workingDirectory });

const apply = (
  current: WorkspaceActivityProjection,
  ...envelopes: AgentSessionLiveEnvelope[]
): WorkspaceActivityProjection =>
  envelopes.reduce(
    (projection, envelope) => applyWorkspaceActivityEnvelope(projection, envelope),
    current,
  );

const badges = (projection: WorkspaceActivityProjection) =>
  foldWorkspaceActivityBadges(projection.sessions, new Set());

const sessionSnapshot = (sessions: AgentSessionLiveSnapshot[]): AgentSessionLiveEnvelope => ({
  type: "snapshot",
  repoPath,
  sessions,
});

const sessionErrorEvent = (externalSessionId: string): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    type: "session_error",
    externalSessionId,
    timestamp: "2026-09-15T08:01:00.000Z",
    sessionRef: { repoPath, runtimeKind, workingDirectory, externalSessionId },
    message: "runtime crashed",
  },
});

describe("applyWorkspaceActivityEnvelope", () => {
  test("marks the projection ready and keeps only snapshot sessions", () => {
    const projection = apply(
      emptyWorkspaceActivityProjection(),
      sessionSnapshot([snapshot("a", { activity: "running" }), snapshot("b")]),
      sessionSnapshot([snapshot("b")]),
    );

    expect(projection.hasSnapshot).toBe(true);
    expect([...projection.sessions.keys()]).toEqual([key("b")]);
    expect(badges(projection)).toEqual({ inputRequired: false, error: false, active: false });
  });

  test("reports running and waiting sessions side by side", () => {
    const projection = apply(
      emptyWorkspaceActivityProjection(),
      sessionSnapshot([
        snapshot("running", { activity: "running" }),
        snapshot("waiting", {
          activity: "waiting_for_question",
          pendingQuestions: [{ requestId: "q", questions: [] }],
        }),
      ]),
    );

    expect(badges(projection)).toEqual({ inputRequired: true, error: false, active: true });
  });

  test("attributes subagent pending input to its parent and ignores the subagent status", () => {
    const projection = apply(
      emptyWorkspaceActivityProjection(),
      sessionSnapshot([
        snapshot("parent"),
        snapshot("child", {
          parentExternalSessionId: "parent",
          activity: "running",
          pendingQuestions: [{ requestId: "q", questions: [] }],
        }),
      ]),
    );

    expect(badges(projection)).toEqual({ inputRequired: true, error: false, active: false });
  });

  test("derives the error badge from a session error transcript event", () => {
    const projection = apply(
      emptyWorkspaceActivityProjection(),
      sessionSnapshot([snapshot("a", { activity: "running" })]),
      sessionErrorEvent("a"),
    );

    expect(badges(projection)).toEqual({ inputRequired: false, error: true, active: false });
  });

  test("clears a preserved error when the session starts a new execution episode", () => {
    const failed = apply(
      emptyWorkspaceActivityProjection(),
      sessionSnapshot([snapshot("a", { activity: "running", executionEpisodeId: "episode-1" })]),
      sessionErrorEvent("a"),
    );
    expect(badges(failed)).toEqual({ inputRequired: false, error: true, active: false });

    const keptOverIdleReport = apply(
      failed,
      sessionSnapshot([snapshot("a", { activity: "idle", executionEpisodeId: "episode-1" })]),
    );
    expect(badges(keptOverIdleReport)).toEqual({
      inputRequired: false,
      error: true,
      active: false,
    });

    const newEpisode = apply(
      keptOverIdleReport,
      sessionSnapshot([snapshot("a", { activity: "idle", executionEpisodeId: "episode-2" })]),
    );
    expect(badges(newEpisode)).toEqual({ inputRequired: false, error: false, active: false });
  });

  test("drops a removed session", () => {
    const projection = apply(
      emptyWorkspaceActivityProjection(),
      sessionSnapshot([snapshot("a", { activity: "running" })]),
      {
        type: "session_removed",
        ref: { repoPath, runtimeKind, workingDirectory, externalSessionId: "a" },
      },
    );

    expect(projection.sessions.size).toBe(0);
    expect(badges(projection)).toEqual({ inputRequired: false, error: false, active: false });
  });

  test("records a fault reason and clears it on the next snapshot", () => {
    const faulted = apply(emptyWorkspaceActivityProjection(), {
      type: "fault",
      repoPath,
      message: "stream closed",
      operation: "list",
    });
    expect(faulted.unavailableReason).toBe("stream closed (during list)");

    const gapped = apply(faulted, {
      type: "transcript_gap",
      repoPath,
      message: "events were dropped",
    });
    expect(gapped.unavailableReason).toBe("events were dropped");

    expect(apply(gapped, sessionSnapshot([])).unavailableReason).toBeNull();
  });

  test("returns the same reference when an envelope changes no badge input", () => {
    const projection = apply(emptyWorkspaceActivityProjection(), sessionSnapshot([snapshot("a")]));

    expect(
      applyWorkspaceActivityEnvelope(projection, {
        type: "runtime_changed",
        scope: { repoPath, runtimeKind },
        state: "ready",
      }),
    ).toBe(projection);
    expect(
      applyWorkspaceActivityEnvelope(projection, {
        type: "session_removed",
        ref: { repoPath, runtimeKind, workingDirectory, externalSessionId: "missing" },
      }),
    ).toBe(projection);
  });
});
