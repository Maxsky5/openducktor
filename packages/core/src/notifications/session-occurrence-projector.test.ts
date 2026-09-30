import { expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionRefKey } from "../services/agent-session-ref-key";
import { createSessionOccurrenceProjector } from "./session-occurrence-projector";
const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "root",
};
const question = {
  requestId: "question",
  blocking: false,
  questions: [{ header: "Next", question: "Continue?", options: [] }],
};
const snapshot = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref,
  activity: "running",
  executionEpisodeId: "episode",
  title: "Root",
  startedAt: "2026-09-01T00:00:00Z",
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  ...overrides,
});
test("baseline inputs stay silent while a first owned live input is eligible", () => {
  const make = () =>
    createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: () => ({ kind: "repository" }),
      resolveTask: () => null,
    });
  const current = snapshot({ pendingQuestions: [question] });
  const baseline = make();
  expect(baseline.accept({ type: "session_upsert", session: current }, "baseline")).toEqual([]);
  expect(baseline.accept({ type: "session_upsert", session: current })).toEqual([]);
  expect(make().accept({ type: "session_upsert", session: current })).toHaveLength(1);
});
test("unowned live inputs survive read refreshes until association reconciliation", () => {
  let owned = false;
  const projector = createSessionOccurrenceProjector({
    repositoryLabel: "Repo",
    resolveAssociation: () => (owned ? { kind: "repository" } : null),
    resolveTask: () => null,
  });
  const current = snapshot({ pendingQuestions: [question] });
  expect(projector.accept({ type: "session_upsert", session: current })).toEqual([]);
  expect(projector.accept({ type: "session_upsert", session: current }, "baseline")).toEqual([]);
  owned = true;
  expect(projector.reconcileAssociations()).toHaveLength(1);
  expect(projector.reconcileAssociations()).toEqual([]);
});
test("association removal cancels deferred descendant questions", () => {
  let owned = false;
  const projector = createSessionOccurrenceProjector({
    repositoryLabel: "Repo",
    resolveAssociation: (candidate) =>
      owned && candidate.externalSessionId === "root" ? { kind: "repository" } : null,
    resolveTask: () => null,
  });
  projector.accept({ type: "session_upsert", session: snapshot() }, "baseline");
  projector.accept({
    type: "session_upsert",
    session: snapshot({
      ref: { ...ref, externalSessionId: "child" },
      parentExternalSessionId: "root",
      pendingQuestions: [question],
    }),
  });
  projector.invalidateOwnership(agentSessionRefKey(ref));
  owned = true;
  expect(projector.reconcileAssociations()).toEqual([]);
});

test.each([false, true])(
  "keeps deferred child questions across snapshots and resets root alerts only on reconnect=%s",
  (isConnectionSnapshot) => {
    let owned = false;
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: (candidate) =>
        owned && candidate.externalSessionId === "root" ? { kind: "repository" } : null,
      resolveTask: () => null,
    });
    const root = snapshot({ pendingQuestions: [{ ...question, requestId: "root-question" }] });
    const child = snapshot({
      ref: { ...ref, externalSessionId: "child" },
      parentExternalSessionId: "root",
      pendingQuestions: [{ ...question, requestId: "child-question" }],
    });
    projector.accept({ type: "session_upsert", session: root });
    projector.accept({ type: "session_upsert", session: child });
    projector.accept({
      type: "transcript_event",
      event: {
        type: "session_error",
        sessionRef: ref,
        timestamp: "2026-09-01T00:01:00Z",
        message: "Session failed",
      },
    });
    expect(
      projector.accept({
        type: "snapshot",
        repoPath: ref.repoPath,
        sessions: [root, child],
        isConnectionSnapshot,
      }),
    ).toEqual([]);
    owned = true;
    const alerts = projector.reconcileAssociations();
    expect(alerts.map((alert) => alert.kind)).toEqual(
      isConnectionSnapshot
        ? ["agent.question_asked"]
        : ["agent.question_asked", "agent.session_error", "agent.question_asked"],
    );
    expect(alerts.at(-1)?.navigationTarget).toMatchObject({
      requestId: "child-question",
      session: { externalSessionId: "root" },
    });
    expect(projector.reconcileAssociations()).toEqual([]);
  },
);

test.each(["pending", "resolved", "removed"] as const)(
  "keeps a deferred child question across ancestor removal only while %s",
  (state) => {
    let owned = false;
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: (candidate) =>
        owned && candidate.externalSessionId === "root" ? { kind: "repository" } : null,
      resolveTask: () => null,
    });
    const child = snapshot({
      ref: { ...ref, externalSessionId: "child" },
      parentExternalSessionId: "root",
      pendingQuestions: [question],
    });
    projector.accept({ type: "session_upsert", session: snapshot() }, "baseline");
    expect(projector.accept({ type: "session_upsert", session: child })).toEqual([]);
    projector.accept({ type: "session_removed", ref });
    if (state === "resolved")
      projector.accept({ type: "session_upsert", session: { ...child, pendingQuestions: [] } });
    if (state === "removed") projector.accept({ type: "session_removed", ref: child.ref });
    owned = true;
    const alerts = projector.accept({ type: "session_upsert", session: snapshot() }, "baseline");
    if (state === "pending") {
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        kind: "agent.question_asked",
        navigationTarget: { requestId: "question", session: { externalSessionId: "root" } },
      });
    } else expect(alerts).toEqual([]);
    expect(projector.reconcileAssociations()).toEqual([]);
  },
);
