import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import { createOpenCodeLiveSessionState } from "./opencode-live-session-state";

const runtime: OpenCodeRuntimeInstance = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
  startedAt: "2026-07-16T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
};

const summary = (externalSessionId = "session-1"): AgentSessionSummary => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  title: "OpenDucktor session",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  startedAt: "2026-07-16T10:01:00.000Z",
  status: "running",
});

const createState = () => {
  let nextOccurrence = 1;
  return createOpenCodeLiveSessionState({
    runtime,
    nextOccurrenceId: () => `opaque-${nextOccurrence++}`,
  });
};

type LiveState = ReturnType<typeof createState>;
type SessionSources = Parameters<LiveState["applySessionSources"]>[0]["sources"];

const applySources = (state: LiveState, sources: SessionSources) =>
  state.applySessionSources({ sources, failures: [] }, state.captureSourceRead());

describe("OpenCode host live-session state", () => {
  test("starts empty and adds a session from an OpenDucktor control result", () => {
    const state = createState();

    expect(state.listSnapshots()).toEqual([]);

    state.applyControlSummary(summary());

    expect(state.listSnapshots()).toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "session-1" }),
        title: "OpenDucktor session",
      }),
    ]);
  });

  test("indexes external ids through replacement, ambiguity, removal, and release", () => {
    const state = createState();
    expect(state.refForExternalSession("session-1")).toBeNull();
    state.applyControlSummary(summary());
    const first = state.refForExternalSession("session-1");
    if (!first) throw new Error("Expected a live session reference.");
    state.applyControlSummary({ ...summary(), title: "Updated title" });
    expect(state.refForExternalSession("session-1")).toEqual(first);
    state.applyControlSummary({ ...summary(), workingDirectory: "/other" });
    expect(() => state.refForExternalSession("session-1")).toThrow("ambiguous session id");
    state.removeSession(first);
    const remaining = state.refForExternalSession("session-1");
    expect(remaining?.workingDirectory).toBe("/other");
    state.release();
    expect(state.refForExternalSession("session-1")).toBeNull();
    state.applyControlSummary(summary());
    expect(state.refForExternalSession("session-1")).toEqual(first);
  });

  test("retains and resolves pending input from runtime events", () => {
    const state = createState();
    state.applyControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a live OpenDucktor session.");
    }

    state.applyEvent(ref, {
      type: "approval_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-16T10:02:00.000Z",
      requestId: "native-approval-1",
      requestType: "command_execution",
      title: "Run command",
    });
    const occurrenceId = state.listSnapshots()[0]?.pendingApprovals[0]?.requestId;
    expect(occurrenceId).toBe("opaque-1");
    if (!occurrenceId) {
      throw new Error("Expected a pending approval occurrence.");
    }
    expect(state.requirePendingRoute(ref, occurrenceId, "approval").nativeRequestId).toBe(
      "native-approval-1",
    );

    state.applyEvent(ref, {
      type: "approval_resolved",
      externalSessionId: "session-1",
      timestamp: "2026-07-16T10:03:00.000Z",
      requestId: "native-approval-1",
    });

    expect(state.listSnapshots()[0]?.pendingApprovals).toEqual([]);
  });

  test("keeps pending input authoritative when a later control summary arrives", () => {
    const state = createState();
    state.applyControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a live OpenDucktor session.");
    }
    state.applyEvent(ref, {
      type: "approval_required",
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-07-16T10:01:00.000Z",
      requestId: "permission-1",
      requestType: "file_change",
      title: "Edit a file",
    });

    state.applyControlSummary({ ...summary(), status: "idle" });

    expect(state.listSnapshots()[0]).toMatchObject({
      activity: "waiting_for_permission",
      pendingApprovals: [expect.objectContaining({ requestId: "opaque-1" })],
    });
  });

  test("admits descendants only through registered parent lineage", () => {
    const state = createState();
    state.applyControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a live OpenDucktor parent.");
    }

    state.applyEvent(parentRef, {
      type: "question_required",
      externalSessionId: "parent",
      timestamp: "2026-07-16T10:02:00.000Z",
      requestId: "native-question-1",
      parentExternalSessionId: "parent",
      childExternalSessionId: "child",
      questions: [],
    });
    state.applyEvent(parentRef, {
      type: "approval_required",
      externalSessionId: "parent",
      timestamp: "2026-07-16T10:03:00.000Z",
      requestId: "native-approval-1",
      requestType: "command_execution",
      title: "Run command",
      parentExternalSessionId: "child",
      childExternalSessionId: "grandchild",
    });

    expect(state.refForExternalSession("child")?.externalSessionId).toBe("child");
    expect(state.refForExternalSession("grandchild")?.externalSessionId).toBe("grandchild");
    expect(state.listSnapshots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: expect.objectContaining({ externalSessionId: "parent" }) }),
        expect.objectContaining({
          ref: expect.objectContaining({ externalSessionId: "child" }),
          parentExternalSessionId: "parent",
          pendingQuestions: [expect.objectContaining({ requestId: "opaque-1" })],
        }),
        expect.objectContaining({
          ref: expect.objectContaining({ externalSessionId: "grandchild" }),
          parentExternalSessionId: "child",
          pendingApprovals: [expect.objectContaining({ requestId: "opaque-2" })],
        }),
      ]),
    );
  });

  test("rejects a descendant event whose parent was not registered", () => {
    const state = createState();
    state.applyControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a live OpenDucktor parent.");
    }

    expect(() =>
      state.applyEvent(parentRef, {
        type: "approval_required",
        externalSessionId: "parent",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "native-approval-1",
        requestType: "command_execution",
        title: "Run command",
        parentExternalSessionId: "unknown-parent",
        childExternalSessionId: "child",
      }),
    ).toThrow("names unregistered parent 'unknown-parent'");
  });

  test("keeps context demand-driven and removes a controlled session tree", () => {
    const state = createState();
    state.applyControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a live OpenDucktor session.");
    }

    expect(state.applyLoadedContext(ref, { totalTokens: 42 })).toMatchObject({
      value: { totalTokens: 42 },
      changes: [{ type: "session_upsert" }],
    });
    expect(state.removeSession(ref)).toEqual([{ type: "session_removed", ref }]);
    expect(state.listSnapshots()).toEqual([]);
  });

  test("retains early context and updates only the matching session", () => {
    const state = createState();
    expect(state.setContext("session-1", { totalTokens: 42 })).toEqual([]);
    expect(state.listSnapshots()).toEqual([]);
    state.applyControlSummary(summary());
    state.applyControlSummary(summary("session-2"));
    const ref = state.refForExternalSession("session-1");
    if (!ref) throw new Error("Expected a live session reference.");
    expect(state.contextUsage(ref)).toEqual({ totalTokens: 42 });

    expect(state.setContext("session-1", { totalTokens: 84 })).toEqual([
      {
        type: "session_upsert",
        snapshot: expect.objectContaining({ ref, contextUsage: { totalTokens: 84 } }),
      },
    ]);
    expect(state.contextUsage(ref)).toEqual({ totalTokens: 84 });
    expect(state.listSnapshots()).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "session-2" }),
        contextUsage: null,
      }),
    );
    expect(state.setContext("session-1", { totalTokens: 84 })).toEqual([]);
  });

  test("rejects ambiguous context updates without changing state and resumes after removal", () => {
    const state = createState();
    state.applyControlSummary(summary());
    const first = state.refForExternalSession("session-1");
    if (!first) throw new Error("Expected a live session reference.");
    state.setContext("session-1", { totalTokens: 42 });
    state.applyControlSummary({ ...summary(), workingDirectory: "/other" });
    const before = state.listSnapshots();

    expect(() => state.setContext("session-1", { totalTokens: 84 })).toThrow(HostValidationError);
    state.applyControlSummary(summary());
    expect(state.listSnapshots()).toEqual(before);

    state.removeSession(first);
    expect(state.setContext("session-1", { totalTokens: 84 })).toEqual([
      {
        type: "session_upsert",
        snapshot: expect.objectContaining({
          ref: { ...first, workingDirectory: "/other" },
          contextUsage: { totalTokens: 84 },
        }),
      },
    ]);
  });

  test("removes a vanished descendant when the runtime list omits it", () => {
    const state = createState();
    state.applyControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a live OpenDucktor parent.");
    }
    state.applyEvent(parentRef, {
      type: "question_required",
      externalSessionId: "parent",
      timestamp: "2026-07-16T10:02:00.000Z",
      requestId: "native-question-1",
      parentExternalSessionId: "parent",
      childExternalSessionId: "child",
      questions: [],
    });

    applySources(state, [
      {
        externalSessionId: "parent",
        workingDirectory: parentRef.workingDirectory,
        sessionAssociation: { kind: "unbound" },
        title: "OpenDucktor session",
        startedAt: "2026-07-16T10:01:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    ]);

    expect(state.listSnapshots().map((snapshot) => snapshot.ref.externalSessionId)).toEqual([
      "parent",
    ]);
  });

  test("removes a session when the runtime list omits it", () => {
    const state = createState();
    state.applyControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a live OpenDucktor parent.");
    }

    expect(applySources(state, [])).toEqual([
      { type: "session_removed", ref: parentRef, provenance: "baseline" },
    ]);
    expect(state.listSnapshots()).toEqual([]);
  });

  test("blocks child approval when a refresh drops its parent after a new request", () => {
    const state = createState();
    state.applyControlSummary({
      ...summary("parent"),
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
    });
    const parentRef = state.listSnapshots()[0]!.ref;
    const read = state.captureSourceRead();
    state.applyEvent(parentRef, {
      type: "approval_required",
      externalSessionId: "parent",
      childExternalSessionId: "child",
      parentExternalSessionId: "parent",
      timestamp: "2026-07-16T10:02:00.000Z",
      requestId: "child-edit",
      requestType: "file_change",
      title: "Edit",
      action: { name: "write" },
      mutation: "mutating",
    });

    expect(state.applySessionSources({ sources: [], failures: [] }, read)).toEqual([
      { type: "session_removed", ref: parentRef, provenance: "baseline" },
    ]);
    state.finishSourceRead(read);
    const child = state.listSnapshots()[0]!;
    expect(child.ref.externalSessionId).toBe("child");
    expect(child.parentExternalSessionId).toBe("parent");
    const requestId = child.pendingApprovals[0]!.requestId;
    const route = state.requirePendingRoute(child.ref, requestId, "approval");
    for (const outcome of ["approve_once", "approve_session"] as const) {
      expect(() => state.assertApprovalAllowed(route, outcome)).toThrow(
        "parent 'parent' is no longer registered",
      );
    }
    expect(state.requirePendingRoute(child.ref, requestId, "approval")).toEqual(route);
    expect(() => state.assertApprovalAllowed(route, "reject")).not.toThrow();
    state.completePendingReply(route);
    expect(state.listSnapshots()[0]?.pendingApprovals).toEqual([]);
  });

  test("keeps a session when its runtime directory read fails", () => {
    const state = createState();
    state.applyControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a live OpenDucktor parent.");
    }

    expect(
      state.applySessionSources(
        {
          sources: [],
          failures: [
            {
              externalSessionId: parentRef.externalSessionId,
              workingDirectory: parentRef.workingDirectory,
              message: "status failed",
            },
          ],
        },
        state.captureSourceRead(),
      ),
    ).toEqual([
      {
        type: "fault",
        repoPath: runtime.repoPath,
        ref: parentRef,
        provenance: "baseline",
        operation: "opencode-live-session.refresh-session",
        message: `Failed to refresh OpenCode session 'parent' in '${parentRef.workingDirectory}': status failed`,
      },
    ]);
    expect(state.listSnapshots()).toHaveLength(1);
  });

  test("keeps parent lineage from the runtime list", () => {
    const state = createState();
    state.applyControlSummary(summary("child"));
    const childRef = state.listSnapshots()[0]?.ref;
    if (!childRef) {
      throw new Error("Expected a live OpenDucktor session.");
    }

    applySources(state, [
      {
        externalSessionId: "child",
        parentExternalSessionId: "parent",
        workingDirectory: childRef.workingDirectory,
        sessionAssociation: { kind: "unbound" },
        title: "OpenCode subagent",
        startedAt: "2026-07-16T10:01:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    ]);

    expect(state.listSnapshots()).toEqual([
      expect.objectContaining({ ref: childRef, parentExternalSessionId: "parent" }),
    ]);
  });

  test("keeps a source when the runtime still lists it", () => {
    const state = createState();
    state.applyControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a live OpenDucktor parent.");
    }

    expect(
      applySources(state, [
        {
          externalSessionId: "parent",
          workingDirectory: parentRef.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "OpenDucktor session",
          startedAt: "2026-07-16T10:01:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ]),
    ).toEqual([expect.objectContaining({ type: "session_upsert" })]);

    expect(state.listSnapshots()).toHaveLength(1);
  });

  test("does not retain a pending route when event validation fails", () => {
    const state = createOpenCodeLiveSessionState({
      runtime,
      nextOccurrenceId: () => "",
    });
    state.applyControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a live OpenDucktor session.");
    }

    expect(() =>
      state.applyEvent(ref, {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "native-approval-1",
        requestType: "command_execution",
        title: "Run command",
      }),
    ).toThrow();
    expect(() => state.requirePendingRoute(ref, "", "approval")).toThrow(
      "Unknown or resolved OpenCode approval occurrence",
    );
    expect(state.listSnapshots()[0]?.pendingApprovals).toEqual([]);
  });
});

for (const kind of ["approval", "question"] as const) {
  const source = (ids: string[]): SessionSources => [
    {
      externalSessionId: "session-1",
      workingDirectory: "/repo/worktree",
      sessionAssociation: { kind: "unbound" },
      runtimeActivity: "idle",
      title: "Recovered",
      startedAt: runtime.startedAt,
      pendingApprovals:
        kind === "approval"
          ? ids.map((id) => ({ requestId: id, requestType: "command_execution", title: id }))
          : [],
      pendingQuestions:
        kind === "question" ? ids.map((id) => ({ requestId: id, questions: [] })) : [],
    },
  ];
  const arrive = (state: LiveState, id: string) => {
    const ref = state.listSnapshots()[0]!.ref;
    if (kind === "approval")
      state.applyEvent(ref, {
        type: "approval_required",
        externalSessionId: ref.externalSessionId,
        timestamp: runtime.startedAt,
        requestId: id,
        requestType: "command_execution",
        title: id,
      });
    else
      state.applyEvent(ref, {
        type: "question_required",
        externalSessionId: ref.externalSessionId,
        timestamp: runtime.startedAt,
        requestId: id,
        questions: [],
      });
  };
  const nativeIds = (state: LiveState) => {
    const snapshot = state.listSnapshots()[0]!;
    const pending = kind === "approval" ? snapshot.pendingApprovals : snapshot.pendingQuestions;
    return pending
      .map((item) => state.requirePendingRoute(snapshot.ref, item.requestId, kind).nativeRequestId)
      .sort();
  };
  test(`recovery keeps missed ${kind} P and concurrent ${kind} Q with usable reply routes`, () => {
    const state = createState();
    state.applyControlSummary(summary());
    const captured = state.captureSourceRead();
    arrive(state, "Q");
    state.applySessionSources({ sources: source(["P"]), failures: [] }, captured);
    expect(nativeIds(state)).toEqual(["P", "Q"]);
    expect(state.listSnapshots()[0]!.activity).toBe(
      kind === "approval" ? "waiting_for_permission" : "waiting_for_question",
    );
  });
  test(`recovery cannot revive ${kind} R that arrived and resolved during its read`, () => {
    const state = createState();
    state.applyControlSummary(summary());
    arrive(state, "Q");
    const captured = state.captureSourceRead();
    arrive(state, "R");
    const snapshot = state.listSnapshots()[0]!;
    state.applyEvent(snapshot.ref, {
      type: kind === "approval" ? "approval_resolved" : "question_resolved",
      externalSessionId: snapshot.ref.externalSessionId,
      requestId: "R",
      timestamp: runtime.startedAt,
    });
    state.applySessionSources({ sources: source(["Q", "R"]), failures: [] }, captured);
    expect(nativeIds(state)).toEqual(["Q"]);
  });
  test(`recovery keeps ${kind} resolution received without a request occurrence`, () => {
    const state = createState();
    state.applyControlSummary({ ...summary(), status: "idle" });
    const captured = state.captureSourceRead();
    const ref = state.listSnapshots()[0]!.ref;
    state.applyEvent(ref, {
      type: kind === "approval" ? "approval_resolved" : "question_resolved",
      externalSessionId: ref.externalSessionId,
      requestId: "R",
      timestamp: runtime.startedAt,
    });
    state.applySessionSources({ sources: source(["R"]), failures: [] }, captured);
    expect(nativeIds(state)).toEqual([]);
    expect(state.listSnapshots()[0]!.activity).toBe("idle");
  });
}

test("source recovery preserves activity that changed away and back during the read", () => {
  const state = createState();
  state.applyControlSummary(summary());
  const ref = state.listSnapshots()[0]!.ref;
  const read = state.captureSourceRead();
  state.applyEvent(ref, {
    type: "session_idle",
    externalSessionId: ref.externalSessionId,
    timestamp: runtime.startedAt,
  });
  state.applyEvent(ref, {
    type: "session_status",
    externalSessionId: ref.externalSessionId,
    timestamp: runtime.startedAt,
    status: { type: "busy", message: null },
  });
  expect(state.listSnapshots()[0]!.activity).toBe("running");
  state.applySessionSources(
    {
      sources: [
        {
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Recovered metadata",
          startedAt: runtime.startedAt,
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ],
      failures: [],
    },
    read,
  );
  expect(state.listSnapshots()[0]!.activity).toBe("running");
  expect(state.listSnapshots()[0]!.title).toBe("Recovered metadata");
});

test("an unchanged busy event during a source read still wins over an idle source", () => {
  const state = createState();
  state.applyControlSummary(summary());
  const ref = state.listSnapshots()[0]!.ref;
  const read = state.captureSourceRead();
  state.applyEvent(ref, {
    type: "session_status",
    externalSessionId: ref.externalSessionId,
    timestamp: runtime.startedAt,
    status: { type: "busy", message: null },
  });
  state.applySessionSources(
    {
      sources: [
        {
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Recovered",
          startedAt: runtime.startedAt,
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ],
      failures: [],
    },
    read,
  );
  expect(state.listSnapshots()[0]!.activity).toBe("running");
});

test("source recovery preserves metadata and context that changed away and back", () => {
  const state = createState();
  state.applyControlSummary(summary());
  state.setContext("session-1", { totalTokens: 10 });
  const ref = state.listSnapshots()[0]!.ref;
  const read = state.captureSourceRead();
  state.applyControlSummary({ ...summary(), title: "Intermediate" });
  state.setContext("session-1", { totalTokens: 20 });
  state.applyControlSummary(summary());
  state.setContext("session-1", { totalTokens: 10 });
  state.applySessionSources(
    {
      sources: [
        {
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Intermediate",
          startedAt: runtime.startedAt,
          runtimeActivity: "running",
          contextUsage: { totalTokens: 20 },
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ],
      failures: [],
    },
    read,
  );
  expect(state.listSnapshots()[0]!.title).toBe(summary().title!);
  expect(state.listSnapshots()[0]!.contextUsage).toEqual({ totalTokens: 10 });
});

test("a repeated activity event prevents an older source omission from deleting the session", () => {
  const state = createState();
  state.applyControlSummary(summary());
  const ref = state.listSnapshots()[0]!.ref;
  const read = state.captureSourceRead();
  state.applyEvent(ref, {
    type: "session_status",
    externalSessionId: ref.externalSessionId,
    timestamp: runtime.startedAt,
    status: { type: "busy", message: null },
  });
  state.applySessionSources({ sources: [], failures: [] }, read);
  expect(state.listSnapshots()).toHaveLength(1);
  expect(state.listSnapshots()[0]!.activity).toBe("running");
});
