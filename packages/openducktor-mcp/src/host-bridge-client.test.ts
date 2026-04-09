import { describe, expect, test } from "bun:test";
import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { OdtHostBridgeClient } from "./host-bridge-client";

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

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
          repoPath: "/repo",
          metadataNamespace: "openducktor",
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new OdtHostBridgeClient(
      { baseUrl: "http://127.0.0.1:14327", repoPath: "/repo" },
      { fetchImpl },
    );

    await expect(client.ready()).resolves.toEqual({
      bridgeVersion: 1,
      repoPath: "/repo",
      metadataNamespace: "openducktor",
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
      { baseUrl: "http://127.0.0.1:14327", repoPath: "/repo" },
      { fetchImpl },
    );

    await expect(client.ready()).rejects.toThrow("bridge unavailable");
  });

  test("call forwards repo-scoped payloads and validates the response", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return jsonResponse({
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
      });
    };

    const client = new OdtHostBridgeClient(
      { baseUrl: "http://127.0.0.1:14327", repoPath: "/repo" },
      { fetchImpl },
    );

    const result = await client.call("odt_read_task", { taskId: "task-1" });
    expect(result.task.id).toBe("task-1");
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_read_task",
        body: {
          repoPath: "/repo",
          taskId: "task-1",
        },
      },
    ]);
  });
});
