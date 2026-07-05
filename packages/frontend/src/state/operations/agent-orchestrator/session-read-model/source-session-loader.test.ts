import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  AgentSessionRuntimeSnapshot,
  PolicyBoundSessionRef,
  SessionRef,
} from "@openducktor/core";
import {
  toAgentSessionRuntimeSnapshot,
  toMissingAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../../host";
import { createSessionMessagesState } from "../support/messages";
import { createLoadSourceSession } from "./source-session-loader";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const sourceSession = {
  externalSessionId: record.externalSessionId,
  runtimeKind: record.runtimeKind,
  workingDirectory: record.workingDirectory,
};

const runtimeSnapshot = (
  ref: SessionRef,
  runtimeActivity: "running" | "idle" = "running",
): AgentSessionRuntimeSnapshot =>
  toAgentSessionRuntimeSnapshot({
    ref,
    snapshot: {
      title: "Builder",
      startedAt: "2026-06-12T08:00:00.000Z",
      runtimeActivity,
      pendingApprovals: [],
      pendingQuestions: [],
    },
  });

const createCommitSessionCollection = (
  initialSessionCollection = emptyAgentSessionCollection(),
) => {
  let sessionCollection = initialSessionCollection;

  return {
    commitSessionCollection: ((commit) => {
      const { collection, result } = commit(sessionCollection);
      sessionCollection = collection;
      return result;
    }) satisfies AgentSessionsStore["commitSessionCollection"],
    getSession: (externalSessionId: string) =>
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === externalSessionId,
      ) ?? null,
    collection: () => sessionCollection,
  };
};

const createLoaderHarness = ({
  initialSessionCollection,
  records = [record],
  readSessionRuntimeSnapshot = async (ref: SessionRef) => runtimeSnapshot(ref),
}: {
  initialSessionCollection?: AgentSessionCollection;
  records?: AgentSessionRecord[];
  readSessionRuntimeSnapshot?: (ref: SessionRef) => Promise<AgentSessionRuntimeSnapshot>;
} = {}) => {
  const queryClient = new QueryClient();
  const collection = createCommitSessionCollection(initialSessionCollection);
  const observedSessions: PolicyBoundSessionRef[] = [];
  const runtimeSnapshotReads: SessionRef[] = [];
  const persistedSessionReads: string[] = [];

  host.agentSessionsList = async (_repoPath, taskId) => {
    persistedSessionReads.push(taskId);
    return records;
  };

  const loadSourceSession = createLoadSourceSession({
    workspaceRepoPath: "/repo",
    adapter: {
      readSessionRuntimeSnapshot: async (ref) => {
        runtimeSnapshotReads.push(ref);
        return readSessionRuntimeSnapshot(ref);
      },
    },
    repoEpochRef: { current: 0 },
    currentWorkspaceRepoPathRef: { current: "/repo" },
    commitSessionCollection: collection.commitSessionCollection,
    observeAgentSession: async (session) => {
      observedSessions.push(session);
    },
    queryClient,
  });

  return {
    ...collection,
    loadSourceSession,
    observedSessions,
    persistedSessionReads,
    runtimeSnapshotReads,
  };
};

describe("source session loader", () => {
  let originalAgentSessionsList: typeof host.agentSessionsList;

  beforeEach(() => {
    originalAgentSessionsList = host.agentSessionsList;
  });

  afterEach(() => {
    host.agentSessionsList = originalAgentSessionsList;
  });

  test("loads exactly the requested persisted source session and runtime snapshot", async () => {
    const harness = createLoaderHarness({
      records: [
        { ...record, externalSessionId: "other-session" },
        record,
        { ...record, role: "planner" },
      ],
    });

    const session = await harness.loadSourceSession({
      taskId: "task-1",
      role: "build",
      sourceSession,
    });

    expect(session).toEqual(
      expect.objectContaining({
        externalSessionId: record.externalSessionId,
        status: "running",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    );
    expect(harness.persistedSessionReads).toEqual(["task-1"]);
    expect(harness.runtimeSnapshotReads).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind: "opencode",
        workingDirectory: record.workingDirectory,
      },
    ]);
    expect(harness.getSession(record.externalSessionId)).toBe(session);
    expect(harness.observedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind: "opencode",
        workingDirectory: record.workingDirectory,
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
    ]);
  });

  test("returns null when the persisted record does not match the source identity and role", async () => {
    const harness = createLoaderHarness({
      records: [
        { ...record, externalSessionId: "other-session" },
        { ...record, role: "planner" },
      ],
    });

    await expect(
      harness.loadSourceSession({
        taskId: "task-1",
        role: "build",
        sourceSession,
      }),
    ).resolves.toBeNull();
    expect(harness.runtimeSnapshotReads).toEqual([]);
    expect(harness.getSession(record.externalSessionId)).toBeNull();
  });

  test("preserves mounted transcript data while replacing durable persisted fields", async () => {
    const mountedSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "old-task",
        role: "planner",
        runtimeKind: "opencode",
        status: "running",
        startedAt: "2026-06-11T08:00:00.000Z",
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
      }),
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "existing-message",
          role: "assistant",
          content: "Already visible",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ]),
    };
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([mountedSession]),
    });

    const session = await harness.loadSourceSession({
      taskId: "task-1",
      role: "build",
      sourceSession,
    });

    expect(session).toEqual(
      expect.objectContaining({
        taskId: "task-1",
        role: "build",
        startedAt: record.startedAt,
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
      }),
    );
    expect(session?.messages).toBe(mountedSession.messages);
  });

  test("settles a missing runtime snapshot to idle without observing it", async () => {
    const harness = createLoaderHarness({
      readSessionRuntimeSnapshot: async (ref) => toMissingAgentSessionRuntimeSnapshot(ref),
    });

    const session = await harness.loadSourceSession({
      taskId: "task-1",
      role: "build",
      sourceSession,
    });

    expect(session?.status).toBe("idle");
    expect(harness.observedSessions).toEqual([]);
  });
});
