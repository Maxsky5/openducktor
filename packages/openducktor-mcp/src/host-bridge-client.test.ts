import { describe, expect, test } from "bun:test";
import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { OdtHostBridgeClient } from "./host-bridge-client";

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
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
  test("ready validates host health and required tool coverage", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          workspaceId: "repo",
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new OdtHostBridgeClient(
      { baseUrl: "http://127.0.0.1:14327", workspaceId: "repo" },
      { fetchImpl },
    );

    await expect(client.ready()).resolves.toEqual({
      bridgeVersion: 1,
      workspaceId: "repo",
      toolNames: Object.keys(ODT_TOOL_SCHEMAS),
    });
  });

  test("ready fails fast when the host is unhealthy", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse(
          { error: "bridge unavailable" },
          { status: 503, statusText: "Service Unavailable" },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new OdtHostBridgeClient(
      { baseUrl: "http://127.0.0.1:14327", workspaceId: "repo" },
      { fetchImpl },
    );

    await expect(client.ready()).rejects.toThrow("bridge unavailable");
  });

  test("call forwards workspace-scoped payloads and validates the response", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return jsonResponse(summaryPayload);
    };

    const client = new OdtHostBridgeClient(
      { baseUrl: "http://127.0.0.1:14327", workspaceId: "repo" },
      { fetchImpl },
    );

    const result = await client.call("odt_read_task", { taskId: "task-1" });
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

  test("odt_create_task and odt_search_tasks keep the flat public tool payload shape", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
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

    const client = new OdtHostBridgeClient(
      { baseUrl: "http://127.0.0.1:14327", workspaceId: "repo" },
      { fetchImpl },
    );

    await expect(
      client.call("odt_create_task", {
        title: "Bridge task",
        issueType: "task",
        priority: 2,
        description: "Created through host bridge",
        labels: ["mcp"],
        aiReviewEnabled: true,
      }),
    ).resolves.toEqual(summaryPayload);

    await expect(
      client.call("odt_search_tasks", {
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
