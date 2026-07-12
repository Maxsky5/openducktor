import { describe, expect, test } from "bun:test";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  projectPendingInputRoute,
  projectRuntimeChildPendingInputToSession,
} from "./pending-input-projection";
import { runtimeChildSnapshotsForSession } from "./session-read-model/runtime-child-snapshots";

const createParentChildSessions = () => {
  const parentSession = createAgentSessionFixture({
    externalSessionId: "parent-session",
    runtimeKind: "opencode",
    workingDirectory: "/repo/worktree",
  });
  const childSession = createAgentSessionFixture({
    externalSessionId: "child-session",
    runtimeKind: "opencode",
    workingDirectory: "/repo/worktree",
  });
  return { parentSession, childSession };
};

const readSessions =
  (...sessions: ReturnType<typeof createAgentSessionFixture>[]) =>
  (externalSessionId: string) =>
    sessions.find((session) => session.externalSessionId === externalSessionId) ?? null;

const expectLinkedParentChildRoute = ({
  route,
  parentSession,
  childIdentity,
}: {
  route: ReturnType<typeof projectPendingInputRoute>;
  parentSession: ReturnType<typeof createAgentSessionFixture>;
  childIdentity: ReturnType<typeof toAgentSessionIdentity>;
}) => {
  const parentIdentity = toAgentSessionIdentity(parentSession);
  const source = {
    kind: "subagent" as const,
    parentExternalSessionId: parentSession.externalSessionId,
    childExternalSessionId: childIdentity.externalSessionId,
  };

  expect(route).toEqual({
    shouldPatchParentLink: true,
    targets: [
      {
        session: childIdentity,
        replySession: childIdentity,
        source,
      },
      {
        session: parentIdentity,
        replySession: childIdentity,
        source,
      },
    ],
  });
};

describe("pending input projection", () => {
  test("projects child runtime pending input onto an unmaterialized parent session", () => {
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const childQuestion = { requestId: "child-question", questions: [] };
    const childSnapshot = toAgentSessionRuntimeSnapshot({
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "child-session",
      },
      snapshot: {
        parentExternalSessionId: parentSession.externalSessionId,
        title: "Child",
        startedAt: "2026-06-11T08:00:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [childQuestion],
      },
    });

    const runtimeSnapshots = new Map([[agentSessionIdentityKey(childSnapshot.ref), childSnapshot]]);
    const materializedSessionKeys = new Set([agentSessionIdentityKey(parentSession)]);
    const projection = projectRuntimeChildPendingInputToSession({
      session: parentSession,
      runtimeChildSnapshots: runtimeChildSnapshotsForSession({
        session: parentSession,
        runtimeSnapshots,
        materializedSessionKeys,
      }),
    });

    expect(projection.hasProjectedChildPendingInput).toBe(true);
    expect(projection.session.pendingQuestions).toEqual([
      {
        ...childQuestion,
        responseSession: {
          externalSessionId: "child-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        source: {
          kind: "subagent",
          parentExternalSessionId: "parent-session",
          childExternalSessionId: "child-session",
        },
      },
    ]);
  });

  test("does not project child runtime pending input when the child session is materialized", () => {
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      pendingQuestions: [],
    });
    const childSnapshot = toAgentSessionRuntimeSnapshot({
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "child-session",
      },
      snapshot: {
        parentExternalSessionId: parentSession.externalSessionId,
        title: "Child",
        startedAt: "2026-06-11T08:00:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [{ requestId: "child-question", questions: [] }],
      },
    });

    const runtimeSnapshots = new Map([[agentSessionIdentityKey(childSnapshot.ref), childSnapshot]]);
    const materializedSessionKeys = new Set([
      agentSessionIdentityKey(parentSession),
      agentSessionIdentityKey(childSnapshot.ref),
    ]);
    const projection = projectRuntimeChildPendingInputToSession({
      session: parentSession,
      runtimeChildSnapshots: runtimeChildSnapshotsForSession({
        session: parentSession,
        runtimeSnapshots,
        materializedSessionKeys,
      }),
    });

    expect(projection.hasProjectedChildPendingInput).toBe(false);
    expect(projection.session).toBe(parentSession);
  });

  test("routes live linked child input to the child and parent surface", () => {
    const { parentSession, childSession } = createParentChildSessions();

    const route = projectPendingInputRoute({
      observedSession: parentSession,
      parentExternalSessionId: parentSession.externalSessionId,
      childExternalSessionId: childSession.externalSessionId,
      readSession: readSessions(parentSession, childSession),
    });

    expectLinkedParentChildRoute({
      route,
      parentSession,
      childIdentity: toAgentSessionIdentity(childSession),
    });
  });

  test("routes live linked child input to the child and parent surface when the child session is not materialized", () => {
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });

    const route = projectPendingInputRoute({
      observedSession: parentSession,
      parentExternalSessionId: parentSession.externalSessionId,
      childExternalSessionId: "child-session",
      readSession: () => null,
    });
    const parentIdentity = toAgentSessionIdentity(parentSession);
    const childIdentity = { ...parentIdentity, externalSessionId: "child-session" };

    expectLinkedParentChildRoute({ route, parentSession, childIdentity });
  });

  test("routes parent-observed linked input to both surfaces when the child is loaded", () => {
    const { parentSession, childSession } = createParentChildSessions();

    const route = projectPendingInputRoute({
      observedSession: parentSession,
      parentExternalSessionId: parentSession.externalSessionId,
      childExternalSessionId: childSession.externalSessionId,
      readSession: readSessions(parentSession, childSession),
    });

    expectLinkedParentChildRoute({
      route,
      parentSession,
      childIdentity: toAgentSessionIdentity(childSession),
    });
  });

  test("routes child-observed linked input to the child and loaded parent surface", () => {
    const { parentSession, childSession } = createParentChildSessions();

    const route = projectPendingInputRoute({
      observedSession: childSession,
      parentExternalSessionId: parentSession.externalSessionId,
      childExternalSessionId: childSession.externalSessionId,
      readSession: readSessions(parentSession, childSession),
    });

    expectLinkedParentChildRoute({
      route,
      parentSession,
      childIdentity: toAgentSessionIdentity(childSession),
    });
  });
});
