import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionRuntimeTarget } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import {
  applyAgentSessionLiveDelta,
  buildAgentSessionLiveCollection,
} from "./agent-session-live-projection";

const repoPath = "/repo";
const workingDirectory = "/repo/worktree";
const workflowAssociation = { kind: "workflow", taskId: "task-1", role: "build" } as const;

const snapshot = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath,
    runtimeKind: "codex",
    workingDirectory,
    externalSessionId,
  },
  sessionAssociation: { kind: "unbound" },
  activity: "idle",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-07-16T08:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const identity = (
  externalSessionId: string,
  overrides: Partial<AgentSessionIdentity> = {},
): AgentSessionIdentity => ({
  runtimeKind: "codex",
  workingDirectory,
  externalSessionId,
  ...overrides,
});

const target = (externalSessionId: string): AgentSessionRuntimeTarget => ({
  ...identity(externalSessionId),
  sessionAssociation: { kind: "unbound" },
});

const build = ({
  current = emptyAgentSessionCollection(),
  snapshots,
}: {
  current?: AgentSessionCollection;
  snapshots: AgentSessionLiveSnapshot[];
}) => buildAgentSessionLiveCollection({ current, snapshots });

const delta = (current: AgentSessionCollection, envelope: AgentSessionLiveEnvelope) =>
  applyAgentSessionLiveDelta({ current, envelope: envelope as never });

describe("agent session live projection", () => {
  test("carries workflow, repository, and unbound associations from one mixed snapshot", () => {
    const sessions = build({
      snapshots: [
        snapshot("workflow-thread", { sessionAssociation: workflowAssociation }),
        snapshot("repository-thread", { sessionAssociation: { kind: "repository" } }),
        snapshot("unbound-thread"),
      ],
    });

    expect(getAgentSession(sessions, identity("workflow-thread"))?.sessionAssociation).toEqual(
      workflowAssociation,
    );
    expect(getAgentSession(sessions, identity("repository-thread"))?.sessionAssociation).toEqual({
      kind: "repository",
    });
    expect(getAgentSession(sessions, identity("unbound-thread"))?.sessionAssociation).toEqual({
      kind: "unbound",
    });
  });

  test.each(["opencode", "codex", "claude"] as const)(
    "applies the same association rules for live %s fixtures",
    (runtimeKind) => {
      const runtimeSnapshot = (
        externalSessionId: string,
        association: AgentSessionLiveSnapshot["sessionAssociation"],
      ): AgentSessionLiveSnapshot =>
        snapshot(externalSessionId, {
          ref: { repoPath, runtimeKind, workingDirectory, externalSessionId },
          sessionAssociation: association,
        });
      const sessions = build({
        snapshots: [
          runtimeSnapshot(`${runtimeKind}-wf`, workflowAssociation),
          runtimeSnapshot(`${runtimeKind}-repo`, { kind: "repository" }),
          runtimeSnapshot(`${runtimeKind}-unbound`, { kind: "unbound" }),
        ],
      });

      expect(
        getAgentSession(sessions, identity(`${runtimeKind}-wf`, { runtimeKind })),
      ).toMatchObject({ sessionAssociation: workflowAssociation });
      expect(
        getAgentSession(sessions, identity(`${runtimeKind}-repo`, { runtimeKind })),
      ).toMatchObject({ sessionAssociation: { kind: "repository" } });
      expect(
        getAgentSession(sessions, identity(`${runtimeKind}-unbound`, { runtimeKind })),
      ).toMatchObject({ sessionAssociation: { kind: "unbound" } });
    },
  );

  test("retains a workflow association when a reconnect snapshot is unbound", () => {
    const initial = build({
      snapshots: [snapshot("thread-1", { sessionAssociation: workflowAssociation })],
    });
    const next = build({ current: initial, snapshots: [snapshot("thread-1")] });

    expect(getAgentSession(next, identity("thread-1"))?.sessionAssociation).toEqual(
      workflowAssociation,
    );
  });

  test("rejects a conflicting live scope change", () => {
    const initial = build({
      snapshots: [snapshot("thread-1", { sessionAssociation: workflowAssociation })],
    });

    expect(() =>
      delta(initial, {
        type: "session_upsert",
        session: snapshot("thread-1", { sessionAssociation: { kind: "repository" } }),
      }),
    ).toThrow(
      "Cannot apply live snapshot for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the incoming repository scope.",
    );
  });

  test("allows an unbound-to-repository scope change", () => {
    const initial = build({ snapshots: [snapshot("thread-1")] });
    const next = delta(initial, {
      type: "session_upsert",
      session: snapshot("thread-1", { sessionAssociation: { kind: "repository" } }),
    });

    expect(getAgentSession(next, identity("thread-1"))?.sessionAssociation).toEqual({
      kind: "repository",
    });
  });

  test("commits an atomic initial snapshot with activity, pending input, and retained context", () => {
    const waitingApproval = {
      requestId: "opaque-1",
      requestType: "command_execution" as const,
      title: "Run command",
    };
    const sessions = build({
      snapshots: [
        snapshot("thread-1", {
          activity: "waiting_for_permission",
          pendingApprovals: [waitingApproval],
          contextUsage: { totalTokens: 1200, contextWindow: 200_000 },
        }),
        snapshot("thread-2", {
          activity: "waiting_for_permission",
          pendingApprovals: [{ ...waitingApproval, requestId: "opaque-2" }],
        }),
        snapshot("thread-3", {
          activity: "waiting_for_permission",
          pendingApprovals: [{ ...waitingApproval, requestId: "opaque-3" }],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("thread-1"))).toEqual(
      expect.objectContaining({
        status: "idle",
        contextUsage: { totalTokens: 1200, contextWindow: 200_000 },
        pendingApprovals: [expect.objectContaining({ requestId: "opaque-1" })],
      }),
    );
    expect(getAgentSession(sessions, identity("thread-2"))?.pendingApprovals).toHaveLength(1);
    expect(getAgentSession(sessions, identity("thread-3"))?.pendingApprovals).toHaveLength(1);
  });

  test("applies ordered upserts without duplicating or resurrecting pending requests", () => {
    const initial = build({
      snapshots: [
        snapshot("thread-1", {
          pendingApprovals: [
            {
              requestId: "opaque-1",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
      ],
    });
    const resolved = {
      type: "session_upsert",
      session: snapshot("thread-1", { pendingApprovals: [] }),
    } satisfies AgentSessionLiveEnvelope;

    const afterResolution = delta(initial, resolved);
    const afterDuplicateResolution = delta(afterResolution, resolved);

    expect(getAgentSession(afterResolution, identity("thread-1"))?.pendingApprovals).toEqual([]);
    expect(
      getAgentSession(afterDuplicateResolution, identity("thread-1"))?.pendingApprovals,
    ).toEqual([]);
  });

  test("treats a reconnect snapshot as authoritative when an unbound child disappeared", () => {
    const previous = build({
      snapshots: [
        snapshot("parent-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", {
          parentExternalSessionId: "parent-thread",
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "child-opaque-1",
              requestType: "command_execution",
              title: "Run child command",
            },
          ],
        }),
      ],
    });
    expect(getAgentSession(previous, identity("parent-thread"))?.pendingApprovals).toHaveLength(1);
    expect(getAgentSession(previous, identity("child-thread"))).not.toBeNull();

    const reconnected = build({
      current: previous,
      snapshots: [snapshot("parent-thread", { sessionAssociation: workflowAssociation })],
    });

    expect(getAgentSession(reconnected, identity("parent-thread"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(reconnected, identity("child-thread"))).toBeNull();
  });

  test("retains starting and workflow projections without live evidence while dropping other absent sessions", () => {
    const initial = build({
      snapshots: [
        snapshot("starting-thread"),
        snapshot("workflow-thread", { sessionAssociation: workflowAssociation }),
        snapshot("repository-thread", { sessionAssociation: { kind: "repository" } }),
        snapshot("unbound-thread"),
      ],
    });
    const starting = getAgentSession(initial, identity("starting-thread"));
    if (!starting) {
      throw new Error("Expected starting session.");
    }
    const markedStarting = replaceAgentSession(initial, { ...starting, status: "starting" });

    const reconnectedWithoutSessions = build({ current: markedStarting, snapshots: [] });

    const retainedIds = new Set(
      listAgentSessions(reconnectedWithoutSessions).map((session) => session.externalSessionId),
    );
    expect(retainedIds.has("workflow-thread")).toBe(true);
    expect(retainedIds.has("starting-thread")).toBe(true);
    expect(retainedIds.has("repository-thread")).toBe(false);
    expect(retainedIds.has("unbound-thread")).toBe(false);
  });

  test("commits live reportage with the same projection that applies runtime evidence", () => {
    const initial = build({
      snapshots: [
        snapshot("live-thread", { sessionAssociation: workflowAssociation }),
        snapshot("absent-later-thread"),
      ],
    });
    expect(getAgentSession(initial, identity("live-thread"))?.liveReported).toBe(true);

    // A reconnect snapshot without the workflow session clears its reportage
    // in the same commit that settles it.
    const reconnectedWithoutIt = build({ current: initial, snapshots: [] });
    expect(getAgentSession(reconnectedWithoutIt, identity("live-thread"))?.liveReported).toBe(
      false,
    );

    // A later upsert restores reportage; an explicit removal clears it again.
    const upserted = delta(reconnectedWithoutIt, {
      type: "session_upsert",
      session: snapshot("live-thread", { sessionAssociation: workflowAssociation }),
    });
    expect(getAgentSession(upserted, identity("live-thread"))?.liveReported).toBe(true);
    const removed = delta(upserted, {
      type: "session_removed",
      ref: snapshot("live-thread").ref,
    });
    expect(getAgentSession(removed, identity("live-thread"))?.liveReported).toBe(false);
  });

  test("preserves a live child's loaded transcript across an authoritative snapshot refresh", () => {
    const initial = build({
      snapshots: [
        snapshot("parent-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", { parentExternalSessionId: "parent-thread" }),
      ],
    });
    const child = getAgentSession(initial, identity("child-thread"));
    if (!child) {
      throw new Error("Expected live child session.");
    }
    const withLoadedChild = replaceAgentSession(initial, {
      ...child,
      historyLoadState: "loaded",
      messages: createSessionMessagesState("child-thread", [
        {
          id: "assistant-child-1",
          role: "assistant",
          content: "Still visible after reconnect",
          timestamp: "2026-07-16T08:00:01.000Z",
        },
      ]),
    });

    const refreshed = build({
      current: withLoadedChild,
      snapshots: [
        snapshot("parent-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", { parentExternalSessionId: "parent-thread" }),
      ],
    });

    expect(getAgentSession(refreshed, identity("child-thread"))).toMatchObject({
      historyLoadState: "loaded",
      messages: {
        items: [expect.objectContaining({ content: "Still visible after reconnect" })],
      },
    });
  });

  test("settles a removed live child without dropping its transcript", () => {
    const initial = build({
      snapshots: [
        snapshot("parent-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", {
          parentExternalSessionId: "parent-thread",
          activity: "running",
        }),
      ],
    });
    const child = getAgentSession(initial, identity("child-thread"));
    if (!child) {
      throw new Error("Expected live child session.");
    }
    const withChildTranscript = replaceAgentSession(initial, {
      ...child,
      historyLoadState: "loaded",
      messages: createSessionMessagesState("child-thread", [
        {
          id: "tool:assistant-child-1:read-1",
          role: "tool",
          content: "Tool Read completed",
          timestamp: "2026-07-16T08:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "read-1",
            callId: "read-1",
            tool: "Read",
            toolType: "read",
            status: "completed",
            startedAtMs: 100,
            endedAtMs: 160,
          },
        },
      ]),
    });

    const removed = delta(withChildTranscript, {
      type: "session_removed",
      ref: snapshot("child-thread").ref,
    });

    expect(getAgentSession(removed, identity("child-thread"))).toMatchObject({
      status: "idle",
      liveParentExternalSessionId: undefined,
      historyLoadState: "loaded",
      messages: {
        items: [
          expect.objectContaining({
            id: "tool:assistant-child-1:read-1",
            meta: expect.objectContaining({ startedAtMs: 100, endedAtMs: 160 }),
          }),
        ],
      },
    });
  });

  test("mirrors a grandchild mutating approval to a read-only root with the grandchild response session", () => {
    const sessions = build({
      snapshots: [
        snapshot("root-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        }),
        snapshot("child-thread", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "grandchild-approval",
              requestType: "command_execution",
              title: "Write file",
              mutation: "mutating",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({
        requestId: "grandchild-approval",
        source: {
          kind: "subagent",
          parentExternalSessionId: "root-thread",
          childExternalSessionId: "grandchild-thread",
        },
        responseSession: target("grandchild-thread"),
      }),
    ]);
  });

  test("mirrors a grandchild question to the root with the grandchild response session", () => {
    const sessions = build({
      snapshots: [
        snapshot("root-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
          activity: "waiting_for_question",
          pendingQuestions: [
            {
              requestId: "grandchild-question",
              questions: [
                {
                  header: "Continue?",
                  question: "Should the grandchild continue?",
                  options: [{ label: "Yes", description: "Continue." }],
                },
              ],
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("root-thread"))?.pendingQuestions).toEqual([
      expect.objectContaining({
        requestId: "grandchild-question",
        responseSession: target("grandchild-thread"),
      }),
    ]);
  });

  test("clears descendant mirrors from every ancestor after grandchild resolution and removal", () => {
    const grandchildPendingInput = {
      pendingApprovals: [
        {
          requestId: "grandchild-approval",
          requestType: "command_execution" as const,
          title: "Write file",
        },
      ],
      pendingQuestions: [
        {
          requestId: "grandchild-question",
          questions: [
            {
              header: "Continue?",
              question: "Should the grandchild continue?",
              options: [{ label: "Yes", description: "Continue." }],
            },
          ],
        },
      ],
    };
    const initial = build({
      snapshots: [
        snapshot("root-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
          ...grandchildPendingInput,
        }),
      ],
    });
    const resolved = delta(initial, {
      type: "session_upsert",
      session: snapshot("grandchild-thread", {
        parentExternalSessionId: "child-thread",
      }),
    });

    expect(getAgentSession(resolved, identity("root-thread"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(resolved, identity("child-thread"))?.pendingQuestions).toEqual([]);

    const removed = delta(initial, {
      type: "session_removed",
      ref: snapshot("grandchild-thread").ref,
    });
    expect(getAgentSession(removed, identity("root-thread"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(removed, identity("child-thread"))?.pendingQuestions).toEqual([]);
  });

  test("keeps sibling descendant pending requests isolated", () => {
    const sessions = build({
      snapshots: [
        snapshot("root-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-a", { parentExternalSessionId: "root-thread" }),
        snapshot("child-b", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-a", {
          parentExternalSessionId: "child-a",
          pendingApprovals: [
            {
              requestId: "sibling-request",
              requestType: "command_execution",
              title: "Child A command",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("child-a"))?.pendingApprovals).toHaveLength(1);
    expect(getAgentSession(sessions, identity("child-b"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(sessions, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({ responseSession: target("grandchild-a") }),
    ]);
  });

  test("retains one-hop pending input projection", () => {
    const sessions = build({
      snapshots: [
        snapshot("root-thread", { sessionAssociation: workflowAssociation }),
        snapshot("child-thread", {
          parentExternalSessionId: "root-thread",
          pendingApprovals: [
            {
              requestId: "child-approval",
              requestType: "command_execution",
              title: "Child command",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({
        requestId: "child-approval",
        responseSession: target("child-thread"),
      }),
    ]);
  });

  test("keeps overlapping request ids isolated by normalized session identity", () => {
    const approval = {
      requestId: "opaque-overlap",
      requestType: "command_execution" as const,
      title: "Run command",
    };
    const initial = build({
      snapshots: [
        snapshot("thread-1", { pendingApprovals: [approval] }),
        snapshot("thread-2", { pendingApprovals: [approval] }),
      ],
    });

    const next = delta(initial, {
      type: "session_upsert",
      session: snapshot("thread-1", { pendingApprovals: [] }),
    });

    expect(getAgentSession(next, identity("thread-1"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(next, identity("thread-2"))?.pendingApprovals).toEqual([approval]);
  });

  test("applies authoritative lifecycle status from a live upsert after reload", () => {
    const initial = build({
      snapshots: [snapshot("thread-1", { sessionAssociation: workflowAssociation })],
    });
    const current = getAgentSession(initial, identity("thread-1"));
    if (!current) {
      throw new Error("Expected projected session.");
    }
    const transcriptMarkedRunning = replaceAgentSession(initial, {
      ...current,
      status: "running",
    });

    const afterIdleSnapshot = delta(transcriptMarkedRunning, {
      type: "session_upsert",
      session: snapshot("thread-1", { activity: "idle" }),
    });

    expect(getAgentSession(afterIdleSnapshot, identity("thread-1"))?.status).toBe("idle");
  });

  test("keeps an accepted OpenCode send only while the live session is still present", () => {
    const opencodeRef = {
      repoPath,
      runtimeKind: "opencode" as const,
      workingDirectory,
      externalSessionId: "thread-1",
    };
    const loaded = build({
      snapshots: [
        snapshot("thread-1", { ref: opencodeRef, sessionAssociation: workflowAssociation }),
      ],
    });
    const current = getAgentSession(loaded, identity("thread-1", { runtimeKind: "opencode" }));
    if (!current) {
      throw new Error("Expected projected OpenCode session.");
    }
    const afterAcceptedSend = replaceAgentSession(loaded, {
      ...current,
      status: "running",
      pendingUserMessageStartedAt: Date.parse("2026-07-16T08:00:01.000Z"),
    });
    const staleIdleSnapshot = snapshot("thread-1", {
      ref: opencodeRef,
      sessionAssociation: workflowAssociation,
    });

    const afterIdleDelta = delta(afterAcceptedSend, {
      type: "session_upsert",
      session: staleIdleSnapshot,
    });
    const afterIdleReconnect = build({
      current: afterAcceptedSend,
      snapshots: [staleIdleSnapshot],
    });
    const afterAbsentReconnect = build({ current: afterAcceptedSend, snapshots: [] });
    const afterLiveRemoval = delta(afterAcceptedSend, {
      type: "session_removed",
      ref: staleIdleSnapshot.ref,
    });

    const expectedSendState = {
      status: "running",
      pendingUserMessageStartedAt: Date.parse("2026-07-16T08:00:01.000Z"),
    };
    expect(
      getAgentSession(afterIdleDelta, identity("thread-1", { runtimeKind: "opencode" })),
    ).toMatchObject(expectedSendState);
    expect(
      getAgentSession(afterIdleReconnect, identity("thread-1", { runtimeKind: "opencode" })),
    ).toMatchObject(expectedSendState);
    expect(
      getAgentSession(afterAbsentReconnect, identity("thread-1", { runtimeKind: "opencode" })),
    ).toMatchObject({
      status: "idle",
      pendingUserMessageStartedAt: undefined,
    });
    expect(
      getAgentSession(afterLiveRemoval, identity("thread-1", { runtimeKind: "opencode" })),
    ).toMatchObject({
      status: "idle",
      pendingUserMessageStartedAt: undefined,
    });
  });

  test.each(["stopped", "error"] as const)(
    "does not resurrect a session after terminal %s activity",
    (terminalStatus) => {
      const loaded = build({
        snapshots: [snapshot("thread-1", { sessionAssociation: workflowAssociation })],
      });
      const removed = delta(loaded, {
        type: "session_removed",
        ref: snapshot("thread-1").ref,
      });
      const current = getAgentSession(removed, identity("thread-1"));
      if (!current) {
        throw new Error("Expected projected session.");
      }
      const terminal = replaceAgentSession(removed, { ...current, status: terminalStatus });

      const afterIdle = delta(terminal, {
        type: "session_upsert",
        session: snapshot("thread-1", {
          activity: "idle",
          pendingApprovals: [
            {
              requestId: "stale-approval",
              requestType: "command_execution",
              title: "Stale approval",
            },
          ],
        }),
      });

      expect(getAgentSession(afterIdle, identity("thread-1"))).toEqual(
        expect.objectContaining({
          status: terminalStatus,
          pendingApprovals: [],
          pendingQuestions: [],
        }),
      );
    },
  );

  test("keeps Claude parent and subagent associations exact across projection", () => {
    const claudeIdentity = { runtimeKind: "claude" as const };
    const parentRef = {
      repoPath,
      workingDirectory,
      externalSessionId: "claude-parent",
      ...claudeIdentity,
    };
    const sessions = build({
      snapshots: [
        snapshot(parentRef.externalSessionId, {
          ref: parentRef,
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
        snapshot("claude-subagent", {
          ref: {
            repoPath,
            workingDirectory,
            externalSessionId: "claude-subagent",
            ...claudeIdentity,
          },
          parentExternalSessionId: "claude-parent",
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "subagent-approval",
              requestType: "command_execution",
              title: "Subagent command",
            },
          ],
          pendingQuestions: [
            {
              requestId: "subagent-question",
              questions: [
                {
                  header: "Proceed?",
                  question: "Should the subagent proceed?",
                  options: [{ label: "Yes", description: "Proceed." }],
                },
              ],
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("claude-parent", claudeIdentity))).toMatchObject({
      sessionAssociation: workflowAssociation,
    });
    expect(getAgentSession(sessions, identity("claude-subagent", claudeIdentity))).toMatchObject({
      liveParentExternalSessionId: "claude-parent",
      pendingApprovals: [expect.objectContaining({ requestId: "subagent-approval" })],
      pendingQuestions: [expect.objectContaining({ requestId: "subagent-question" })],
    });
    expect(
      getAgentSession(sessions, identity("claude-parent", claudeIdentity))?.pendingApprovals,
    ).toEqual([
      expect.objectContaining({
        requestId: "subagent-approval",
        responseSession: {
          ...identity("claude-subagent", claudeIdentity),
          sessionAssociation: { kind: "unbound" },
        },
      }),
    ]);
    expect(
      getAgentSession(sessions, identity("claude-parent", claudeIdentity))?.pendingQuestions,
    ).toEqual([
      expect.objectContaining({
        requestId: "subagent-question",
      }),
    ]);
  });
});
