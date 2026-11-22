import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "../test-support/shared-test-fixtures";
import { createAgentSessionsStore } from "./agent-sessions-store";

test("keeps a staged task destination visible in chat while navigation uses the saved source", () => {
  const store = createAgentSessionsStore("/repo");
  const first = {
    externalSessionId: "source",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
  } as const;
  const to = { ...first, externalSessionId: "dest", runtimeKind: "codex" } as const;
  const scope = { workspaceId: "workspace", taskId: "task", role: "build" } as const;
  store.replaceSession(
    createAgentSessionFixture({
      ...first,
      sessionAssociation: { kind: "workflow", ...scope },
    }),
  );
  store.applyLiveSessionEnvelope({
    type: "session_upsert",
    session: {
      ref: { ...to, repoPath: "/repo" },
      title: "Builder",
      activity: "idle",
      startedAt: "2026-01-01T00:00:00Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    },
  });
  store.setSessionCollection((current) => current);
  expect(store.getSessionSnapshot(to)).toBeNull();
  store.applyLiveSessionEnvelope({
    type: "session_operation_updated",
    observation: {
      kind: "handoff",
      ref: { ...first, repoPath: "/repo" },
      submissionId: "handoff",
      pending: false,
      nativeOutcome: "accepted",
      handoff: {
        chat: { ...scope, kind: "task_session", repoPath: "/repo", first },
        destination: { runtimeKind: "codex", providerId: "openai", modelId: "model" },
        expectedActive: first,
        acceptedLink: { from: first, to, firstMessageId: "dest-message", partialHistory: false },
      },
    },
  });
  store.setSessionCollection((current) => current);
  expect(store.getSessionSnapshot(to)?.sessionAssociation).toEqual({ kind: "workflow", ...scope });
  expect(store.getHandoffOperation(to)?.submissionId).toBe("handoff");
  expect(
    store.getActivitySnapshot().sessions.map(({ externalSessionId }) => externalSessionId),
  ).toEqual([first.externalSessionId]);
  store.applyLiveSessionEnvelope({
    type: "snapshot",
    isConnectionSnapshot: true,
    repoPath: "/repo",
    sessions: [],
    messageQueues: [],
  });
  store.setSessionCollection((current) => current);
  expect(store.getSessionSnapshot(to)).toBeNull();
});

const sessionWithApproval = (externalSessionId: string) =>
  createAgentSessionFixture({
    externalSessionId,
    pendingApprovals: [
      {
        requestId: `${externalSessionId}-approval`,
        requestType: "runtime_tool",
        title: "Allow tool",
      },
    ],
  });

const identityOf = (session: ReturnType<typeof createAgentSessionFixture>) => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
});

const createSubagentApprovalFixture = ({
  childExternalSessionId,
  parentExternalSessionId,
}: {
  childExternalSessionId: string;
  parentExternalSessionId: string;
}) => ({
  requestId: "approval-1",
  requestType: "permission_grant" as const,
  title: "Approve permission: read",
  summary: "Approval request for read.",
  action: { name: "read" },
  mutation: "read_only" as const,
  supportedReplyOutcomes: ["approve_once" as const, "reject" as const],
  source: {
    kind: "subagent" as const,
    parentExternalSessionId,
    childExternalSessionId,
  },
});

describe("agent sessions store visible pending input", () => {
  test("returns parent-mirrored subagent pending input for the child session identity", () => {
    const childSession = createAgentSessionFixture({
      externalSessionId: "child-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const mirroredApproval = {
      ...createSubagentApprovalFixture({
        childExternalSessionId: "child-session",
        parentExternalSessionId: "parent-session",
      }),
      responseSession: childSession,
    };
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [mirroredApproval],
      pendingQuestions: [],
    });
    const store = createAgentSessionsStore("/repo-a");
    store.replaceSession(parentSession);

    expect(store.getVisiblePendingInputSnapshot(identityOf(childSession))).toEqual({
      pendingApprovals: [mirroredApproval],
      pendingQuestions: [],
    });
  });

  test("keeps child-owned pending input authoritative when the parent also mirrors it", () => {
    const childApproval = createSubagentApprovalFixture({
      childExternalSessionId: "child-session",
      parentExternalSessionId: "parent-session",
    });
    const childApprovalInstance = {
      ...childApproval,
      requestInstanceId: "runtime-b\u0000approval-1",
    };
    const childSession = createAgentSessionFixture({
      externalSessionId: "child-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [childApprovalInstance],
      pendingQuestions: [],
    });
    const parentSession = createAgentSessionFixture({
      externalSessionId: "parent-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      pendingApprovals: [
        {
          ...childApproval,
          requestInstanceId: "runtime-a\u0000approval-1",
          responseSession: childSession,
        },
      ],
      pendingQuestions: [],
    });
    const store = createAgentSessionsStore("/repo-a");
    store.replaceSession(parentSession);
    store.replaceSession(childSession);

    expect(store.getVisiblePendingInputSnapshot(identityOf(childSession)).pendingApprovals).toEqual(
      [childApprovalInstance],
    );
  });

  test("keeps one stable snapshot for each session while views of two sessions read in turn", () => {
    const store = createAgentSessionsStore("/repo");
    const first = sessionWithApproval("first");
    const second = sessionWithApproval("second");
    store.replaceSession(first);
    store.replaceSession(second);

    const firstSnapshot = store.getVisiblePendingInputSnapshot(identityOf(first));
    const secondSnapshot = store.getVisiblePendingInputSnapshot(identityOf(second));

    expect(store.getVisiblePendingInputSnapshot(identityOf(first))).toBe(firstSnapshot);
    expect(store.getVisiblePendingInputSnapshot(identityOf(second))).toBe(secondSnapshot);
    expect(firstSnapshot.pendingApprovals.map((request) => request.requestId)).toEqual([
      "first-approval",
    ]);
  });

  test("reads the pending input again after the session collection changes", () => {
    const store = createAgentSessionsStore("/repo");
    const session = sessionWithApproval("first");
    store.replaceSession(session);
    const before = store.getVisiblePendingInputSnapshot(identityOf(session));

    store.replaceSession({ ...session, pendingApprovals: [] });

    const after = store.getVisiblePendingInputSnapshot(identityOf(session));
    expect(after).not.toBe(before);
    expect(after.pendingApprovals).toEqual([]);
  });
});

describe("agent sessions store usage-limit auto-resume", () => {
  test("projects the host entry of a session, and a snapshot replaces every entry", () => {
    const store = createAgentSessionsStore("/repo");
    const session = createAgentSessionFixture({ externalSessionId: "limited" });
    store.replaceSession(session);
    const ref = { repoPath: "/repo", ...identityOf(session) };
    const entry = {
      ref,
      stopId: "limit-1",
      resumeAtEpochMs: 1_800_000_000_000,
      state: "scheduled" as const,
    };

    store.applyLiveSessionEnvelope({
      type: "usage_limit_auto_resume_updated",
      ref,
      autoResume: entry,
    });
    store.setSessionCollection((current) => current);
    expect(store.getSessionSnapshot(identityOf(session))?.usageLimitAutoResume).toEqual(entry);

    store.applyLiveSessionEnvelope({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
      messageQueues: [],
      usageLimitAutoResumes: [],
    });
    store.setSessionCollection((current) => current);
    expect(store.getSessionSnapshot(identityOf(session))?.usageLimitAutoResume).toBeUndefined();

    store.applyLiveSessionEnvelope({
      type: "usage_limit_auto_resume_updated",
      ref: { ...ref, repoPath: "/other" },
      autoResume: { ...entry, ref: { ...ref, repoPath: "/other" } },
    });
    store.setSessionCollection((current) => current);
    expect(store.getSessionSnapshot(identityOf(session))?.usageLimitAutoResume).toBeUndefined();
  });
});
