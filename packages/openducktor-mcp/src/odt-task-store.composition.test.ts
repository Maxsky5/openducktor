import { describe, expect, test } from "bun:test";
import type { TaskPersistencePort } from "./bd-persistence";
import type { RawIssue, TaskCard } from "./contracts";
import { OdtTaskStore } from "./odt-task-store";
import type { TaskDocumentPort } from "./task-document-store";

const makeTask = (): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  status: "open",
  issueType: "feature",
  aiReviewEnabled: true,
});

describe("OdtTaskStore composition", () => {
  test("uses injected ports and persistence namespace for read mapping", async () => {
    const issue: RawIssue = {
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
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
      listTasks: async () => [makeTask()],
      showRawIssue: async () => issue,
      getNamespaceData: () => {
        throw new Error("getNamespaceData should not be called by readTask");
      },
      writeNamespace: async () => {
        throw new Error("writeNamespace should not be called by readTask");
      },
    };

    const documentStore: TaskDocumentPort = {
      parseDocs: () => ({
        spec: { markdown: "spec", updatedAt: null },
        implementationPlan: { markdown: "plan", updatedAt: null },
        latestQaReport: { markdown: "", updatedAt: null, verdict: null },
      }),
      persistSpec: async () => ({ updatedAt: "", revision: 1 }),
      persistImplementationPlan: async () => ({ updatedAt: "", revision: 1 }),
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
      task: TaskCard;
      documents: { spec: { markdown: string } };
    };

    expect(result.task.aiReviewEnabled).toBe(false);
    expect(result.documents.spec.markdown).toBe("spec");
  });
});
