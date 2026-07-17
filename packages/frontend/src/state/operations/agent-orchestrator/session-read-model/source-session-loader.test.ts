import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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
    getSessionSnapshot: (identity: Parameters<AgentSessionsStore["getSessionSnapshot"]>[0]) =>
      getAgentSession(sessionCollection, identity),
    collection: () => sessionCollection,
  };
};

const createLoaderHarness = ({
  initialSessionCollection,
  records = [record],
  loadRecords,
}: {
  initialSessionCollection?: AgentSessionCollection;
  records?: AgentSessionRecord[];
  loadRecords?: (taskId: string) => Promise<AgentSessionRecord[]>;
} = {}) => {
  const queryClient = new QueryClient();
  const collection = createCommitSessionCollection(initialSessionCollection);
  const persistedSessionReads: string[] = [];

  host.agentSessionsList = async (_repoPath, taskId) => {
    persistedSessionReads.push(taskId);
    return loadRecords ? loadRecords(taskId) : records;
  };

  const loadSourceSession = createLoadSourceSession({
    workspaceRepoPath: "/repo",
    repoEpochRef: { current: 0 },
    currentWorkspaceRepoPathRef: { current: "/repo" },
    readSessionSnapshot: collection.getSessionSnapshot,
    queryClient,
  });

  return {
    ...collection,
    loadSourceSession,
    persistedSessionReads,
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

  test("returns exactly the requested source session from the ordered projection", async () => {
    const attachedSession = createAgentSessionFixture({
      externalSessionId: record.externalSessionId,
      taskId: "task-1",
      role: record.role,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
      startedAt: record.startedAt,
      status: "running",
    });
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([attachedSession]),
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
    expect(harness.getSession(record.externalSessionId)).toBe(session);
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
    expect(harness.getSession(record.externalSessionId)).toBeNull();
  });

  test("preserves the attachment-owned session and mounted transcript data", async () => {
    const mountedSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        role: "build",
        runtimeKind: "opencode",
        status: "running",
        startedAt: record.startedAt,
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

    expect(session).toBe(mountedSession);
    expect(session?.messages).toBe(mountedSession.messages);
  });

  test("returns null while the ordered projection does not contain the source session", async () => {
    const harness = createLoaderHarness();

    const session = await harness.loadSourceSession({
      taskId: "task-1",
      role: "build",
      sourceSession,
    });

    expect(session).toBeNull();
  });

  test("reads the attachment-owned session committed while persisted records are loading", async () => {
    let resolveRecords!: (records: AgentSessionRecord[]) => void;
    let markRecordReadStarted: (() => void) | null = null;
    const recordReadStarted = new Promise<void>((resolve) => {
      markRecordReadStarted = resolve;
    });
    const delayedRecords = new Promise<AgentSessionRecord[]>((resolve) => {
      resolveRecords = resolve;
    });
    const initialSession = createAgentSessionFixture({
      externalSessionId: record.externalSessionId,
      taskId: "task-1",
      role: "build",
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
      status: "idle",
    });
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([initialSession]),
      loadRecords: async () => {
        markRecordReadStarted?.();
        return delayedRecords;
      },
    });

    const loading = harness.loadSourceSession({
      taskId: "task-1",
      role: "build",
      sourceSession,
    });
    await recordReadStarted;

    const attachmentSession: AgentSessionState = {
      ...initialSession,
      status: "running",
      pendingApprovals: [
        {
          requestId: "attachment-request",
          requestType: "command_execution",
          title: "Run current command",
        },
      ],
      contextUsage: { totalTokens: 321 },
    };
    harness.commitSessionCollection(() => ({
      collection: createAgentSessionCollection([attachmentSession]),
      result: undefined,
    }));
    resolveRecords([record]);

    const loaded = await loading;

    expect(loaded).toBe(attachmentSession);
    expect(harness.getSession(record.externalSessionId)).toBe(attachmentSession);
    expect(loaded?.pendingApprovals).toEqual([
      expect.objectContaining({ requestId: "attachment-request" }),
    ]);
    expect(loaded?.contextUsage).toEqual({ totalTokens: 321 });
  });
});
