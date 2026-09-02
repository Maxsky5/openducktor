import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
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

describe("OpenCode host live-session state", () => {
  test("starts empty and admits a root only from an OpenDucktor control result", () => {
    const state = createState();

    expect(state.listSnapshots()).toEqual([]);

    state.retainControlSummary(summary());

    expect(state.listSnapshots()).toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "session-1" }),
        title: "OpenDucktor session",
      }),
    ]);
  });

  test("retains and resolves pending input from runtime events", () => {
    const state = createState();
    state.retainControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a retained OpenDucktor session.");
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
    state.retainControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a retained OpenDucktor session.");
    }
    state.applyEvent(ref, {
      type: "approval_required",
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-07-16T10:01:00.000Z",
      requestId: "permission-1",
      requestType: "file_change",
      title: "Edit a file",
    });

    state.retainControlSummary({ ...summary(), status: "idle" });

    expect(state.listSnapshots()[0]).toMatchObject({
      activity: "waiting_for_permission",
      pendingApprovals: [expect.objectContaining({ requestId: "opaque-1" })],
    });
  });

  test("admits descendants only through registered parent lineage", () => {
    const state = createState();
    state.retainControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a retained OpenDucktor parent.");
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
    state.retainControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a retained OpenDucktor parent.");
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
    state.retainControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a retained OpenDucktor session.");
    }

    expect(state.applyLoadedContext(ref, { totalTokens: 42 })).toMatchObject({
      value: { totalTokens: 42 },
      changes: [{ type: "session_upsert" }],
    });
    expect(state.removeSession(ref)).toEqual([{ type: "session_removed", ref }]);
    expect(state.listSnapshots()).toEqual([]);
  });

  test("removes a vanished descendant when a registered root refresh omits it", () => {
    const state = createState();
    state.retainControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a retained OpenDucktor parent.");
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

    state.applyWorkflowRoots([
      {
        type: "present",
        ref: parentRef,
        sources: [
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
        ],
      },
    ]);

    expect(state.listSnapshots().map((snapshot) => snapshot.ref.externalSessionId)).toEqual([
      "parent",
    ]);
  });

  test("removes a registered root when OpenCode confirms it is missing", () => {
    const state = createState();
    state.retainControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a retained OpenDucktor parent.");
    }

    expect(state.applyWorkflowRoots([{ type: "missing", ref: parentRef }])).toEqual([
      { type: "session_removed", ref: parentRef },
    ]);
    expect(state.listSnapshots()).toEqual([]);
  });

  test("rejects a registered ref when OpenCode says it has a parent", () => {
    const state = createState();
    state.retainControlSummary(summary("child"));
    const childRef = state.listSnapshots()[0]?.ref;
    if (!childRef) {
      throw new Error("Expected a retained OpenDucktor session.");
    }

    expect(() =>
      state.applyWorkflowRoots([
        {
          type: "present",
          ref: childRef,
          sources: [
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
          ],
        },
      ]),
    ).toThrow("OpenCode did not return registered session 'child'");
  });

  test("removes a root only after its durable registration is omitted", () => {
    const state = createState();
    state.retainControlSummary(summary("parent"));
    const parentRef = state.listSnapshots()[0]?.ref;
    if (!parentRef) {
      throw new Error("Expected a retained OpenDucktor parent.");
    }

    expect(state.applyWorkflowRoots([])).toEqual([]);
    expect(state.listSnapshots()).toHaveLength(1);
    state.applyWorkflowRoots([
      {
        type: "present",
        ref: parentRef,
        sources: [
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
        ],
      },
    ]);

    expect(state.applyWorkflowRoots([])).toEqual([{ type: "session_removed", ref: parentRef }]);
    expect(state.listSnapshots()).toEqual([]);
  });

  test("does not retain a pending route when event validation fails", () => {
    const state = createOpenCodeLiveSessionState({
      runtime,
      nextOccurrenceId: () => "",
    });
    state.retainControlSummary(summary());
    const ref = state.listSnapshots()[0]?.ref;
    if (!ref) {
      throw new Error("Expected a retained OpenDucktor session.");
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
