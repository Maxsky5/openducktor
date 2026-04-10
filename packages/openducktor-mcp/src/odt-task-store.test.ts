import { describe, expect, test } from "bun:test";
import type { OdtHostBridgeClientPort } from "./host-bridge-client";
import { OdtTaskStore } from "./odt-task-store";

const summaryPayload = {
  task: {
    id: "task-1",
    title: "Bridge task",
    description: "",
    status: "open",
    priority: 2,
    issueType: "task",
    aiReviewEnabled: true,
    labels: [],
    createdAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:00.000Z",
    qaVerdict: "not_reviewed",
    documents: {
      hasSpec: false,
      hasPlan: false,
      hasQaReport: false,
    },
  },
};

describe("OdtTaskStore", () => {
  test("delegates tool execution to the host bridge client", async () => {
    const calls: Array<{ toolName: string; input: unknown }> = [];
    const client = {
      ready: async () => ({
        bridgeVersion: 1,
        repoPath: "/repo",
        toolNames: [],
      }),
      call: async (toolName, input) => {
        calls.push({ toolName, input });
        return summaryPayload;
      },
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore(
      { repoPath: "/repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.readTask({ taskId: "task-1" })).resolves.toEqual(summaryPayload);
    expect(calls).toEqual([{ toolName: "odt_read_task", input: { taskId: "task-1" } }]);
  });

  test("keeps MCP-side input validation before delegation", async () => {
    const client = {
      ready: async () => ({
        bridgeVersion: 1,
        repoPath: "/repo",
        toolNames: [],
      }),
      call: async () => summaryPayload,
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore(
      { repoPath: "/repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.createTask({ issueType: "task", priority: 2 })).rejects.toThrow();
  });

  test("accepts document-level decode errors on odt_read_task_documents", async () => {
    const client = {
      ready: async () => ({
        bridgeVersion: 1,
        repoPath: "/repo",
        toolNames: [],
      }),
      call: async () => ({
        documents: {
          spec: {
            markdown: "",
            updatedAt: "2026-04-09T00:00:00.000Z",
            error: "Failed to decode openducktor.documents.spec[0]: invalid base64 payload",
          },
        },
      }),
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore(
      { repoPath: "/repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.readTaskDocuments({ taskId: "task-1", includeSpec: true })).resolves.toEqual(
      {
        documents: {
          spec: {
            markdown: "",
            updatedAt: "2026-04-09T00:00:00.000Z",
            error: "Failed to decode openducktor.documents.spec[0]: invalid base64 payload",
          },
        },
      },
    );
  });
});
