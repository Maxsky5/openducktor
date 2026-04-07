import { describe, expect, test } from "bun:test";
import type { TaskPersistencePort } from "./beads-persistence";
import type { PublicTask, RawIssue, TaskCard } from "./contracts";
import { OdtTaskStore } from "./odt-task-store";
import type { TaskDocumentPort } from "./task-document-store";

const makeTask = (): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "open",
  issueType: "feature",
  aiReviewEnabled: true,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
});

describe("OdtTaskStore composition", () => {
  test("uses injected ports and persistence namespace for read mapping", async () => {
    const issue: RawIssue = {
      id: "task-1",
      title: "Task 1",
      description: "Read the task description from Beads.",
      status: "open",
      priority: 2,
      issue_type: "feature",
      labels: [],
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
      metadata: {
        custom_ns: {
          qaRequired: false,
        },
      },
    };

    const persistence: TaskPersistencePort = {
      metadataNamespace: "custom_ns",
      ensureInitialized: async () => {},
      runBdJson: async () => {
        throw new Error("runBdJson should not be called by readTask");
      },
      createTask: async () => {
        throw new Error("createTask should not be called by readTask");
      },
      listRawIssues: async () => [issue],
      listTasks: async () => [makeTask()],
      showRawIssue: async () => issue,
      getNamespaceData: () => {
        throw new Error("getNamespaceData should not be called by readTask");
      },
      updateTask: async () => {
        throw new Error("updateTask should not be called by readTask");
      },
      writeNamespace: async () => {
        throw new Error("writeNamespace should not be called by readTask");
      },
    };

    const documentStore: TaskDocumentPort = {
      summarize: () => ({
        qaVerdict: null,
        documents: {
          hasSpec: true,
          hasPlan: true,
          hasQaReport: false,
        },
      }),
      readDocuments: () => ({ documents: {} }),
      prepareQaReportWrite: () => ({
        metadataRoot: {},
        namespace: {},
        root: {},
      }),
      persistSpec: async () => ({ issue, updatedAt: "", revision: 1 }),
      persistImplementationPlan: async () => ({ issue, updatedAt: "", revision: 1 }),
      appendQaReport: async () => {},
    };

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "wrong_namespace",
        beadsDir: "/beads",
      },
      {
        persistence,
        documentStore,
      },
    );

    const result = (await store.readTask({ taskId: "task-1" })) as {
      task: PublicTask;
      qaVerdict: null;
      documents: { hasSpec: boolean; hasPlan: boolean; hasQaReport: boolean };
    };

    expect(result.task.aiReviewEnabled).toBe(false);
    expect(result.task.description).toBe("Read the task description from Beads.");
    expect(result.task.priority).toBe(2);
    expect(result.documents).toEqual({ hasSpec: true, hasPlan: true, hasQaReport: false });
  });

  test("readTask surfaces invalid Beads issue types from showRawIssue", async () => {
    const issue: RawIssue = {
      id: "task-1",
      title: "Task 1",
      status: "open",
      priority: 2,
      issue_type: "decision",
      labels: [],
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
      metadata: {},
    };

    const persistence: TaskPersistencePort = {
      metadataNamespace: "openducktor",
      ensureInitialized: async () => {},
      runBdJson: async () => {
        throw new Error("runBdJson should not be called by readTask");
      },
      createTask: async () => {
        throw new Error("createTask should not be called by readTask");
      },
      listRawIssues: async () => [issue],
      listTasks: async () => [makeTask()],
      showRawIssue: async () => issue,
      getNamespaceData: () => {
        throw new Error("getNamespaceData should not be called by readTask");
      },
      updateTask: async () => {
        throw new Error("updateTask should not be called by readTask");
      },
      writeNamespace: async () => {
        throw new Error("writeNamespace should not be called by readTask");
      },
    };

    const documentStore: TaskDocumentPort = {
      summarize: () => ({
        qaVerdict: null,
        documents: {
          hasSpec: false,
          hasPlan: false,
          hasQaReport: false,
        },
      }),
      readDocuments: () => ({ documents: {} }),
      prepareQaReportWrite: () => ({
        metadataRoot: {},
        namespace: {},
        root: {},
      }),
      persistSpec: async () => ({ issue, updatedAt: "", revision: 1 }),
      persistImplementationPlan: async () => ({ issue, updatedAt: "", revision: 1 }),
      appendQaReport: async () => {},
    };

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      {
        persistence,
        documentStore,
      },
    );

    await expect(store.readTask({ taskId: "task-1" })).rejects.toThrow(
      'Invalid Beads issue type for task task-1: received "decision".',
    );
  });

  test("readTask surfaces invalid Beads statuses from showRawIssue", async () => {
    const issue: RawIssue = {
      id: "task-1",
      title: "Task 1",
      status: null,
      priority: 2,
      issue_type: "feature",
      labels: [],
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
      metadata: {},
    };

    const persistence: TaskPersistencePort = {
      metadataNamespace: "openducktor",
      ensureInitialized: async () => {},
      runBdJson: async () => {
        throw new Error("runBdJson should not be called by readTask");
      },
      createTask: async () => {
        throw new Error("createTask should not be called by readTask");
      },
      listRawIssues: async () => [issue],
      listTasks: async () => [makeTask()],
      showRawIssue: async () => issue,
      getNamespaceData: () => {
        throw new Error("getNamespaceData should not be called by readTask");
      },
      updateTask: async () => {
        throw new Error("updateTask should not be called by readTask");
      },
      writeNamespace: async () => {
        throw new Error("writeNamespace should not be called by readTask");
      },
    };

    const documentStore: TaskDocumentPort = {
      summarize: () => ({
        qaVerdict: null,
        documents: {
          hasSpec: false,
          hasPlan: false,
          hasQaReport: false,
        },
      }),
      readDocuments: () => ({ documents: {} }),
      prepareQaReportWrite: () => ({
        metadataRoot: {},
        namespace: {},
        root: {},
      }),
      persistSpec: async () => ({ issue, updatedAt: "", revision: 1 }),
      persistImplementationPlan: async () => ({ issue, updatedAt: "", revision: 1 }),
      appendQaReport: async () => {},
    };

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      {
        persistence,
        documentStore,
      },
    );

    await expect(store.readTask({ taskId: "task-1" })).rejects.toThrow(
      "Invalid Beads status for task task-1: received null.",
    );
  });
});
