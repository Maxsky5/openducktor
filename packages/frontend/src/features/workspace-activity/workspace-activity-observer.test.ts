import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  createWorkspaceActivityObserver,
  type WorkspaceActivityArchivedSessionsPort,
} from "./workspace-activity-observer";

const runtimeKind = "codex" as const;

const snapshot = (
  repoPath: string,
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: { repoPath, runtimeKind, workingDirectory: repoPath, externalSessionId },
  activity: "idle",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-09-15T08:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

type Harness = {
  observer: ReturnType<typeof createWorkspaceActivityObserver>;
  emit(repoPath: string, envelope: AgentSessionLiveEnvelope): void;
  stopped: string[];
  archived: Map<string, Set<string>>;
  notifyArchivedChanged(): void;
  recoverArchived(workspaceId: string): void;
  settle(): Promise<void>;
};

const createHarness = ({
  failObserveFor = new Set<string>(),
  failArchivedFor = new Set<string>(),
}: { failObserveFor?: Set<string>; failArchivedFor?: Set<string> } = {}): Harness => {
  // Both shells fan one repository stream out to every concurrent subscriber,
  // and each stop removes only its own listener.
  const listeners = new Map<string, Set<(envelope: AgentSessionLiveEnvelope) => void>>();
  const stopped: string[] = [];
  const archived = new Map<string, Set<string>>();
  const archivedListeners = new Set<() => void>();

  // The real port reads the record cache, so a read reports a failure only
  // after the load that failed, and never before the load settles.
  const archivedLoaded = new Set<string>();
  const archivedFailed = new Set<string>();

  const archivedSessions: WorkspaceActivityArchivedSessionsPort = {
    load: async (workspaceId) => {
      await Promise.resolve();
      if (failArchivedFor.has(workspaceId)) {
        archivedFailed.add(workspaceId);
        throw new Error(`archived list unavailable for ${workspaceId}`);
      }
      archivedLoaded.add(workspaceId);
    },
    read: (workspaceId) => {
      if (archivedFailed.has(workspaceId)) {
        return { status: "error", reason: `archived list unavailable for ${workspaceId}` };
      }
      if (!archivedLoaded.has(workspaceId)) {
        return { status: "unknown" };
      }
      return { status: "ready", keys: archived.get(workspaceId) ?? new Set() };
    },
    subscribe: (onChange) => {
      archivedListeners.add(onChange);
      return () => archivedListeners.delete(onChange);
    },
  };

  const observer = createWorkspaceActivityObserver({
    observe: async ({ repoPath }, listener) => {
      if (failObserveFor.has(repoPath)) {
        throw new Error(`live stream unavailable for ${repoPath}`);
      }
      const repoListeners = listeners.get(repoPath) ?? new Set();
      repoListeners.add(listener);
      listeners.set(repoPath, repoListeners);
      return () => {
        stopped.push(repoPath);
        repoListeners.delete(listener);
      };
    },
    archivedSessions,
  });

  return {
    observer,
    emit: (repoPath, envelope) => {
      for (const listener of listeners.get(repoPath) ?? []) listener(envelope);
    },
    stopped,
    archived,
    notifyArchivedChanged: () => {
      for (const listener of archivedListeners) listener();
    },
    recoverArchived: (workspaceId) => {
      archivedFailed.delete(workspaceId);
      archivedLoaded.add(workspaceId);
      for (const listener of archivedListeners) listener();
    },
    settle: async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
};

describe("createWorkspaceActivityObserver", () => {
  test("reports unknown until the first snapshot and the archived list settle", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);

    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({ kind: "unknown" });

    harness.emit("/alpha", {
      type: "snapshot",
      repoPath: "/alpha",
      sessions: [snapshot("/alpha", "a", { activity: "running" })],
    });
    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({ kind: "unknown" });

    await harness.settle();
    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: true,
    });
  });

  test("keeps each workspace activity scoped to its own repository", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([
      { workspaceId: "alpha", repoPath: "/alpha" },
      { workspaceId: "beta", repoPath: "/beta" },
    ]);
    await harness.settle();

    harness.emit("/alpha", {
      type: "snapshot",
      repoPath: "/alpha",
      sessions: [snapshot("/alpha", "a", { activity: "running" })],
    });
    harness.emit("/beta", { type: "snapshot", repoPath: "/beta", sessions: [] });

    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: true,
    });
    expect(harness.observer.getWorkspaceActivity("beta")).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("excludes archived chats and follows a later archived list change", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    harness.emit("/alpha", {
      type: "snapshot",
      repoPath: "/alpha",
      sessions: [snapshot("/alpha", "a", { activity: "running" })],
    });
    expect(harness.observer.getWorkspaceActivity("alpha")).toMatchObject({ active: true });

    harness.archived.set(
      "alpha",
      new Set([
        agentSessionIdentityKey({
          externalSessionId: "a",
          runtimeKind,
          workingDirectory: "/alpha",
        }),
      ]),
    );
    harness.notifyArchivedChanged();

    expect(harness.observer.getWorkspaceActivity("alpha")).toMatchObject({ active: false });
  });

  test("reports the failure reason when the live stream faults, and recovers on a snapshot", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    harness.emit("/alpha", { type: "snapshot", repoPath: "/alpha", sessions: [] });

    harness.emit("/alpha", { type: "fault", repoPath: "/alpha", message: "stream closed" });
    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "unavailable",
      reason: "stream closed",
    });

    harness.emit("/alpha", { type: "snapshot", repoPath: "/alpha", sessions: [] });
    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("keeps workspace activity ready when one session faults", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    harness.emit("/alpha", {
      type: "snapshot",
      repoPath: "/alpha",
      sessions: [snapshot("/alpha", "a")],
    });
    const ready = harness.observer.getWorkspaceActivity("alpha");

    harness.emit("/alpha", {
      type: "fault",
      repoPath: "/alpha",
      ref: snapshot("/alpha", "a").ref,
      message: "Codex thread reported a system error.",
    });

    expect(harness.observer.getWorkspaceActivity("alpha")).toBe(ready);
    expect(ready).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("reports a rejected observation start without retrying", async () => {
    const harness = createHarness({ failObserveFor: new Set(["/alpha"]) });
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();

    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "unavailable",
      reason: "live stream unavailable for /alpha",
    });
  });

  test("reports a failed archived list read and clears it when the read recovers", async () => {
    const harness = createHarness({ failArchivedFor: new Set(["alpha"]) });
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    harness.emit("/alpha", { type: "snapshot", repoPath: "/alpha", sessions: [] });

    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "unavailable",
      reason: "archived list unavailable for alpha",
    });

    harness.recoverArchived("alpha");

    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: false,
    });
  });

  test("reports a broken workspace session record stream and clears it on recovery", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    harness.emit("/alpha", { type: "snapshot", repoPath: "/alpha", sessions: [] });

    harness.observer.setSessionRecordsError("Workspace Session updates are unavailable.");
    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "unavailable",
      reason: "Workspace Session updates are unavailable.",
    });

    harness.observer.setSessionRecordsError(null);
    expect(harness.observer.getWorkspaceActivity("alpha")).toMatchObject({ kind: "ready" });
  });

  test("stops an observation for a removed workspace and keeps one identity while unchanged", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([
      { workspaceId: "alpha", repoPath: "/alpha" },
      { workspaceId: "beta", repoPath: "/beta" },
    ]);
    await harness.settle();
    harness.emit("/alpha", { type: "snapshot", repoPath: "/alpha", sessions: [] });
    const first = harness.observer.getWorkspaceActivity("alpha");

    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    expect(harness.stopped).toEqual(["/beta"]);
    expect(harness.observer.getWorkspaceActivity("alpha")).toBe(first);
    expect(harness.observer.getWorkspaceActivity("beta")).toEqual({ kind: "unknown" });

    harness.observer.dispose();
    expect(harness.stopped).toEqual(["/beta", "/alpha"]);
  });

  test("observes again after dispose, because StrictMode remounts the same observer", async () => {
    const harness = createHarness();
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    harness.observer.dispose();

    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    harness.emit("/alpha", {
      type: "snapshot",
      repoPath: "/alpha",
      sessions: [snapshot("/alpha", "a", { activity: "running" })],
    });

    expect(harness.observer.getWorkspaceActivity("alpha")).toEqual({
      kind: "ready",
      inputRequired: false,
      error: false,
      active: true,
    });
  });

  test("notifies subscribers when a workspace activity changes", async () => {
    const harness = createHarness();
    let notifications = 0;
    const unsubscribe = harness.observer.subscribe(() => {
      notifications += 1;
    });
    harness.observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
    await harness.settle();
    const before = notifications;

    harness.emit("/alpha", {
      type: "snapshot",
      repoPath: "/alpha",
      sessions: [snapshot("/alpha", "a", { activity: "running" })],
    });

    expect(notifications).toBeGreaterThan(before);
    unsubscribe();
  });
});
