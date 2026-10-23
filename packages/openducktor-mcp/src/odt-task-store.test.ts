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
    artifacts: {
      hasSpec: false,
      hasPlan: false,
      hasQaReport: false,
    },
  },
};

describe("OdtTaskStore", () => {
  const workspacesPayload = { workspaces: [] };

  test("delegates workspace-scoped execution using the startup workspace default", async () => {
    const calls: Array<{ toolName: string; workspaceId: string; input: unknown }> = [];
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => workspacesPayload,
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return summaryPayload;
      },
    };

    const store = new OdtTaskStore(
      { workspaceId: "repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.readTask({ taskId: "task-1" })).resolves.toEqual(summaryPayload);
    expect(calls).toEqual([
      { toolName: "odt_read_task", workspaceId: "repo", input: { taskId: "task-1" } },
    ]);
  });

  test("delegates a task asset batch in one host bridge call", async () => {
    const assetIds = [
      "28cb7c3d-5ec4-47e8-bffe-090223eae3b7",
      "96d20c03-a470-47f6-9472-1a1d34cd23df",
    ];
    const calls: Array<{ toolName: string; workspaceId: string; input: unknown }> = [];
    const payload = { assets: [] };
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => workspacesPayload,
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return payload;
      },
    };
    const store = new OdtTaskStore(
      { workspaceId: "repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );

    await expect(store.readTaskAssets({ taskId: "task-1", assetIds })).resolves.toEqual(payload);
    expect(calls).toEqual([
      {
        toolName: "odt_read_task_assets",
        workspaceId: "repo",
        input: { taskId: "task-1", assetIds },
      },
    ]);
  });

  test("tool input workspaceId overrides the startup default", async () => {
    const calls: Array<{ toolName: string; workspaceId: string; input: unknown }> = [];
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => workspacesPayload,
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return summaryPayload;
      },
    };

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
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => workspacesPayload,
      call: async (toolName, workspaceId, input) => {
        calls.push({ toolName, workspaceId, input });
        return summaryPayload;
      },
    };

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

  test("fails before delegation when no workspace can be resolved", async () => {
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => workspacesPayload,
      call: async () => summaryPayload,
    };

    const store = new OdtTaskStore({ hostUrl: "http://127.0.0.1:14327" }, { client });

    await expect(store.searchTasks({ status: "open" })).rejects.toThrow(
      "Missing workspaceId for workspace-scoped tool 'odt_search_tasks'",
    );
  });

  test("getWorkspaces bypasses workspace resolution and delegates directly", async () => {
    let calls = 0;
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => {
        calls += 1;
        return {
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              abbreviation: null,
              tileColor: null,
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
    };

    const store = new OdtTaskStore({ hostUrl: "http://127.0.0.1:14327" }, { client });

    await expect(store.getWorkspaces({})).resolves.toEqual({
      workspaces: [
        {
          workspaceId: "repo",
          workspaceName: "Repo",
          abbreviation: null,
          tileColor: null,
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

  test("encodes UTF-8 artifact writes once before the bridge and rejects lossy input", async () => {
    const calls: unknown[] = [];
    const client: OdtHostBridgeClientPort = {
      ready: async () => ({ bridgeVersion: 2, toolNames: [] }),
      getWorkspaces: async () => workspacesPayload,
      call: async (_toolName, _workspaceId, input) => {
        calls.push(input);
        return {
          artifact: {
            taskId: "task-1",
            code: "notes",
            name: "Notes",
            classification: "free",
            revision: 1,
            updatedAt: null,
            fileName: "notes.txt",
            mediaType: "text/plain",
            byteSize: 8,
          },
        };
      },
    };
    const store = new OdtTaskStore(
      { workspaceId: "repo", hostUrl: "http://127.0.0.1:14327" },
      { client },
    );
    const input = {
      taskId: "task-1",
      code: "notes",
      name: "Notes",
      fileName: "notes.txt",
      mediaType: "text/plain",
    };
    await store.setTaskArtifact({
      ...input,
      content: "\ufeffé\r\n\u0000",
    });
    expect(calls).toEqual([{ ...input, dataBase64: "77u/w6kNCgA=" }]);
    await expect(store.setTaskArtifact({ ...input, content: "\ud800" })).rejects.toThrow(
      "unpaired Unicode surrogate",
    );
    await expect(store.setTaskArtifact({ ...input, dataBase64: "AQI" })).rejects.toThrow(
      "canonical base64",
    );
    expect(calls).toHaveLength(1);
    await store.setTaskArtifact({ taskId: "task-1", code: "notes", name: "Renamed" });
    expect(calls[1]).toEqual({ taskId: "task-1", code: "notes", name: "Renamed" });
  });
});
