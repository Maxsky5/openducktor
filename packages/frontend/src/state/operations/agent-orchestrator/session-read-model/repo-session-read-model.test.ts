import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentPendingApprovalRequest,
  type AgentPendingQuestionRequest,
  toAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import {
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createSessionMessagesState } from "../support/messages";
import { readRepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import { buildRepoSessionReadModel } from "./repo-session-read-model";
import type { TaskSessionRecords } from "./task-session-records";

type RepoSessionReadModel = ReturnType<typeof buildRepoSessionReadModel>;

const getReadModelSession = (readModel: RepoSessionReadModel, externalSessionId: string) =>
  listAgentSessions(readModel.sessionCollection).find(
    (session) => session.externalSessionId === externalSessionId,
  ) ?? null;

const createRecord = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-11T08:00:00.000Z",
  selectedModel: null,
  ...overrides,
});

const createTaskSessionRecords = (
  agentSessions: AgentSessionRecord[],
  overrides: Partial<TaskSessionRecords> = {},
): TaskSessionRecords => ({
  taskIds: ["task-1"],
  records: agentSessions.map((record) => ({ taskId: "task-1", record })),
  ...overrides,
});

const createRuntimeSnapshot = ({
  runtimeKind,
  externalSessionId,
  pendingApprovals = [],
  pendingQuestions = [],
  runtimeActivity = "running",
  workingDirectory = "/repo/worktree",
}: {
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  pendingApprovals?: AgentPendingApprovalRequest[];
  pendingQuestions?: AgentPendingQuestionRequest[];
  runtimeActivity?: "running" | "idle";
  workingDirectory?: string;
}) =>
  toAgentSessionRuntimeSnapshot({
    ref: {
      repoPath: "/repo",
      runtimeKind,
      workingDirectory,
      externalSessionId,
    },
    snapshot: {
      title: `${runtimeKind} session`,
      startedAt: "2026-06-11T08:00:00.000Z",
      runtimeActivity,
      pendingApprovals,
      pendingQuestions,
    },
  });

describe("repo session read model", () => {
  test.each([
    "opencode",
    "codex",
  ] as const)("restores %s waiting-input sessions from live runtime snapshot", async (runtimeKind) => {
    const record = createRecord({ runtimeKind });
    const tasks = createTaskSessionRecords([record]);
    const pendingQuestion = { requestId: `${runtimeKind}-question`, questions: [] };
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind,
          externalSessionId: record.externalSessionId,
          pendingQuestions: [pendingQuestion],
          runtimeActivity: "idle",
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: runtimeSnapshots,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    expect(session?.status).toBe("idle");
    expect(session?.runtimeKind).toBe(runtimeKind);
    expect(session?.pendingQuestions).toEqual([pendingQuestion]);
    expect(readModel.liveSessionRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind,
        workingDirectory: record.workingDirectory,
      },
    ]);
  });

  test("ignores runtime snapshots outside the requested working directories", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          workingDirectory: record.workingDirectory,
          runtimeActivity: "running",
        }),
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          workingDirectory: "/repo/other-worktree",
          runtimeActivity: "idle",
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(listAgentSessions(readModel.sessionCollection)).toHaveLength(1);
    expect(getReadModelSession(readModel, record.externalSessionId)?.workingDirectory).toBe(
      record.workingDirectory,
    );
  });

  test("applies a later live runtime snapshot to a previously missing persisted session", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    const firstRuntimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });
    const firstRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: firstRuntimeSnapshots,
    });
    expect(getReadModelSession(firstRead, record.externalSessionId)?.status).toBe("idle");

    const secondRuntimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          runtimeActivity: "running",
        }),
      ],
    });
    const secondRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: firstRead.sessionCollection,
      runtimeSnapshots: secondRuntimeSnapshots,
    });

    expect(getReadModelSession(secondRead, record.externalSessionId)?.status).toBe("running");
    expect(secondRead.liveSessionRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind: "opencode",
        workingDirectory: record.workingDirectory,
      },
    ]);
  });

  test("preserves mounted transcript state while projecting live session refs", async () => {
    const firstRecord = createRecord({ externalSessionId: "external-1" });
    const secondRecord = createRecord({
      externalSessionId: "external-2",
      startedAt: "2026-06-11T08:01:00.000Z",
    });
    const tasks = createTaskSessionRecords([firstRecord, secondRecord]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: firstRecord.externalSessionId,
          runtimeActivity: "running",
        }),
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: secondRecord.externalSessionId,
          runtimeActivity: "running",
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
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(readModel.liveSessionRefs.map((session) => session.externalSessionId)).toEqual([
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

  test("removes current sessions for loaded tasks when durable records no longer contain them", async () => {
    const removedSession = createAgentSessionFixture({
      externalSessionId: "removed-session",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      startedAt: "2026-06-11T08:00:00.000Z",
      workingDirectory: "/repo/removed-worktree",
    });
    const otherTaskSession = createAgentSessionFixture({
      externalSessionId: "other-task-session",
      taskId: "task-2",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      startedAt: "2026-06-11T08:00:00.000Z",
      workingDirectory: "/repo/other-worktree",
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks: createTaskSessionRecords([]),
      currentSessionCollection: createAgentSessionCollection([removedSession, otherTaskSession]),
      runtimeSnapshots: new Map(),
    });

    expect(getReadModelSession(readModel, removedSession.externalSessionId)).toBeNull();
    expect(getReadModelSession(readModel, otherTaskSession.externalSessionId)).toBe(
      otherTaskSession,
    );
    expect(readModel.unlistedSessionRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: removedSession.externalSessionId,
        runtimeKind: removedSession.runtimeKind,
        workingDirectory: removedSession.workingDirectory,
      },
    ]);
  });

  test("surfaces idle status from initial runtime snapshot", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    const idleRuntimeSnapshot = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          runtimeActivity: "idle",
        }),
      ],
    });

    const idleRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: idleRuntimeSnapshot,
    });

    expect(getReadModelSession(idleRead, record.externalSessionId)?.status).toBe("idle");
  });

  test("settles a mounted active session when runtime snapshot is missing", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    const busyRuntimeSnapshot = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          runtimeActivity: "running",
        }),
      ],
    });
    const busyRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: busyRuntimeSnapshot,
    });
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: busyRead.sessionCollection,
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.status).toBe("idle");
    expect(readModel.liveSessionRefs).toEqual([]);
  });

  test("settles unobserved mounted active state when runtime snapshot is missing", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
      pendingUserMessageStartedAt: 123,
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "existing-message",
          role: "assistant",
          content: "Already visible",
          timestamp: "2026-06-11T08:00:01.000Z",
        },
      ]),
    };
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session.status).toBe("idle");
    expect(session.pendingUserMessageStartedAt).toBeUndefined();
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Already visible",
    ]);
    expect(readModel.liveSessionRefs).toEqual([]);
  });

  test("settles mounted live turn state without clearing transcript when runtime snapshot is missing", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
      pendingUserMessageStartedAt: 123,
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "existing-message",
          role: "assistant",
          content: "Streaming output",
          timestamp: "2026-06-11T08:00:01.000Z",
        },
      ]),
    };
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    const session = getReadModelSession(readModel, record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session?.status).toBe("idle");
    expect(session?.historyLoadState).toBe("loaded");
    expect(session?.pendingUserMessageStartedAt).toBeUndefined();
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Streaming output",
    ]);
    expect(readModel.liveSessionRefs).toEqual([]);
  });

  test("removes mounted state from a different runtime identity when records do not contain it", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    const session = getAgentSession(readModel.sessionCollection, record);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be present.`);
    }
    expect(session.status).toBe("idle");
    expect(session.runtimeKind).toBe(record.runtimeKind);
    expect(session.workingDirectory).toBe(record.workingDirectory);
    expect(session.historyLoadState).toBe("not_requested");
    expect(sessionMessagesToArray(session)).toEqual([]);
    expect(getAgentSession(readModel.sessionCollection, currentSession)).toBeNull();
    expect(readModel.unlistedSessionRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: currentSession.externalSessionId,
        runtimeKind: currentSession.runtimeKind,
        workingDirectory: currentSession.workingDirectory,
      },
    ]);
    expect(readModel.liveSessionRefs).toEqual([]);
  });

  test("preserves mounted transcript and settles status for an equivalent normalized working directory", async () => {
    const record = createRecord({ workingDirectory: "/repo/worktree" });
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
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
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.selectedModel).toBeNull();
  });

  test("applies runtime status and pending input without dropping mounted transcript state", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          runtimeActivity: "running",
          pendingQuestions: [],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
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

  test("lets idle runtime snapshot demote a mounted running session", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          runtimeActivity: "idle",
          pendingQuestions: [],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.status).toBe("idle");
  });

  test("keeps mounted idle state when runtime snapshot is missing", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.status).toBe("idle");
    expect(readModel.liveSessionRefs).toEqual([]);
  });

  test("uses loaded empty task session records to surface unlisted local sessions", async () => {
    const tasks = createTaskSessionRecords([]);
    const currentSession = {
      ...createAgentSessionFixture({
        externalSessionId: "local-session",
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, currentSession.externalSessionId)).toBeNull();
    expect(readModel.unlistedSessionRefs).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: currentSession.externalSessionId,
        runtimeKind: currentSession.runtimeKind,
        workingDirectory: currentSession.workingDirectory,
      },
    ]);
    expect(readModel.liveSessionRefs).toEqual([]);
  });

  test("keeps local starting sessions while their persisted record is not visible yet", async () => {
    const tasks = createTaskSessionRecords([]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      currentSessionCollection: createAgentSessionCollection([currentSession]),
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, currentSession.externalSessionId)).toBe(currentSession);
  });

  test("surfaces idle pending input and idle status from initial runtime snapshot", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    const pendingQuestion = { requestId: "question-1", questions: [] };
    const idleRuntimeSnapshot = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [pendingQuestion],
          runtimeActivity: "idle",
        }),
      ],
    });

    const idleRead = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: idleRuntimeSnapshot,
    });

    const session = getReadModelSession(idleRead, record.externalSessionId);
    expect(session?.status).toBe("idle");
    expect(session?.pendingQuestions).toEqual([pendingQuestion]);
  });

  test("keeps pending input in runtime snapshot order", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    const firstQuestion = { requestId: "question-1", questions: [] };
    const secondQuestion = { requestId: "question-2", questions: [] };
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [secondQuestion, firstQuestion],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.pendingQuestions).toEqual([
      secondQuestion,
      firstQuestion,
    ]);
  });

  test("keeps pending input details from initial runtime snapshot", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
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
    const runtimeSnapshots = await readRepoRuntimeSessionSnapshots({
      repoPath: "/repo",
      tasks,
      listSessionRuntimeSnapshots: async () => [
        createRuntimeSnapshot({
          runtimeKind: "opencode",
          externalSessionId: record.externalSessionId,
          pendingQuestions: [question],
        }),
      ],
    });

    const readModel = buildRepoSessionReadModel({
      repoPath: "/repo",
      tasks,
      runtimeSnapshots: runtimeSnapshots,
    });

    expect(getReadModelSession(readModel, record.externalSessionId)?.pendingQuestions).toEqual([
      question,
    ]);
  });

  test("propagates runtime scan failures instead of committing a stale session model", async () => {
    const record = createRecord();
    const tasks = createTaskSessionRecords([record]);
    await expect(
      readRepoRuntimeSessionSnapshots({
        repoPath: "/repo",
        tasks,
        listSessionRuntimeSnapshots: async () => {
          throw new Error("runtime not ready");
        },
      }),
    ).rejects.toThrow("runtime not ready");
  });
});
