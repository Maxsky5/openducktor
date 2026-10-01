import { describe, expect, test } from "bun:test";
import type { WorkspaceSessionLiveSnapshot } from "@/features/workspace-activity/workspace-activity-observer";
import type {
  WorkspaceSessionLiveFacts,
  WorkspaceSessionLiveState,
} from "@/features/workspace-activity/workspace-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
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
  lastActivityAt: null,
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

describe("Session read state", () => {
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
