import { describe, expect, test } from "bun:test";
import type { OpencodeRuntimeSnapshotSource } from "@openducktor/adapters-opencode-sdk";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
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

const source = (externalSessionId: string, requestId: string): OpencodeRuntimeSnapshotSource => ({
  externalSessionId,
  title: externalSessionId,
  workingDirectory: `/repo/${externalSessionId}`,
  startedAt: "2026-07-16T10:01:00.000Z",
  runtimeActivity: "idle",
  pendingApprovals: [
    {
      requestId,
      requestType: "command_execution",
      title: "Run command",
    },
  ],
  pendingQuestions: [],
});

const createState = () => {
  let nextOccurrence = 1;
  return createOpenCodeLiveSessionState({
    runtime,
    nextOccurrenceId: () => `opaque-${nextOccurrence++}`,
  });
};

describe("OpenCode host live-session state", () => {
  test("isolates equal native request ids by session and resolves only the matching occurrence", () => {
    const state = createState();
    state.initialize([source("session-1", "same-id"), source("session-2", "same-id")], new Map());

    const [first, second] = state.listSnapshots();
    const firstRequestId = first?.pendingApprovals[0]?.requestId;
    const secondRequestId = second?.pendingApprovals[0]?.requestId;
    expect(firstRequestId).toBe("opaque-1");
    expect(secondRequestId).toBe("opaque-2");
    if (!first || !firstRequestId) {
      throw new Error("Expected the first pending approval.");
    }

    const route = state.requirePendingRoute(first.ref, firstRequestId, "approval");
    expect(route.nativeRequestId).toBe("same-id");
    state.completePendingReply(route);

    expect(state.readSnapshot(first.ref)).toMatchObject({
      type: "live",
      session: { pendingApprovals: [] },
    });
    expect(second ? state.readSnapshot(second.ref) : null).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: "opaque-2" }] },
    });
  });

  test("assigns a new opaque occurrence when a resolved native id is reused", () => {
    const state = createState();
    const initialSource = source("session-1", "reused-id");
    state.initialize([initialSource], new Map());
    const initial = state.listSnapshots()[0];
    const initialRequestId = initial?.pendingApprovals[0]?.requestId;
    if (!initial || !initialRequestId) {
      throw new Error("Expected an initial request occurrence.");
    }
    state.completePendingReply(
      state.requirePendingRoute(initial.ref, initialRequestId, "approval"),
    );

    state.refresh([initialSource]);

    expect(state.listSnapshots()[0]?.pendingApprovals[0]?.requestId).toBe("opaque-2");
  });

  test("keeps a live context update newer than an explicit context read", () => {
    const state = createState();
    state.initialize(
      [
        {
          ...source("session-1", "request-1"),
          pendingApprovals: [],
        },
      ],
      new Map(),
    );
    const snapshot = state.listSnapshots()[0];
    if (!snapshot) {
      throw new Error("Expected a retained session.");
    }

    state.retainContext("session-1", { totalTokens: 99 });
    const loaded = state.applyLoadedContext(snapshot.ref, { totalTokens: 12 });

    expect(loaded).toEqual({ value: { totalTokens: 99 }, changes: [] });
    expect(state.readSnapshot(snapshot.ref)).toMatchObject({
      type: "live",
      session: { contextUsage: { totalTokens: 99 } },
    });
  });

  test("clears all routes and snapshots when its runtime is released", () => {
    const state = createState();
    state.initialize(
      [source("session-1", "request-1"), source("session-2", "request-2")],
      new Map(),
    );
    const snapshots = state.listSnapshots();
    const first = snapshots[0];
    if (!first) {
      throw new Error("Expected a retained session before release.");
    }

    expect(state.release()).toEqual(snapshots.map((snapshot) => snapshot.ref));
    expect(state.listSnapshots()).toEqual([]);
    expect(state.has(first.ref)).toBe(false);
  });
});
