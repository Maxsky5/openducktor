import { describe, expect, test } from "bun:test";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  projectPendingInputRoute,
  projectRuntimeChildPendingInputToSession,
} from "./pending-input-projection";

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

    const projection = projectRuntimeChildPendingInputToSession({
      session: parentSession,
      runtimeSnapshots: new Map([[agentSessionIdentityKey(childSnapshot.ref), childSnapshot]]),
      materializedSessionKeys: new Set([agentSessionIdentityKey(parentSession)]),
    });

    expect(projection.hasProjectedChildPendingInput).toBe(true);
    expect(projection.session.pendingQuestions).toEqual([childQuestion]);
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

    const projection = projectRuntimeChildPendingInputToSession({
      session: parentSession,
      runtimeSnapshots: new Map([[agentSessionIdentityKey(childSnapshot.ref), childSnapshot]]),
      materializedSessionKeys: new Set([
        agentSessionIdentityKey(parentSession),
        agentSessionIdentityKey(childSnapshot.ref),
      ]),
    });

    expect(projection.hasProjectedChildPendingInput).toBe(false);
    expect(projection.session).toBe(parentSession);
  });

  test("routes live linked child input to the child while replying through the observed parent", () => {
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

    const route = projectPendingInputRoute({
      observedSession: parentSession,
      parentExternalSessionId: parentSession.externalSessionId,
      childExternalSessionId: childSession.externalSessionId,
      readSession: () => childSession,
      isSessionObserved: () => false,
    });

    expect(route).toEqual({
      shouldPatchParentLink: true,
      pendingSession: childSession,
      approvalReplySession: parentSession,
    });
  });
});
