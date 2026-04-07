import { describe, expect, test } from "bun:test";
import type { JsonObject, RawIssue } from "./contracts";
import { getNamespaceData } from "./metadata-docs";
import { type TaskDocumentPersistence, TaskDocumentStore } from "./task-document-store";

const FIXED_NOW = "2026-03-01T12:00:00.000Z";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type PersistenceHarness = {
  persistence: TaskDocumentPersistence;
  getIssue: () => RawIssue;
};

const createPersistenceHarness = (initialIssue: RawIssue): PersistenceHarness => {
  let issue = clone(initialIssue);

  const persistence: TaskDocumentPersistence = {
    metadataNamespace: "openducktor",
    showRawIssue: async (taskId: string) => {
      if (taskId !== issue.id) {
        throw new Error(`Task not found: ${taskId}`);
      }
      return clone(issue);
    },
    getNamespaceData: (rawIssue: RawIssue) => getNamespaceData(rawIssue, "openducktor"),
    writeNamespace: async (taskId: string, root: JsonObject, namespace: JsonObject) => {
      if (taskId !== issue.id) {
        throw new Error(`Task not found: ${taskId}`);
      }

      issue = {
        ...issue,
        metadata: {
          ...root,
          openducktor: namespace,
        },
      };
    },
  };

  return {
    persistence,
    getIssue: () => clone(issue),
  };
};

describe("TaskDocumentStore", () => {
  test("summarize returns latest QA verdict and document presence booleans", () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
      metadata: {
        openducktor: {
          documents: {
            spec: [
              {
                markdown: "# older spec",
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "spec-agent",
                sourceTool: "odt_set_spec",
                revision: 1,
              },
              {
                markdown: "# latest spec",
                updatedAt: "2026-02-21T00:00:00.000Z",
                updatedBy: "spec-agent",
                sourceTool: "odt_set_spec",
                revision: 2,
              },
            ],
            implementationPlan: [
              {
                markdown: "# plan",
                updatedAt: "2026-02-22T00:00:00.000Z",
                updatedBy: "planner-agent",
                sourceTool: "odt_set_plan",
                revision: 1,
              },
            ],
            qaReports: [
              {
                markdown: "LGTM",
                verdict: "approved",
                updatedAt: "2026-02-23T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_approved",
                revision: 1,
              },
            ],
          },
        },
      },
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);
    const summary = documents.summarize(harness.getIssue());

    expect(summary).toEqual({
      qaVerdict: "approved",
      documents: {
        hasSpec: true,
        hasPlan: true,
        hasQaReport: true,
      },
    });
  });

  test("readDocuments returns only the requested sections", () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
      metadata: {
        openducktor: {
          documents: {
            spec: [
              {
                markdown: "# latest spec",
                updatedAt: "2026-02-21T00:00:00.000Z",
                updatedBy: "spec-agent",
                sourceTool: "odt_set_spec",
                revision: 2,
              },
            ],
            qaReports: [
              {
                markdown: "LGTM",
                verdict: "approved",
                updatedAt: "2026-02-23T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_approved",
                revision: 1,
              },
            ],
          },
        },
      },
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);
    const result = documents.readDocuments(harness.getIssue(), {
      includeSpec: true,
      includeQaReport: true,
    });

    expect(result).toEqual({
      documents: {
        spec: {
          markdown: "# latest spec",
          updatedAt: "2026-02-21T00:00:00.000Z",
        },
        latestQaReport: {
          markdown: "LGTM",
          updatedAt: "2026-02-23T00:00:00.000Z",
          verdict: "approved",
        },
      },
    });
  });

  test("summarize returns false booleans and not_reviewed verdict when namespace documents are missing", () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
      metadata: {},
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);
    const summary = documents.summarize(harness.getIssue());

    expect(summary).toEqual({
      qaVerdict: "not_reviewed",
      documents: {
        hasSpec: false,
        hasPlan: false,
        hasQaReport: false,
      },
    });
  });

  test("whitespace-only latest document entries are treated as missing content", () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
      metadata: {
        openducktor: {
          documents: {
            spec: [
              {
                markdown: "# older spec",
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "spec-agent",
                sourceTool: "odt_set_spec",
                revision: 1,
              },
              {
                markdown: "   \n\t  ",
                updatedAt: "2026-02-21T00:00:00.000Z",
                updatedBy: "spec-agent",
                sourceTool: "odt_set_spec",
                revision: 2,
              },
            ],
            implementationPlan: [
              {
                markdown: "# older plan",
                updatedAt: "2026-02-22T00:00:00.000Z",
                updatedBy: "planner-agent",
                sourceTool: "odt_set_plan",
                revision: 1,
              },
              {
                markdown: "\n   ",
                updatedAt: "2026-02-23T00:00:00.000Z",
                updatedBy: "planner-agent",
                sourceTool: "odt_set_plan",
                revision: 2,
              },
            ],
            qaReports: [
              {
                markdown: "LGTM",
                verdict: "approved",
                updatedAt: "2026-02-24T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_approved",
                revision: 1,
              },
              {
                markdown: " \n ",
                verdict: "rejected",
                updatedAt: "2026-02-25T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_rejected",
                revision: 2,
              },
            ],
          },
        },
      },
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);

    expect(documents.summarize(harness.getIssue())).toEqual({
      qaVerdict: "not_reviewed",
      documents: {
        hasSpec: false,
        hasPlan: false,
        hasQaReport: false,
      },
    });

    expect(
      documents.readDocuments(harness.getIssue(), {
        includeSpec: true,
        includePlan: true,
        includeQaReport: true,
      }),
    ).toEqual({
      documents: {
        spec: {
          markdown: "",
          updatedAt: null,
        },
        implementationPlan: {
          markdown: "",
          updatedAt: null,
        },
        latestQaReport: {
          markdown: "",
          updatedAt: null,
          verdict: "not_reviewed",
        },
      },
    });
  });

  test("persistImplementationPlan stores latest-only entry and uses max revision + 1", async () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "spec_ready",
      issue_type: "feature",
      metadata: {
        keep: "value",
        openducktor: {
          custom: { owner: "team-a" },
          documents: {
            implementationPlan: [
              {
                markdown: "# plan r4",
                updatedAt: "2026-02-22T00:00:00.000Z",
                updatedBy: "planner-agent",
                sourceTool: "odt_set_plan",
                revision: 4,
              },
              {
                markdown: "# plan r2",
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "planner-agent",
                sourceTool: "odt_set_plan",
                revision: 2,
              },
              {
                markdown: "invalid",
              },
            ],
          },
        },
      },
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);
    const persisted = await documents.persistImplementationPlan("task-1", "# new plan");

    expect(persisted).toEqual({
      issue: harness.getIssue(),
      updatedAt: FIXED_NOW,
      revision: 5,
    });

    const updatedIssue = harness.getIssue();
    expect(updatedIssue.metadata).toEqual({
      keep: "value",
      openducktor: {
        custom: { owner: "team-a" },
        documents: {
          implementationPlan: [
            {
              markdown: "# new plan",
              updatedAt: FIXED_NOW,
              updatedBy: "planner-agent",
              sourceTool: "odt_set_plan",
              revision: 5,
            },
          ],
        },
      },
    });
  });

  test("appendQaReport appends new report and uses max revision + 1", async () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "human_review",
      issue_type: "feature",
      metadata: {
        openducktor: {
          documents: {
            qaReports: [
              {
                markdown: "initial",
                verdict: "approved",
                updatedAt: "2026-02-22T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_approved",
                revision: 4,
              },
              {
                markdown: "older",
                verdict: "rejected",
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_rejected",
                revision: 2,
              },
              {
                markdown: "invalid",
              },
            ],
          },
        },
      },
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);
    await documents.appendQaReport("task-1", "needs changes", "rejected");

    const updatedIssue = harness.getIssue();
    expect(updatedIssue.metadata).toEqual({
      openducktor: {
        documents: {
          qaReports: [
            {
              markdown: "initial",
              verdict: "approved",
              updatedAt: "2026-02-22T00:00:00.000Z",
              updatedBy: "qa-agent",
              sourceTool: "odt_qa_approved",
              revision: 4,
            },
            {
              markdown: "older",
              verdict: "rejected",
              updatedAt: "2026-02-20T00:00:00.000Z",
              updatedBy: "qa-agent",
              sourceTool: "odt_qa_rejected",
              revision: 2,
            },
            {
              markdown: "needs changes",
              verdict: "rejected",
              updatedAt: FIXED_NOW,
              updatedBy: "qa-agent",
              sourceTool: "odt_qa_rejected",
              revision: 5,
            },
          ],
        },
      },
    });
  });

  test("persistSpec stores latest-only spec entry", async () => {
    const harness = createPersistenceHarness({
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
      metadata: {
        openducktor: {
          documents: {
            spec: [
              {
                markdown: "# old spec",
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "spec-agent",
                sourceTool: "odt_set_spec",
                revision: 1,
              },
            ],
          },
        },
      },
    });

    const documents = new TaskDocumentStore(harness.persistence, () => FIXED_NOW);
    const persisted = await documents.persistSpec("task-1", "# new spec");

    expect(persisted).toEqual({
      issue: harness.getIssue(),
      updatedAt: FIXED_NOW,
      revision: 2,
    });

    const updatedIssue = harness.getIssue();
    expect(updatedIssue.metadata).toEqual({
      openducktor: {
        documents: {
          spec: [
            {
              markdown: "# new spec",
              updatedAt: FIXED_NOW,
              updatedBy: "spec-agent",
              sourceTool: "odt_set_spec",
              revision: 2,
            },
          ],
        },
      },
    });
  });

  test("propagates persistence write errors", async () => {
    const persistence: TaskDocumentPersistence = {
      metadataNamespace: "openducktor",
      showRawIssue: async () => ({
        id: "task-1",
        title: "Task 1",
        status: "open",
        issue_type: "feature",
        metadata: {},
      }),
      getNamespaceData: (rawIssue) => getNamespaceData(rawIssue, "openducktor"),
      writeNamespace: async () => {
        throw new Error("metadata write failed");
      },
    };
    const documents = new TaskDocumentStore(persistence, () => FIXED_NOW);

    await expect(documents.persistSpec("task-1", "# spec")).rejects.toThrow(
      "metadata write failed",
    );
  });
});
