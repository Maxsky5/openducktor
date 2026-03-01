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
  test("parseDocs returns latest spec, plan, and QA report snapshot", () => {
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
    const snapshot = documents.parseDocs(harness.getIssue());

    expect(snapshot).toEqual({
      spec: {
        markdown: "# latest spec",
        updatedAt: "2026-02-21T00:00:00.000Z",
      },
      implementationPlan: {
        markdown: "# plan",
        updatedAt: "2026-02-22T00:00:00.000Z",
      },
      latestQaReport: {
        markdown: "LGTM",
        updatedAt: "2026-02-23T00:00:00.000Z",
        verdict: "approved",
      },
    });
  });

  test("persistImplementationPlan stores latest-only entry and increments revision", async () => {
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
                markdown: "# old plan",
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "planner-agent",
                sourceTool: "odt_set_plan",
                revision: 1,
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
      updatedAt: FIXED_NOW,
      revision: 2,
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
              revision: 2,
            },
          ],
        },
      },
    });
  });

  test("appendQaReport appends new report and increments revision from valid entries", async () => {
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
                updatedAt: "2026-02-20T00:00:00.000Z",
                updatedBy: "qa-agent",
                sourceTool: "odt_qa_approved",
                revision: 1,
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
              updatedAt: "2026-02-20T00:00:00.000Z",
              updatedBy: "qa-agent",
              sourceTool: "odt_qa_approved",
              revision: 1,
            },
            {
              markdown: "needs changes",
              verdict: "rejected",
              updatedAt: FIXED_NOW,
              updatedBy: "qa-agent",
              sourceTool: "odt_qa_rejected",
              revision: 2,
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
});
