import { describe, expect, test } from "bun:test";
import { ODT_TOOL_SCHEMAS, hasRuntimeType } from "@openducktor/contracts";
import { OdtHostBridgeClient } from "./host-bridge-client";
import { OdtToolError } from "./tool-results";
import type { JsonValue } from "@openducktor/contracts";

const jsonResponse = (payload: JsonValue | undefined, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

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
    targetBranch: {
      remote: "origin",
      branch: "main",
    },
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

describe("OdtHostBridgeClient", () => {
  test("ready sends one authenticated readiness request and validates tool coverage", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      headers: HeadersInit | undefined;
      body: string | undefined;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: init?.headers,
        body: hasRuntimeType(init?.body, "string") ? init.body : undefined,
      });
      return jsonResponse({
        bridgeVersion: 1,
        toolNames: Object.keys(ODT_TOOL_SCHEMAS),
      });
    };

    const client = new OdtHostBridgeClient(
      {
        baseUrl: "http://127.0.0.1:14327",
        appToken: "host-token",
      },
      { fetchImpl },
    );

    await expect(client.ready()).resolves.toEqual({
      bridgeVersion: 1,
      toolNames: Object.keys(ODT_TOOL_SCHEMAS),
    });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_mcp_ready",
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-openducktor-app-token": "host-token",
        },
        body: "{}",
      },
    ]);
  });

  test("ready preserves invalid authentication failures", async () => {
    const fetchImpl: typeof fetch = async () => {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "ODT_HOST_BRIDGE_ERROR",
            message: "Invalid OpenDucktor web host app token.",
          },
        },
        { status: 401, statusText: "Unauthorized" },
      );
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    await expect(client.ready()).rejects.toThrow("Invalid OpenDucktor web host app token.");
  });

  test("ready rejects malformed readiness responses", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ bridgeVersion: 1 });
    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    await expect(client.ready()).rejects.toMatchObject({
      code: "ODT_HOST_RESPONSE_INVALID",
      details: { command: "odt_mcp_ready" },
    });
  });

  test("ready rejects readiness responses that omit required tools", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        bridgeVersion: 1,
        toolNames: ["odt_read_task"],
      });
    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    await expect(client.ready()).rejects.toMatchObject({
      code: "ODT_HOST_RESPONSE_INVALID",
      details: {
        missingToolNames: Object.keys(ODT_TOOL_SCHEMAS).filter(
          (toolName) => toolName !== "odt_read_task",
        ),
      },
    });
  });

  test("wraps host transport failures as bridge errors", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    try {
      await client.getWorkspaces();
      throw new Error("Expected getWorkspaces() to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(OdtToolError);
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).code).toBe("ODT_HOST_BRIDGE_ERROR");
      // SAFETY: This test drives the failure path that supplies `Error` before this assertion.
      expect((error as Error).message).toContain("host odt_get_workspaces failed: fetch failed");
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).details).toMatchObject({
        action: "host odt_get_workspaces",
        causeName: "TypeError",
      });
    }
  });

  test("preserves coded host business errors without wrapping them as bridge errors", async () => {
    const fetchImpl: typeof fetch = async () => {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "TASK_TRANSITION_NOT_ALLOWED",
            message: "Transition not allowed for task-1 (bug): human_review -> blocked",
          },
        },
        { status: 400, statusText: "Bad Request" },
      );
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    try {
      await client.call("odt_build_blocked", "repo", {
        taskId: "task-1",
        reason: "needs a product decision",
      });
      throw new Error("Expected call() to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(OdtToolError);
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).code).toBe("TASK_TRANSITION_NOT_ALLOWED");
      // SAFETY: This test drives the failure path that supplies `Error` before this assertion.
      expect((error as Error).message).toBe(
        "Transition not allowed for task-1 (bug): human_review -> blocked",
      );
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).details).toBeUndefined();
    }
  });

  test("preserves canonical host bridge error details", async () => {
    const fetchImpl: typeof fetch = async () => {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "ODT_HOST_BRIDGE_ERROR",
            message: "Task not found: task-1",
            details: { repoPath: "/repo", taskId: "task-1" },
          },
        },
        { status: 400, statusText: "Bad Request" },
      );
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    try {
      await client.call("odt_build_blocked", "repo", {
        taskId: "task-1",
        reason: "needs a product decision",
      });
      throw new Error("Expected call() to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(OdtToolError);
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).code).toBe("ODT_HOST_BRIDGE_ERROR");
      // SAFETY: This test drives the failure path that supplies `Error` before this assertion.
      expect((error as Error).message).toBe("Task not found: task-1");
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).details).toEqual({
        repoPath: "/repo",
        taskId: "task-1",
      });
    }
  });

  test("preserves canonical host bridge error issues", async () => {
    const issues = [
      {
        path: ["workspaceId"],
        code: "forbidden_workspace_id",
        message: "workspaceId is fixed by the startup workspace and is not allowed in tool input.",
      },
    ];
    const fetchImpl: typeof fetch = async () => {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "ODT_WORKSPACE_SCOPE_VIOLATION",
            message: "workspaceId is not allowed",
            issues,
          },
        },
        { status: 400, statusText: "Bad Request" },
      );
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    try {
      await client.call("odt_read_task", "repo", {
        taskId: "task-1",
      });
      throw new Error("Expected call() to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(OdtToolError);
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).code).toBe("ODT_WORKSPACE_SCOPE_VIOLATION");
      // SAFETY: This test drives the failure path that supplies `Error` before this assertion.
      expect((error as Error).message).toBe("workspaceId is not allowed");
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).issues).toEqual(issues);
    }
  });

  test("wraps non-canonical host HTTP errors as bridge failures", async () => {
    const fetchImpl: typeof fetch = async () => {
      return jsonResponse(
        { error: "legacy bridge error" },
        { status: 400, statusText: "Bad Request" },
      );
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    try {
      await client.call("odt_build_blocked", "repo", {
        taskId: "task-1",
        reason: "needs a product decision",
      });
      throw new Error("Expected call() to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(OdtToolError);
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).code).toBe("ODT_HOST_BRIDGE_ERROR");
      // SAFETY: This test drives the failure path that supplies `Error` before this assertion.
      expect((error as Error).message).toBe(
        "host odt_build_blocked failed with HTTP 400 Bad Request",
      );
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).details).toEqual({
        action: "host odt_build_blocked",
        status: 400,
        statusText: "Bad Request",
      });
    }
  });

  test("wraps invalid host JSON responses as response errors", async () => {
    const fetchImpl: typeof fetch = async () => {
      return new Response("not json", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    try {
      await client.getWorkspaces();
      throw new Error("Expected getWorkspaces() to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(OdtToolError);
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).code).toBe("ODT_HOST_RESPONSE_INVALID");
      // SAFETY: This test drives the failure path that supplies `Error` before this assertion.
      expect((error as Error).message).toContain(
        "Invalid JSON response from host odt_get_workspaces",
      );
      // SAFETY: This test controls the fixture and supplies `OdtToolError` used by this case.
      expect((error as OdtToolError).details).toMatchObject({
        action: "host odt_get_workspaces",
        causeName: "SyntaxError",
      });
    }
  });

  test("getWorkspaces forwards a workspace-free request and validates the response", async () => {
    const requests: Array<{ url: string; body: Record<string, JsonValue> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      // SAFETY: This test controls the fixture and supplies `Record<string, JsonValue>` used by this case.
      requests.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, JsonValue>,
      });
      return jsonResponse({
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
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    await expect(client.getWorkspaces()).resolves.toEqual({
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

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_get_workspaces",
        body: {},
      },
    ]);
  });

  test("call forwards workspace-scoped payloads and validates the response", async () => {
    const requests: Array<{ url: string; body: Record<string, JsonValue> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      // SAFETY: This test controls the fixture and supplies `Record<string, JsonValue>` used by this case.
      requests.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, JsonValue>,
      });
      return jsonResponse(summaryPayload);
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    const result = await client.call("odt_read_task", "repo", { taskId: "task-1" });
    expect(result.task.id).toBe("task-1");
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_read_task",
        body: {
          workspaceId: "repo",
          taskId: "task-1",
        },
      },
    ]);
  });

  test("call validates the private task asset bridge payload before MCP formatting", async () => {
    const assetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const requests: Array<{ url: string; body: Record<string, JsonValue> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      // SAFETY: This test controls the fixture and supplies `Record<string, JsonValue>` used by this case.
      requests.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, JsonValue>,
      });
      return jsonResponse({
        assets: [
          {
            assetId,
            mediaType: "image/png",
            byteSize: 3,
            dataBase64: "AQID",
          },
        ],
      });
    };
    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    await expect(
      client.call("odt_read_task_assets", "repo", {
        taskId: "task-1",
        assetIds: [assetId],
      }),
    ).resolves.toEqual({
      assets: [
        {
          assetId,
          mediaType: "image/png",
          byteSize: 3,
          dataBase64: "AQID",
        },
      ],
    });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_read_task_assets",
        body: {
          workspaceId: "repo",
          taskId: "task-1",
          assetIds: [assetId],
        },
      },
    ]);
  });

  test("odt_create_task and odt_search_tasks keep the flat public tool payload shape", async () => {
    const requests: Array<{ url: string; body: Record<string, JsonValue> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      // SAFETY: This test controls the fixture and supplies `Record<string, JsonValue>` used by this case.
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, JsonValue>;
      requests.push({ url, body });

      if (url.endsWith("/invoke/odt_create_task")) {
        return jsonResponse(summaryPayload);
      }

      if (url.endsWith("/invoke/odt_search_tasks")) {
        return jsonResponse({
          results: [summaryPayload],
          limit: 10,
          totalCount: 1,
          hasMore: false,
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new OdtHostBridgeClient({ baseUrl: "http://127.0.0.1:14327" }, { fetchImpl });

    await expect(
      client.call("odt_create_task", "repo", {
        title: "Bridge task",
        issueType: "task",
        priority: 2,
        description: "Created through host bridge",
        labels: ["mcp"],
        aiReviewEnabled: true,
      }),
    ).resolves.toEqual(summaryPayload);

    await expect(
      client.call("odt_search_tasks", "repo", {
        status: "open",
        title: "Bridge",
        tags: ["mcp"],
        limit: 10,
      }),
    ).resolves.toEqual({
      results: [summaryPayload],
      limit: 10,
      totalCount: 1,
      hasMore: false,
    });

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_create_task",
        body: {
          workspaceId: "repo",
          title: "Bridge task",
          issueType: "task",
          priority: 2,
          description: "Created through host bridge",
          labels: ["mcp"],
          aiReviewEnabled: true,
        },
      },
      {
        url: "http://127.0.0.1:14327/invoke/odt_search_tasks",
        body: {
          workspaceId: "repo",
          status: "open",
          title: "Bridge",
          tags: ["mcp"],
          limit: 10,
        },
      },
    ]);
  });
});
