import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  emptyAgentSessionCollection,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { applyAgentSessionLiveDelta } from "@/state/operations/agent-orchestrator/session-read-model/agent-session-live-projection";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
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
  pendingAsyncQuestions: [],
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

describe("shared snapshot activity policy", () => {
  const cases = [
    { name: "stale idle", overrides: {}, terminalPreserved: true },
    {
      name: "omitted episode",
      overrides: { executionEpisodeId: undefined },
      terminalPreserved: true,
    },
    {
      name: "new episode",
      overrides: { executionEpisodeId: "episode-2" },
      terminalPreserved: false,
    },
    {
      name: "pending approval",
      overrides: {
        pendingApprovals: [{ requestId: "a", requestType: "runtime_tool", title: "Allow tool" }],
      },
      terminalPreserved: false,
    },
    {
      name: "pending question",
      overrides: { pendingQuestions: [{ requestId: "q", questions: [] }] },
      terminalPreserved: false,
    },
  ] satisfies {
    name: string;
    overrides: Partial<AgentSessionLiveSnapshot>;
    terminalPreserved: boolean;
  }[];

  for (const status of ["error", "stopped"] as const) {
    test.each(cases)(`applies $name to ${status} in both projections`, (scenario) => {
      const current = createAgentSessionFixture({
        externalSessionId: "a",
        runtimeKind,
        workingDirectory,
        sessionAssociation: { kind: "repository" },
        status,
        executionEpisodeId: "episode-1",
        runtimeStatusMessage: "Previous runtime message",
      });
      const incoming = snapshot("a", {
        repositoryScope: { kind: "repository" },
        executionEpisodeId: "episode-1",
        ...scenario.overrides,
      });
      const envelope = { type: "session_upsert", session: incoming } as const;
      const studio = getAgentSession(
        applyAgentSessionLiveDelta({
          current: replaceAgentSession(emptyAgentSessionCollection(), current),
          envelope,
        }),
        current,
      );
      const railCurrent: WorkspaceActivityProjection = {
        ...emptyWorkspaceActivityProjection(),
        sessions: new Map([
          [
            key("a"),
            {
              key: key("a"),
              parentKey: null,
              status,
              executionEpisodeId: current.executionEpisodeId,
              runtimeStatusMessage: current.runtimeStatusMessage,
              stopRequestedAt: null,
              pendingApprovals: [],
              pendingQuestions: [],
            },
          ],
        ]),
      };
      const expected = {
        status: scenario.terminalPreserved ? status : "idle",
        executionEpisodeId: incoming.executionEpisodeId ?? "episode-1",
        runtimeStatusMessage: scenario.terminalPreserved ? "Previous runtime message" : null,
        pendingUserMessageStartedAt: undefined,
        pendingApprovals: incoming.pendingApprovals,
        pendingQuestions: incoming.pendingQuestions,
      };

      expect(studio).toMatchObject(expected);
      expect(apply(railCurrent, envelope).sessions.get(key("a"))).toMatchObject(expected);
      expect(apply(railCurrent, sessionSnapshot([incoming])).sessions.get(key("a"))).toMatchObject(
        expected,
      );
    });
  }

  test.each(["session_finished", "session_error"] as const)(
    "keeps local stop intent distinct from rail observation for %s",
    (type) => {
      const incoming = snapshot("a", {
        activity: "running",
        repositoryScope: { kind: "repository" },
      });
      const current = createAgentSessionFixture({
        externalSessionId: "a",
        runtimeKind,
        workingDirectory,
        sessionAssociation: { kind: "repository" },
        status: "running",
        stopRequestedAt: "2026-09-15T08:01:00.000Z",
      });
      const envelope = {
        type: "transcript_event",
        event: {
          type,
          externalSessionId: "a",
          sessionRef: incoming.ref,
          timestamp: "2026-09-15T08:01:01.000Z",
          message: "The operation was aborted",
        },
      } as const;
      const studio = getAgentSession(
        applyAgentSessionLiveDelta({
          current: replaceAgentSession(emptyAgentSessionCollection(), current),
          envelope,
        }),
        current,
      );
      const rail = apply(
        emptyWorkspaceActivityProjection(),
        sessionSnapshot([incoming]),
        envelope,
        { type: "session_upsert", session: { ...incoming, activity: "idle" } },
      ).sessions.get(key("a"));

      expect(studio?.status).toBe("stopped");
      expect(rail?.status).toBe(type === "session_error" ? "error" : "idle");
      expect(rail?.stopRequestedAt).toBeNull();
    },
  );
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

  test("clears a tile that transcript activity marked active when the session settles", () => {
    const ref = { repoPath, runtimeKind, workingDirectory, externalSessionId: "a" };
    const active = apply(emptyWorkspaceActivityProjection(), sessionSnapshot([snapshot("a")]), {
      type: "transcript_event",
      event: {
        type: "assistant_delta",
        channel: "text",
        messageId: "message-1",
        delta: "Background review complete.",
        externalSessionId: "a",
        sessionRef: ref,
        timestamp: "2026-09-15T08:01:00.000Z",
      },
    });
    expect(badges(active)).toEqual({ inputRequired: false, error: false, active: true });

    const settled = apply(active, {
      type: "transcript_event",
      event: {
        type: "session_idle",
        externalSessionId: "a",
        sessionRef: ref,
        timestamp: "2026-09-15T08:01:01.000Z",
      },
    });
    expect(badges(settled)).toEqual({ inputRequired: false, error: false, active: false });
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
