import { describe, expect, test } from "bun:test";
import {
  agentSessionLiveSnapshotSchema,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { WorkspaceSessionLiveSnapshot } from "@/features/workspace-activity/workspace-activity-observer";
import {
  foldWorkspaceSessionLiveFacts,
  type WorkspaceSessionLiveFacts,
  type WorkspaceSessionLiveState,
} from "@/features/workspace-activity/workspace-activity-state";
import {
  applyWorkspaceActivityEnvelope,
  emptyWorkspaceActivityProjection,
} from "@/features/workspace-activity/workspace-activity-projection";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionReadStateStore, sessionReadStateKey } from "./session-read-state-store";

const identity: AgentSessionIdentity = {
  externalSessionId: "shared-id",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
};
const key = sessionReadStateKey("alpha", identity);
const facts = (
  activityState: WorkspaceSessionLiveFacts["activityState"],
  overrides: Partial<WorkspaceSessionLiveFacts> = {},
): WorkspaceSessionLiveFacts => ({
  activityState,
  pendingQuestion: activityState === "waiting_input",
  pendingPermission: false,
  pendingInputs: new Set(),
  fault: null,
  statusUnavailableReason: null,
  ...overrides,
});
const ready = (
  entries: readonly (readonly [AgentSessionIdentity, WorkspaceSessionLiveFacts])[],
): WorkspaceSessionLiveState => ({
  kind: "ready",
  sessions: new Map(entries.map(([ref, value]) => [agentSessionIdentityKey(ref), value])),
  faults: new Map(),
});
const snapshot = (
  live: WorkspaceSessionLiveState,
  workspaceId = "alpha",
): WorkspaceSessionLiveSnapshot => ({
  statesByWorkspaceId: new Map([[workspaceId, live]]),
  sessionRecordsError: null,
});

const liveSession = (overrides: Partial<AgentSessionLiveSnapshot>): AgentSessionLiveSnapshot =>
  agentSessionLiveSnapshotSchema.parse({
    ref: { repoPath: "/repo", ...identity },
    activity: "running",
    title: "Session",
    startedAt: "2026-10-07T08:00:00.000Z",
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
    ...overrides,
  });

describe("Session read state", () => {
  test.each([
    ["question", "root"],
    ["question", "child"],
    ["permission", "root"],
    ["permission", "child"],
  ] as const)(
    "new %s requests from a %s session become unread while input stays pending",
    (kind, source) => {
      const store = createSessionReadStateStore();
      const ref = {
        repoPath: "/repo",
        ...identity,
        externalSessionId: source === "child" ? "child" : identity.externalSessionId,
      };
      const inputSession = (requestIds: string[]) => {
        const inputs: Partial<AgentSessionLiveSnapshot> = {
          ref,
          activity: kind === "question" ? "waiting_for_question" : "waiting_for_permission",
          pendingQuestions:
            kind === "question"
              ? requestIds.map((requestId) => ({
                  requestId,
                  questions: [{ header: "Choice", question: "Which option?", options: [] }],
                }))
              : [],
          pendingApprovals:
            kind === "permission"
              ? requestIds.map((requestId) => ({
                  requestId,
                  requestType: "command_execution",
                  title: "Run command",
                }))
              : [],
        };
        if (source === "child") inputs.parentExternalSessionId = identity.externalSessionId;
        return liveSession(inputs);
      };
      let projection = applyWorkspaceActivityEnvelope(emptyWorkspaceActivityProjection(), {
        type: "snapshot",
        repoPath: "/repo",
        sessions:
          source === "child" ? [liveSession({}), inputSession(["a"])] : [inputSession(["a"])],
      });
      const observe = () =>
        store.observeLiveSnapshot(
          snapshot({
            kind: "ready",
            sessions: foldWorkspaceSessionLiveFacts(projection.sessions, projection.faults),
            faults: projection.faults,
          }),
        );
      const update = (requestIds: string[]) => {
        projection = applyWorkspaceActivityEnvelope(projection, {
          type: "session_upsert",
          session: inputSession(requestIds),
        });
        observe();
      };

      observe();
      expect(store.isUnread(key)).toBe(false);
      store.setVisibleKey(key);
      store.setVisibleKey(null);
      update(["a"]);
      expect(store.isUnread(key)).toBe(false);

      update(["b"]);
      expect(store.isUnread(key)).toBe(true);
      store.setVisibleKey(key);
      update(["c"]);
      expect(store.isUnread(key)).toBe(false);
      store.setVisibleKey(null);
      update(["c"]);
      expect(store.isUnread(key)).toBe(false);

      update(["c", "d"]);
      expect(store.isUnread(key)).toBe(true);
      store.setUnread(key, false);
      update(["d", "c"]);
      expect(store.isUnread(key)).toBe(false);
      update(["c"]);
      expect(store.isUnread(key)).toBe(false);

      projection = applyWorkspaceActivityEnvelope(projection, {
        type: "session_upsert",
        session: liveSession({
          ...inputSession(["c"]),
          ref: { ...ref, externalSessionId: "another-child" },
          parentExternalSessionId: identity.externalSessionId,
        }),
      });
      observe();
      expect(store.isUnread(key)).toBe(true);

      store.setUnread(key, false);
      const current = inputSession(["c"]);
      const changedKind = liveSession({
        ...current,
        activity: kind === "permission" ? "waiting_for_question" : "waiting_for_permission",
        pendingQuestions: kind === "permission" ? [{ requestId: "c", questions: [] }] : [],
        pendingApprovals:
          kind === "question"
            ? [
                {
                  requestId: "c",
                  requestType: "command_execution",
                  title: "Run command",
                },
              ]
            : [],
      });
      projection = applyWorkspaceActivityEnvelope(projection, {
        type: "session_upsert",
        session: changedKind,
      });
      observe();
      expect(store.isUnread(key)).toBe(true);

      if (kind === "question") {
        projection = applyWorkspaceActivityEnvelope(projection, {
          type: "session_upsert",
          session: current,
        });
        observe();
        store.setUnread(key, false);
        const nextInstance = liveSession({
          ...current,
          pendingQuestions: current.pendingQuestions.map((request) => ({
            ...request,
            requestInstanceId: "next-instance",
          })),
        });
        projection = applyWorkspaceActivityEnvelope(projection, {
          type: "session_upsert",
          session: nextInstance,
        });
        observe();
        expect(store.isUnread(key)).toBe(true);
        store.setUnread(key, false);
        projection = applyWorkspaceActivityEnvelope(projection, {
          type: "session_upsert",
          session: nextInstance,
        });
        observe();
        expect(store.isUnread(key)).toBe(false);
      }
    },
  );

  test("manual read marks survive unchanged activity and can mark the visible session unread", () => {
    const store = createSessionReadStateStore();
    let notifications = 0;
    store.subscribe(() => notifications++);
    store.observeLiveSnapshot(snapshot(ready([[identity, facts("idle")]])));
    store.setVisibleKey(key);
    store.setUnread(key, true);
    store.setUnread(key, true);
    store.observeLiveSnapshot(snapshot(ready([[identity, facts("idle")]])));
    expect(store.isUnread(key)).toBe(true);
    expect(notifications).toBe(1);

    store.setUnread(key, false);
    store.setUnread(key, false);
    expect(store.isUnread(key)).toBe(false);
    expect(notifications).toBe(2);

    const otherKey = sessionReadStateKey("beta", identity);
    store.setUnread(otherKey, true);
    expect(store.isUnread(key)).toBe(false);
    expect(store.isUnread(otherKey)).toBe(true);
    store.setVisibleKey(otherKey);
    expect(store.isUnread(otherKey)).toBe(false);
  });

  test("starts all loaded sessions seen, and resets read marks in a new app store", () => {
    const store = createSessionReadStateStore();
    const waiting = { ...identity, externalSessionId: "waiting" };
    store.observeLiveSnapshot(
      snapshot(
        ready([
          [identity, facts("idle")],
          [waiting, facts("waiting_input")],
        ]),
      ),
    );
    expect(store.isUnread(key)).toBe(false);
    expect(store.isUnread(sessionReadStateKey("alpha", waiting))).toBe(false);

    store.observeLiveSnapshot(snapshot(ready([[identity, facts("running")]])));
    store.observeLiveSnapshot(snapshot(ready([[identity, facts("idle")]])));
    expect(store.isUnread(key)).toBe(true);

    const restarted = createSessionReadStateStore();
    restarted.observeLiveSnapshot(snapshot(ready([[identity, facts("idle")]])));
    expect(restarted.isUnread(key)).toBe(false);
  });

  test("marks confirmed waiting and terminal changes unread without publishing unchanged output", () => {
    const store = createSessionReadStateStore();
    let notifications = 0;
    store.subscribe(() => notifications++);
    const update = (activity: WorkspaceSessionLiveFacts["activityState"]) =>
      store.observeLiveSnapshot(snapshot(ready([[identity, facts(activity)]])));
    update("idle");
    update("starting");
    update("running");
    expect(notifications).toBe(0);
    update("waiting_input");
    expect(store.isUnread(key)).toBe(true);
    update("waiting_input");
    expect(notifications).toBe(1);

    store.setVisibleKey(key);
    expect(store.isUnread(key)).toBe(false);
    store.setVisibleKey(null);
    update("running");
    update("error");
    expect(store.isUnread(key)).toBe(true);
    expect(notifications).toBe(3);
  });

  test("keeps visible completions seen and isolates the workspace, runtime, and directory", () => {
    const store = createSessionReadStateStore();
    const claude = { ...identity, runtimeKind: "claude" as const };
    const otherDirectory = { ...identity, workingDirectory: "/repo/other-worktree" };
    const entries = [identity, claude, otherDirectory];
    const update = (activity: WorkspaceSessionLiveFacts["activityState"]) =>
      store.observeLiveSnapshot({
        statesByWorkspaceId: new Map([
          ["alpha", ready(entries.map((ref) => [ref, facts(activity)]))],
          ["beta", ready([[identity, facts(activity)]])],
        ]),
        sessionRecordsError: null,
      });
    update("running");
    store.setVisibleKey(key);
    update("idle");
    expect(store.isUnread(key)).toBe(false);
    for (const ref of [claude, otherDirectory]) {
      expect(store.isUnread(sessionReadStateKey("alpha", ref))).toBe(true);
    }
    expect(store.isUnread(sessionReadStateKey("beta", identity))).toBe(true);
  });

  test("does not mistake unavailable observations for completion and confirms removal once", () => {
    const store = createSessionReadStateStore();
    store.observeLiveSnapshot(snapshot(ready([[identity, facts("running")]])));
    store.observeLiveSnapshot(
      snapshot({
        kind: "unavailable",
        reason: "Disconnected",
        sessions: new Map(),
        faults: new Map(),
      }),
    );
    store.observeLiveSnapshot(snapshot({ kind: "unknown" }));
    const statusFault = new Map([
      [
        agentSessionIdentityKey(identity),
        { message: "Status read failed", statusUnavailable: true },
      ],
    ]);
    store.observeLiveSnapshot(
      snapshot({ kind: "ready", sessions: new Map(), faults: statusFault }),
    );
    store.observeLiveSnapshot(
      snapshot(
        ready([[identity, facts("idle", { statusUnavailableReason: "Status read failed" })]]),
      ),
    );
    expect(store.isUnread(key)).toBe(false);

    store.observeLiveSnapshot(snapshot(ready([])));
    expect(store.isUnread(key)).toBe(true);
    store.setVisibleKey(key);
    store.setVisibleKey(null);
    store.observeLiveSnapshot(snapshot(ready([])));
    expect(store.isUnread(key)).toBe(false);
  });

  test("marks a new task blocker unread, while initial blockers and visible blockers stay seen", () => {
    const store = createSessionReadStateStore();
    store.observeBlocked(key, true);
    expect(store.isUnread(key)).toBe(false);
    store.observeBlocked(key, false);
    store.observeBlocked(key, true);
    expect(store.isUnread(key)).toBe(true);
    store.setVisibleKey(key);
    store.observeBlocked(key, false);
    store.observeBlocked(key, true);
    expect(store.isUnread(key)).toBe(false);
  });
});
