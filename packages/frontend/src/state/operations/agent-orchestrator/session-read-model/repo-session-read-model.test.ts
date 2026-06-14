import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentPendingApprovalRequest,
  type AgentPendingQuestionRequest,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createSessionMessagesState } from "../support/messages";
import {
  buildRepoSessionReadModel,
  readRepoRuntimeSessionPresence,
  type TaskSessionRecords,
} from "./repo-session-read-model";

const createRecord = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-11T08:00:00.000Z",
  selectedModel: null,
  ...overrides,
});

const createTask = (
  agentSessions: AgentSessionRecord[],
  overrides: Partial<TaskSessionRecords> = {},
): TaskSessionRecords => ({
  id: "task-1",
  agentSessions,
  ...overrides,
});

const createPresence = ({
  runtimeKind,
  externalSessionId,
  pendingApprovals = [],
  pendingQuestions = [],
  status = { type: "busy" as const },
}: {
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  pendingApprovals?: AgentPendingApprovalRequest[];
  pendingQuestions?: AgentPendingQuestionRequest[];
  status?: { type: "busy" } | { type: "idle" };
}) =>
  toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref: {
      repoPath: "/repo",
      runtimeKind,
      workingDirectory: "/repo/worktree",
      externalSessionId,
    },
    snapshot: {
      externalSessionId,
      title: `${runtimeKind} session`,
      startedAt: "2026-06-11T08:00:00.000Z",
      status,
      workingDirectory: "/repo/worktree",
      pendingApprovals,
      pendingQuestions,
    },
  });

describe("repo session read model", () => {
  test.each([
    "opencode",
    "codex",
  ] as const)("restores %s waiting-input sessions from live runtime presence", async (runtimeKind) => {
    const record = createRecord({ runtimeKind });
    const tasks = [createTask([record])];
    const pendingQuestion = { requestId: `${runtimeKind}-question`, questions: [] };
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind,
          externalSessionId: record.externalSessionId,
          pendingQuestions: [pendingQuestion],
          status: { type: "idle" },
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: presence,
    });

    const session = readModel.sessionsById[record.externalSessionId];
    expect(session?.status).toBe("idle");
    expect(session?.runtimeKind).toBe(runtimeKind);
    expect(session?.pendingQuestions).toEqual([pendingQuestion]);
    expect(readModel.liveSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind,
        workingDirectory: record.workingDirectory,
      },
    ]);
  });

  test("a later read can restore an active session after an earlier scan missed it", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const firstPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [],
    });
    const firstRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: firstPresence,
    });
    expect(firstRead.sessionsById[record.externalSessionId]?.status).toBe("stopped");

    const secondPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "busy" },
        }),
      ],
    });
    const secondRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: firstRead.sessionsById,
      runtimePresence: secondPresence,
    });

    expect(secondRead.sessionsById[record.externalSessionId]?.status).toBe("running");
    expect(secondRead.liveSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind: "opencode",
        workingDirectory: record.workingDirectory,
      },
    ]);
  });

  test("surfaces idle status when runtime presence is idle without pending input", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const busyPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "busy" },
        }),
      ],
    });
    const busyRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: busyPresence,
    });
    const idlePresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "idle" },
        }),
      ],
    });

    const idleRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: busyRead.sessionsById,
      runtimePresence: idlePresence,
    });

    expect(idleRead.sessionsById[record.externalSessionId]?.status).toBe("idle");
  });

  test("preserves a mounted active session when a repo runtime scan misses it", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const busyPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "busy" },
        }),
      ],
    });
    const busyRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: busyPresence,
    });
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: busyRead.sessionsById,
      runtimePresence: presence,
    });

    expect(readModel.sessionsById[record.externalSessionId]?.status).toBe("running");
  });

  test("preserves an already mounted live session instead of rebuilding from its thin record", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const currentSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        startedAt: record.startedAt,
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
      }),
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "existing-message",
          role: "assistant",
          content: "Streaming output",
          timestamp: "2026-06-11T08:00:01.000Z",
        },
      ]),
    };
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: {
        [record.externalSessionId]: currentSession,
      },
      runtimePresence: presence,
    });

    const session = readModel.sessionsById[record.externalSessionId];
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session?.status).toBe("running");
    expect(session?.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Streaming output",
    ]);
  });

  test("drops local task sessions that are no longer present in persisted task records", async () => {
    const tasks = [createTask([])];
    const currentSession = {
      ...createAgentSessionFixture({
        externalSessionId: "orphan-session",
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        startedAt: "2026-06-11T08:00:00.000Z",
        workingDirectory: "/repo/worktree",
        historyLoadState: "loaded",
      }),
      messages: createSessionMessagesState("orphan-session", [
        {
          id: "stale-message",
          role: "assistant",
          content: "Stale output from before reset",
          timestamp: "2026-06-11T08:00:01.000Z",
        },
      ]),
    };
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: {
        [currentSession.externalSessionId]: currentSession,
      },
      runtimePresence: presence,
    });

    expect(readModel.sessionsById[currentSession.externalSessionId]).toBeUndefined();
    expect(readModel.liveSessions).toEqual([]);
  });

  test("keeps local starting sessions while their persisted record is not visible yet", async () => {
    const tasks = [createTask([])];
    const currentSession = createAgentSessionFixture({
      externalSessionId: "starting-session",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "starting",
      startedAt: "2026-06-11T08:00:00.000Z",
      workingDirectory: "/repo/worktree",
      historyLoadState: "loaded",
    });
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: {
        [currentSession.externalSessionId]: currentSession,
      },
      runtimePresence: presence,
    });

    expect(readModel.sessionsById[currentSession.externalSessionId]).toBe(currentSession);
  });

  test("surfaces idle pending input and idle status from runtime presence", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const busyPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "busy" },
        }),
      ],
    });
    const busyRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: busyPresence,
    });
    const pendingQuestion = { requestId: "question-1", questions: [] };
    const idlePresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [pendingQuestion],
          status: { type: "idle" },
        }),
      ],
    });

    const idleRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: busyRead.sessionsById,
      runtimePresence: idlePresence,
    });

    const session = idleRead.sessionsById[record.externalSessionId];
    expect(session?.status).toBe("idle");
    expect(session?.pendingQuestions).toEqual([pendingQuestion]);
  });

  test("keeps pending input in runtime presence order", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const firstQuestion = { requestId: "question-1", questions: [] };
    const secondQuestion = { requestId: "question-2", questions: [] };
    const firstPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [firstQuestion, secondQuestion],
        }),
      ],
    });
    const firstRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: firstPresence,
    });
    const secondPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [secondQuestion, firstQuestion],
        }),
      ],
    });

    const secondRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: firstRead.sessionsById,
      runtimePresence: secondPresence,
    });

    expect(secondRead.sessionsById[record.externalSessionId]?.pendingQuestions).toEqual([
      secondQuestion,
      firstQuestion,
    ]);
  });

  test("updates pending input when the same request id carries new runtime details", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const firstQuestion = {
      requestId: "question-1",
      questions: [
        {
          header: "Old",
          question: "Old question?",
          options: [{ label: "A", description: "Answer A" }],
        },
      ],
    };
    const updatedQuestion = {
      requestId: "question-1",
      questions: [
        {
          header: "Updated",
          question: "Updated question?",
          options: [{ label: "B", description: "Answer B" }],
        },
      ],
    };
    const firstPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [firstQuestion],
        }),
      ],
    });
    const firstRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: firstPresence,
    });
    const currentSession = firstRead.sessionsById[record.externalSessionId];
    if (!currentSession) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    const secondPresence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [updatedQuestion],
        }),
      ],
    });

    const secondRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionsById: firstRead.sessionsById,
      runtimePresence: secondPresence,
    });

    expect(secondRead.sessionsById[record.externalSessionId]).not.toBe(currentSession);
    expect(secondRead.sessionsById[record.externalSessionId]?.pendingQuestions).toEqual([
      updatedQuestion,
    ]);
  });

  test("propagates runtime scan failures instead of committing a stale stopped model", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    await expect(
      readRepoRuntimeSessionPresence({
        repoPath: "/repo",
        tasks,
        listSessionPresence: async () => {
          throw new Error("runtime not ready");
        },
      }),
    ).rejects.toThrow("runtime not ready");
  });
});
