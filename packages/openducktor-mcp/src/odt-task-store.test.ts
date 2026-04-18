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
  test("delegates workspace-scoped execution using the startup workspace default", async () => {
    const calls: Array<{ toolName: string; workspaceId: string; input: unknown }> = [];
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => [],
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return summaryPayload;
      },
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore(
      { workspaceId: "repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.readTask({ taskId: "task-1" })).resolves.toEqual(summaryPayload);
    expect(calls).toEqual([
      { toolName: "odt_read_task", workspaceId: "repo", input: { taskId: "task-1" } },
    ]);
  });

  test("tool input workspaceId overrides the startup default", async () => {
    const calls: Array<{ toolName: string; workspaceId: string; input: unknown }> = [];
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => [],
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return summaryPayload;
      },
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore(
      { workspaceId: "default-repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.readTask({ workspaceId: "tool-repo", taskId: "task-1" })).resolves.toEqual(
      summaryPayload,
    );

    expect(calls).toEqual([
      {
        toolName: "odt_read_task",
        workspaceId: "tool-repo",
        input: { workspaceId: "tool-repo", taskId: "task-1" },
      },
    ]);
  });

  test("workspace-scoped public tools work with only tool-input workspaceId", async () => {
    const calls: Array<{ toolName: string; workspaceId: string; input: unknown }> = [];
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => [],
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return summaryPayload;
      },
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore({ hostUrl: "http://127.0.0.1:14327" }, { client });

    await expect(
      store.createTask({
        workspaceId: "repo",
        title: "Bridge task",
        issueType: "task",
        priority: 2,
      }),
    ).resolves.toEqual(summaryPayload);

    expect(calls).toEqual([
      {
        toolName: "odt_create_task",
        workspaceId: "repo",
        input: {
          workspaceId: "repo",
          title: "Bridge task",
          issueType: "task",
          priority: 2,
        },
      },
    ]);
  });

  test("keeps MCP-side input validation before delegation", async () => {
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => [],
      call: async () => summaryPayload,
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore(
      { workspaceId: "repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.createTask({ issueType: "task", priority: 2 })).rejects.toThrow();
  });

  test("fails before delegation when no workspace can be resolved", async () => {
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => [],
      call: async () => summaryPayload,
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore({ hostUrl: "http://127.0.0.1:14327" }, { client });

    await expect(store.searchTasks({ status: "open" })).rejects.toThrow(
      "Missing workspaceId for workspace-scoped tool 'odt_search_tasks'",
    );
  });

  test("getWorkspaces bypasses workspace resolution and delegates directly", async () => {
    let calls = 0;
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => {
        calls += 1;
        return {
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        };
      },
      call: async () => summaryPayload,
    } as OdtHostBridgeClientPort;

    const store = new OdtTaskStore({ hostUrl: "http://127.0.0.1:14327" }, { client });

    await expect(store.getWorkspaces({})).resolves.toEqual({
      workspaces: [
        {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: null,
          effectiveWorktreeBasePath: null,
        },
      ],
    });
    expect(calls).toBe(1);
  });

  test("accepts document-level decode errors on odt_read_task_documents", async () => {
    const client = {
      ready: async () => ({ bridgeVersion: 1, toolNames: [] }),
      getWorkspaces: async () => [],
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
      { workspaceId: "repo", hostUrl: "http://127.0.0.1:14327" },
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
