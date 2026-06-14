import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentPendingApprovalRequest,
  type AgentPendingQuestionRequest,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import {
  createAgentSessionCollection,
  getAgentSessionByExternalSessionId,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createSessionMessagesState } from "../support/messages";
import {
  buildRepoSessionReadModel,
  readRepoRuntimeSessionPresence,
  type TaskSessionRecords,
} from "./repo-session-read-model";

type RepoSessionReadModel = ReturnType<typeof buildRepoSessionReadModel>;

const getReadModelSession = (readModel: RepoSessionReadModel, externalSessionId: string) =>
  getAgentSessionByExternalSessionId(readModel.sessionCollection, externalSessionId);

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
  workingDirectory = "/repo/worktree",
}: {
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  pendingApprovals?: AgentPendingApprovalRequest[];
  pendingQuestions?: AgentPendingQuestionRequest[];
  status?: { type: "busy" } | { type: "idle" };
  workingDirectory?: string;
}) =>
  toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref: {
      repoPath: "/repo",
      runtimeKind,
      workingDirectory,
      externalSessionId,
    },
    snapshot: {
      externalSessionId,
      title: `${runtimeKind} session`,
      startedAt: "2026-06-11T08:00:00.000Z",
      status,
      workingDirectory,
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

    const session = getReadModelSession(readModel, record.externalSessionId);
    expect(session?.status).toBe("idle");
    expect(session?.runtimeKind).toBe(runtimeKind);
    expect(session?.pendingQuestions).toEqual([pendingQuestion]);
    expect(readModel.sessionObserverRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind,
        workingDirectory: record.workingDirectory,
      },
    ]);
  });

  test("ignores runtime presence snapshots outside the requested working directories", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          workingDirectory: record.workingDirectory,
          status: { type: "busy" },
        }),
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          workingDirectory: "/repo/other-worktree",
          status: { type: "idle" },
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: presence,
    });

    expect(listAgentSessions(readModel.sessionCollection)).toHaveLength(1);
    expect(getReadModelSession(readModel, record.externalSessionId)?.workingDirectory).toBe(
      record.workingDirectory,
    );
  });

  test("applies a later live runtime snapshot to a previously missing persisted session", async () => {
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
    expect(getReadModelSession(firstRead, record.externalSessionId)?.status).toBe("stopped");

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
      currentSessionCollection: firstRead.sessionCollection,
      runtimePresence: secondPresence,
    });

    expect(getReadModelSession(secondRead, record.externalSessionId)?.status).toBe("running");
    expect(secondRead.sessionObserverRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind: "opencode",
        workingDirectory: record.workingDirectory,
      },
    ]);
  });

  test("preserves mounted transcript state while projecting observer refs", async () => {
    const firstRecord = createRecord({ externalSessionId: "external-1" });
    const secondRecord = createRecord({
      externalSessionId: "external-2",
      startedAt: "2026-06-11T08:01:00.000Z",
    });
    const tasks = [createTask([firstRecord, secondRecord])];
    const firstCurrentSession = {
      ...createAgentSessionFixture({
        externalSessionId: firstRecord.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        startedAt: firstRecord.startedAt,
        workingDirectory: firstRecord.workingDirectory,
        historyLoadState: "not_requested",
      }),
      messages: createSessionMessagesState(firstRecord.externalSessionId, [
        {
          id: "runtime-user-new",
          role: "user",
          content: "Resume after QA rejection",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ]),
    };
    const secondCurrentSession = createAgentSessionFixture({
      externalSessionId: secondRecord.externalSessionId,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      startedAt: secondRecord.startedAt,
      workingDirectory: secondRecord.workingDirectory,
      historyLoadState: "loaded",
    });
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: firstRecord.externalSessionId,
          status: { type: "busy" },
        }),
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: secondRecord.externalSessionId,
          status: { type: "busy" },
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([
        firstCurrentSession,
        secondCurrentSession,
      ]),
      runtimePresence: presence,
    });

    expect(readModel.sessionObserverRefs.map((session) => session.externalSessionId)).toEqual([
      firstRecord.externalSessionId,
      secondRecord.externalSessionId,
    ]);
    const session = getReadModelSession(readModel, firstRecord.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${firstRecord.externalSessionId} to be present.`);
    }
    expect(session.historyLoadState).toBe("not_requested");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Resume after QA rejection",
    ]);
  });

  test("surfaces idle status from initial runtime presence", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
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
      runtimePresence: idlePresence,
    });

    expect(getReadModelSession(idleRead, record.externalSessionId)?.status).toBe("idle");
  });

  test("demotes a mounted active session when runtime presence is missing", async () => {
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
      currentSessionCollection: busyRead.sessionCollection,
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.status).toBe("idle");
    expect(readModel.sessionObserverRefs).toEqual([]);
  });

  test("keeps mounted transcript but clears runtime-owned state when runtime presence is missing", async () => {
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
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session?.status).toBe("idle");
    expect(session?.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Streaming output",
    ]);
    expect(readModel.sessionObserverRefs).toEqual([]);
  });

  test("does not reuse mounted state from a different runtime identity", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const currentSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "codex",
        role: "build",
        status: "running",
        startedAt: record.startedAt,
        workingDirectory: "/repo/other-worktree",
        historyLoadState: "loaded",
      }),
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "wrong-runtime-message",
          role: "assistant",
          content: "Output from a different runtime identity",
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
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session.status).toBe("stopped");
    expect(session.runtimeKind).toBe(record.runtimeKind);
    expect(session.workingDirectory).toBe(record.workingDirectory);
    expect(session.historyLoadState).toBe("not_requested");
    expect(sessionMessagesToArray(session)).toEqual([]);
    expect(readModel.sessionObserverRefs).toEqual([]);
  });

  test("preserves mounted transcript for an equivalent normalized working directory", async () => {
    const record = createRecord({ workingDirectory: "/repo/worktree" });
    const tasks = [createTask([record])];
    const currentSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        startedAt: record.startedAt,
        workingDirectory: "/repo/worktree/",
        historyLoadState: "loaded",
      }),
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "mounted-message",
          role: "assistant",
          content: "Mounted transcript",
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
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session.status).toBe("idle");
    expect(session.workingDirectory).toBe(record.workingDirectory);
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Mounted transcript",
    ]);
  });

  test("uses the persisted selected model instead of stale mounted model state", async () => {
    const record = createRecord({ selectedModel: null });
    const tasks = [createTask([record])];
    const currentSession = createAgentSessionFixture({
      externalSessionId: record.externalSessionId,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      startedAt: record.startedAt,
      workingDirectory: record.workingDirectory,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "stale-provider",
        modelId: "stale-model",
      },
    });
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.selectedModel).toBeNull();
  });

  test("applies runtime status and pending input without dropping mounted transcript state", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const currentSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "idle",
        startedAt: record.startedAt,
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
      }),
      pendingQuestions: [
        {
          requestId: "current-question",
          questions: [],
        },
      ],
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "existing-message",
          role: "assistant",
          content: "Mounted transcript",
          timestamp: "2026-06-11T08:00:01.000Z",
        },
      ]),
    };
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "busy" },
          pendingQuestions: [],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session?.status).toBe("running");
    expect(session?.pendingQuestions).toEqual([]);
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Mounted transcript",
    ]);
  });

  test("lets idle runtime presence demote a mounted running session", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const currentSession = createAgentSessionFixture({
      externalSessionId: record.externalSessionId,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      startedAt: record.startedAt,
      workingDirectory: record.workingDirectory,
      historyLoadState: "loaded",
    });
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          status: { type: "idle" },
          pendingQuestions: [],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.status).toBe("idle");
  });

  test("lets missing runtime presence demote mounted idle session state", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const currentSession = createAgentSessionFixture({
      externalSessionId: record.externalSessionId,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "idle",
      startedAt: record.startedAt,
      workingDirectory: record.workingDirectory,
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
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.status).toBe("idle");
    expect(readModel.sessionObserverRefs).toEqual([]);
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
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, currentSession.externalSessionId)).toBeNull();
    expect(readModel.sessionObserverRefs).toEqual([]);
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
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, currentSession.externalSessionId)).toBe(currentSession);
  });

  test("surfaces idle pending input and idle status from initial runtime presence", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
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
      runtimePresence: idlePresence,
    });

    const session = getReadModelSession(idleRead, record.externalSessionId);
    expect(session?.status).toBe("idle");
    expect(session?.pendingQuestions).toEqual([pendingQuestion]);
  });

  test("keeps pending input in runtime presence order", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const firstQuestion = { requestId: "question-1", questions: [] };
    const secondQuestion = { requestId: "question-2", questions: [] };
    const presence = await readRepoRuntimeSessionPresence({
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

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.pendingQuestions).toEqual([
      secondQuestion,
      firstQuestion,
    ]);
  });

  test("keeps pending input details from initial runtime presence", async () => {
    const record = createRecord();
    const tasks = [createTask([record])];
    const question = {
      requestId: "question-1",
      questions: [
        {
          header: "Updated",
          question: "Updated question?",
          options: [{ label: "B", description: "Answer B" }],
        },
      ],
    };
    const presence = await readRepoRuntimeSessionPresence({
      repoPath: "/repo",
      tasks,
      listSessionPresence: async () => [
        createPresence({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [question],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimePresence: presence,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.pendingQuestions).toEqual([
      question,
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
