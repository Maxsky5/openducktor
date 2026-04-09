import { afterEach, describe, expect, test } from "bun:test";
import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { resolveStoreContext } from "./store-context";

const originalFetch = globalThis.fetch;

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.ODT_REPO_PATH;
  delete process.env.ODT_HOST_URL;
  delete process.env.ODT_METADATA_NAMESPACE;
  delete process.env.ODT_BEADS_ATTACHMENT_DIR;
  delete process.env.ODT_DOLT_HOST;
  delete process.env.ODT_DOLT_PORT;
  delete process.env.ODT_DATABASE_NAME;
});

describe("resolveStoreContext", () => {
  test("validates the host bridge before startup", async () => {
    globalThis.fetch = (async (input) => {
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
    }) as typeof fetch;

    process.env.ODT_REPO_PATH = "/repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).resolves.toEqual({
      repoPath: "/repo",
      hostUrl: "http://127.0.0.1:14327",
      metadataNamespace: "openducktor",
    });
  });

  test("rejects legacy direct Beads/Dolt startup contract", async () => {
    process.env.ODT_REPO_PATH = "/repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_DOLT_HOST = "127.0.0.1";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "Direct Beads/Dolt MCP startup is no longer supported",
    );
  });

  test("fails fast when the host health check fails", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse(
          { error: "host down" },
          { status: 503, statusText: "Service Unavailable" },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    process.env.ODT_REPO_PATH = "/repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).rejects.toThrow("host down");
  });
});
