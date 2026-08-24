import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ODT_TOOL_SCHEMAS, type JsonValue, jsonValueSchema } from "@openducktor/contracts";
import { resolveStoreContext } from "./store-context";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];
const STORE_CONTEXT_ENV_KEYS = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_HOST_TOKEN_FILE",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "OPENDUCKTOR_CHANNEL",
  "OPENDUCKTOR_CONFIG_DIR",
  "OPENDUCKTOR_DEV_INSTANCE",
] as const;
type StoreContextEnvSnapshot = {
  ODT_WORKSPACE_ID: string | undefined;
  ODT_HOST_URL: string | undefined;
  ODT_HOST_TOKEN: string | undefined;
  ODT_HOST_TOKEN_FILE: string | undefined;
  ODT_FORBID_WORKSPACE_ID_INPUT: string | undefined;
  OPENDUCKTOR_CHANNEL: string | undefined;
  OPENDUCKTOR_CONFIG_DIR: string | undefined;
  OPENDUCKTOR_DEV_INSTANCE: string | undefined;
};
let previousStoreContextEnv: StoreContextEnvSnapshot;

const jsonResponse = (payload: JsonValue, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

const setFetchImplementation = (fetchImpl: typeof fetch): void => {
  globalThis.fetch = fetchImpl;
};

const readHeader = (headers: HeadersInit | undefined, name: string): string | undefined =>
  new Headers(headers).get(name) ?? undefined;

const createDiscoveryFile = async ({
  hostToken = "discovery-token",
  hostUrl = "http://127.0.0.1:14327",
  pid = 12345,
}: {
  hostToken?: string;
  hostUrl?: string;
  pid?: number;
} = {}): Promise<string> => {
  const dir = join(tmpdir(), `openducktor-mcp-store-context-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "runtime"), { recursive: true });
  await writeFile(
    join(dir, "runtime", "mcp-bridge.json"),
    JSON.stringify({ hostToken, hostUrl, pid }, null, 2),
    "utf8",
  );
  tempDirs.push(dir);
  return dir;
};

const createEmptyConfigDir = async (): Promise<string> => {
  const dir = join(tmpdir(), `openducktor-mcp-store-context-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "runtime"), { recursive: true });
  tempDirs.push(dir);
  return dir;
};

const clearStoreContextEnv = (): void => {
  for (const key of STORE_CONTEXT_ENV_KEYS) {
    delete process.env[key];
  }
};

const snapshotStoreContextEnv = (): StoreContextEnvSnapshot => ({
  ODT_WORKSPACE_ID: process.env.ODT_WORKSPACE_ID,
  ODT_HOST_URL: process.env.ODT_HOST_URL,
  ODT_HOST_TOKEN: process.env.ODT_HOST_TOKEN,
  ODT_HOST_TOKEN_FILE: process.env.ODT_HOST_TOKEN_FILE,
  ODT_FORBID_WORKSPACE_ID_INPUT: process.env.ODT_FORBID_WORKSPACE_ID_INPUT,
  OPENDUCKTOR_CHANNEL: process.env.OPENDUCKTOR_CHANNEL,
  OPENDUCKTOR_CONFIG_DIR: process.env.OPENDUCKTOR_CONFIG_DIR,
  OPENDUCKTOR_DEV_INSTANCE: process.env.OPENDUCKTOR_DEV_INSTANCE,
});

const restoreStoreContextEnv = (snapshot: StoreContextEnvSnapshot): void => {
  for (const key of STORE_CONTEXT_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

beforeEach(() => {
  previousStoreContextEnv = snapshotStoreContextEnv();
  clearStoreContextEnv();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  try {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  } finally {
    restoreStoreContextEnv(previousStoreContextEnv);
  }
});

describe("resolveStoreContext", () => {
  test("validates readiness and the configured workspace concurrently", async () => {
    const requests: Array<{ url: string; body: JsonValue }> = [];
    let releaseResponses = (): void => {
      throw new Error("Response barrier was not initialized.");
    };
    const responseBarrier = new Promise<void>((resolve) => {
      releaseResponses = resolve;
    });
    setFetchImplementation(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        // SAFETY: request bodies are JSON serialized by the bridge client.
        body: jsonValueSchema.parse(JSON.parse(String(init?.body ?? "{}"))),
      });
      await responseBarrier;
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url.endsWith("/invoke/odt_get_workspaces")) {
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
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.OPENDUCKTOR_CHANNEL = "preview";

    const contextPromise = resolveStoreContext({});
    const requestsBeforeRelease = [...requests];
    releaseResponses();

    await expect(contextPromise).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14327",
    });
    expect(requestsBeforeRelease).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_mcp_ready",
        body: {},
      },
      {
        url: "http://127.0.0.1:14327/invoke/odt_get_workspaces",
        body: {},
      },
    ]);
  });

  test("starts without a workspace default after one authenticated readiness request", async () => {
    const requests: Array<{ url: string; body: JsonValue }> = [];
    setFetchImplementation(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        // SAFETY: request bodies are JSON serialized by the bridge client.
        body: jsonValueSchema.parse(JSON.parse(String(init?.body ?? "{}"))),
      });
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostUrl: "http://127.0.0.1:14327",
    });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/invoke/odt_mcp_ready",
        body: {},
      },
    ]);
  });

  test("reads the host bridge token from a token file", async () => {
    const dir = join(tmpdir(), `openducktor-mcp-token-${Date.now()}-${Math.random()}`);
    await mkdir(dir, { recursive: true });
    const tokenFile = join(dir, "host-token");
    await writeFile(tokenFile, " file-token ", "utf8");
    tempDirs.push(dir);
    const observedHostTokens: Array<string | undefined> = [];
    setFetchImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        observedHostTokens.push(readHeader(init?.headers, "x-openducktor-app-token"));
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_HOST_TOKEN_FILE = tokenFile;

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostUrl: "http://127.0.0.1:14327",
      hostToken: "file-token",
    });
    expect(observedHostTokens).toEqual(["file-token"]);
  });

  test("reads workspaceId-forbidden mode from the environment", async () => {
    setFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url.endsWith("/invoke/odt_get_workspaces")) {
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
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_FORBID_WORKSPACE_ID_INPUT = "true";

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14327",
      forbidWorkspaceIdInput: true,
    });
  });

  test("preserves explicit false for workspaceId-forbidden mode", async () => {
    setFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_FORBID_WORKSPACE_ID_INPUT = "0";

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostUrl: "http://127.0.0.1:14327",
      forbidWorkspaceIdInput: false,
    });
  });

  test("rejects invalid workspaceId-forbidden mode values", async () => {
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_FORBID_WORKSPACE_ID_INPUT = "yes";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "ODT_FORBID_WORKSPACE_ID_INPUT must be true, false, 1, or 0.",
    );
  });

  test("fails fast when authenticated readiness fails", async () => {
    setFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "ODT_HOST_BRIDGE_ERROR",
              message: "host down",
            },
          },
          { status: 503, statusText: "Service Unavailable" },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).rejects.toThrow("host down");
  });

  test("discovers a running host from the discovery file when no explicit host is provided", async () => {
    const configDir = await createDiscoveryFile({
      hostToken: " discovery-token ",
      hostUrl: " http://127.0.0.1:14327 ",
    });
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";
    const observedHostTokens: Array<string | undefined> = [];
    setFetchImplementation(async (input, init) => {
      const url = String(input);
      if (url === "http://127.0.0.1:14327/invoke/odt_mcp_ready") {
        observedHostTokens.push(readHeader(init?.headers, "x-openducktor-app-token"));
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url === "http://127.0.0.1:14327/invoke/odt_get_workspaces") {
        observedHostTokens.push(readHeader(init?.headers, "x-openducktor-app-token"));
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
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14327",
      hostToken: "discovery-token",
    });
    expect(observedHostTokens).toEqual(["discovery-token", "discovery-token"]);
  });

  test("discovers the development host only from the dev channel descriptor", async () => {
    const configDir = await createDiscoveryFile({
      hostToken: "production-token",
      hostUrl: "http://127.0.0.1:14327",
    });
    const developmentDirectory = join(
      configDir,
      "runtime",
      "dev-instances",
      "browser-0123456789ab",
    );
    await mkdir(developmentDirectory, { recursive: true });
    await writeFile(
      join(developmentDirectory, "mcp-bridge.json"),
      JSON.stringify(
        {
          hostToken: "development-token",
          hostUrl: "http://127.0.0.1:24327",
          pid: 23456,
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.OPENDUCKTOR_CHANNEL = "dev";
    process.env.OPENDUCKTOR_DEV_INSTANCE = "browser-0123456789ab";
    setFetchImplementation(async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:24327/invoke/odt_mcp_ready") {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostToken: "development-token",
      hostUrl: "http://127.0.0.1:24327",
    });
  });

  test("does not fall back from development discovery to production", async () => {
    const configDir = await createDiscoveryFile();
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.OPENDUCKTOR_CHANNEL = "dev";
    process.env.OPENDUCKTOR_DEV_INSTANCE = "browser-0123456789ab";

    await expect(resolveStoreContext({})).rejects.toThrow(
      join("dev-instances", "browser-0123456789ab", "mcp-bridge.json"),
    );
  });

  test("does not fall back from production discovery to development", async () => {
    const configDir = await createEmptyConfigDir();
    const developmentDirectory = join(
      configDir,
      "runtime",
      "dev-instances",
      "browser-0123456789ab",
    );
    await mkdir(developmentDirectory, { recursive: true });
    await writeFile(
      join(developmentDirectory, "mcp-bridge.json"),
      JSON.stringify({
        hostToken: "development-token",
        hostUrl: "http://127.0.0.1:24327",
        pid: 23456,
      }),
      "utf8",
    );
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;

    await expect(resolveStoreContext({})).rejects.toThrow("mcp-bridge.json");
  });

  test("fails clearly when discovery cannot find any running host", async () => {
    const configDir = await createEmptyConfigDir();
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "No running OpenDucktor host was discovered",
    );
  });

  test("keeps discovery context when the discovered host URL is invalid", async () => {
    const configDir = await createDiscoveryFile({ hostUrl: "not-a-url" });
    const discoveryPath = join(configDir, "runtime", "mcp-bridge.json");
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;

    try {
      await resolveStoreContext({});
      throw new Error("Expected resolveStoreContext() to reject.");
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toStartWith(
        `No healthy OpenDucktor host was discovered. Checked ${discoveryPath}. not-a-url: `,
      );
      expect(error.message).toEndWith(" Provide ODT_HOST_URL to override discovery.");
    }
  });

  test("prioritizes a delayed readiness failure over a missing configured workspace", async () => {
    const configDir = await createDiscoveryFile();
    const discoveryPath = join(configDir, "runtime", "mcp-bridge.json");
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "missing-repo";

    let releaseReadiness = (): void => {
      throw new Error("Readiness barrier was not initialized.");
    };
    const readinessBarrier = new Promise<void>((resolve) => {
      releaseReadiness = resolve;
    });
    setFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        await readinessBarrier;
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: ["odt_mcp_ready"],
        });
      }
      if (url.endsWith("/invoke/odt_get_workspaces")) {
        return jsonResponse({ workspaces: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const contextOutcome = resolveStoreContext({}).then(
      () => ({ status: "fulfilled" as const }),
      (cause: unknown) => ({ status: "rejected" as const, error: cause }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseReadiness();

    const outcome = await contextOutcome;
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") {
      throw new Error("Expected resolveStoreContext() to reject.");
    }
    if (!(outcome.error instanceof Error)) {
      throw outcome.error;
    }
    expect(outcome.error.message).toStartWith(
      `No healthy OpenDucktor host was discovered. Checked ${discoveryPath}. http://127.0.0.1:14327: OpenDucktor host bridge is missing required MCP tools:`,
    );
  });

  test("preserves the exact unknown-workspace error during host discovery", async () => {
    const configDir = await createDiscoveryFile();
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    setFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url.endsWith("/invoke/odt_get_workspaces")) {
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
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    process.env.ODT_WORKSPACE_ID = "missing-repo";

    await expect(resolveStoreContext({})).rejects.toMatchObject({
      message:
        "Configured default workspace 'missing-repo' was not found on the running OpenDucktor host. Start @openducktor/mcp with a valid --workspace-id or omit it and provide workspaceId per tool call.",
    });
  });
});
