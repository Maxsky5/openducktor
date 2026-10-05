import { describe, expect, test } from "bun:test";
import {
  createOpencodeClient,
  type McpStatus,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client";
import type { ManagedMcpServer } from "@openducktor/core";
import {
  createOpencodeMcpDirectoryBindings,
  type OpencodeMcpReconnectEvent,
} from "./opencode-mcp-bindings";

type AddCall = {
  directory: string | undefined;
  name: string | undefined;
  config: unknown;
};

const createFakeMcpClient = (
  input: {
    addStatuses?: McpStatus[];
    status?: McpStatus | undefined;
    holdAdd?: Promise<void>;
  } = {},
) => {
  const addCalls: AddCall[] = [];
  const statusCalls: Array<string | undefined> = [];
  const addStatuses = [...(input.addStatuses ?? [])];
  let status = input.status;
  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
  const client: OpencodeClient = {
    ...baseClient,
    mcp: {
      ...baseClient.mcp,
      add: async (parameters?: { directory?: string; name?: string; config?: unknown }) => {
        addCalls.push({
          directory: parameters?.directory,
          name: parameters?.name,
          config: parameters?.config,
        });
        await input.holdAdd;
        const next = addStatuses.shift() ?? { status: "connected" as const };
        return { data: { openducktor: next }, error: undefined };
      },
      status: async (parameters?: { directory?: string }) => {
        statusCalls.push(parameters?.directory);
        return { data: status ? { openducktor: status } : {}, error: undefined };
      },
    },
  };
  return {
    client,
    addCalls,
    statusCalls,
    setStatus: (next: McpStatus | undefined) => {
      status = next;
    },
  };
};

const configFor = (repoPath: string): ManagedMcpServer => ({
  command: ["openducktor-mcp", "--stdio"],
  environment: { ODT_WORKSPACE_ID: `workspace:${repoPath}` },
});

const createBindings = () => {
  const resolved: string[] = [];
  const bindings = createOpencodeMcpDirectoryBindings({
    resolveServerConfig: async (repoPath) => {
      resolved.push(repoPath);
      return configFor(repoPath);
    },
  });
  return { bindings, resolved };
};

describe("OpenCode MCP directory bindings", () => {
  test("adds the workspace server once and reuses a connected binding", async () => {
    const fake = createFakeMcpClient({ status: { status: "connected" } });
    const { bindings, resolved } = createBindings();

    await bindings.ensure({
      client: fake.client,
      workingDirectory: "/repo-a",
      repoPath: "/repo-a",
    });
    await bindings.ensure({
      client: fake.client,
      workingDirectory: "/repo-a/",
      repoPath: "/repo-a",
    });

    expect(resolved).toEqual(["/repo-a"]);
    expect(fake.addCalls).toEqual([
      {
        directory: "/repo-a",
        name: "openducktor",
        config: {
          type: "local",
          command: ["openducktor-mcp", "--stdio"],
          environment: { ODT_WORKSPACE_ID: "workspace:/repo-a" },
          enabled: true,
        },
      },
    ]);
    expect(fake.statusCalls).toEqual(["/repo-a/"]);
  });

  test("shares concurrent setup of one directory", async () => {
    let release: () => void = () => undefined;
    const holdAdd = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeMcpClient({ holdAdd });
    const { bindings } = createBindings();

    const first = bindings.ensure({ client: fake.client, workingDirectory: "/wt", repoPath: "/a" });
    const second = bindings.ensure({
      client: fake.client,
      workingDirectory: "/wt",
      repoPath: "/a",
    });
    release();
    await Promise.all([first, second]);

    expect(fake.addCalls).toHaveLength(1);
    expect(fake.statusCalls).toEqual([]);
  });

  test("rejects a directory already bound to another workspace", async () => {
    const fake = createFakeMcpClient({ status: { status: "connected" } });
    const { bindings } = createBindings();
    await bindings.ensure({ client: fake.client, workingDirectory: "/shared", repoPath: "/a" });

    await expect(
      bindings.ensure({ client: fake.client, workingDirectory: "/shared", repoPath: "/b" }),
    ).rejects.toThrow(
      'Cannot use OpenCode directory "/shared" for repository "/b": its OpenDucktor MCP server is bound to repository "/a".',
    );
    expect(fake.addCalls).toHaveLength(1);
  });

  test("binds each directory to its own workspace", async () => {
    const fake = createFakeMcpClient();
    const { bindings } = createBindings();

    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" });
    await bindings.ensure({ client: fake.client, workingDirectory: "/b", repoPath: "/b" });

    expect(fake.addCalls.map(({ directory, config }) => ({ directory, config }))).toEqual([
      {
        directory: "/a",
        config: expect.objectContaining({ environment: configFor("/a").environment }),
      },
      {
        directory: "/b",
        config: expect.objectContaining({ environment: configFor("/b").environment }),
      },
    ]);
  });

  test("rejects a failed add status and keeps the directory unbound", async () => {
    const fake = createFakeMcpClient({
      addStatuses: [{ status: "failed", error: "spawn ENOENT" }, { status: "connected" }],
    });
    const { bindings } = createBindings();

    await expect(
      bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" }),
    ).rejects.toThrow(
      'ODT workflow tools unavailable for "/a": OpenCode did not connect MCP server "openducktor" for repository "/a". Status is "failed" (spawn ENOENT).',
    );

    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/b" });
    expect(fake.addCalls.map((call) => call.config)).toEqual([
      expect.objectContaining({ environment: configFor("/a").environment }),
      expect.objectContaining({ environment: configFor("/b").environment }),
    ]);
  });

  test("adds the server again after the directory instance is disposed", async () => {
    const fake = createFakeMcpClient({ status: { status: "connected" } });
    const { bindings } = createBindings();
    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" });

    bindings.forget("/a/");
    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" });

    expect(fake.addCalls).toHaveLength(2);
    expect(fake.statusCalls).toEqual([]);
  });

  test("reconnects a bound server that lost its connection once and reports the start", async () => {
    const fake = createFakeMcpClient({
      status: { status: "failed", error: "Connection closed" },
      addStatuses: [{ status: "connected" }, { status: "connected" }],
    });
    const { bindings } = createBindings();
    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" });
    const reconnects: OpencodeMcpReconnectEvent[] = [];

    await bindings.ensure({
      client: fake.client,
      workingDirectory: "/a",
      repoPath: "/a",
      onReconnectStart: (event) => reconnects.push(event),
    });

    expect(reconnects).toEqual([
      {
        serverName: "openducktor",
        workingDirectory: "/a",
        status: "failed",
        errorDetails: "Connection closed",
      },
    ]);
    expect(fake.addCalls).toHaveLength(2);
  });

  test("fails with an actionable error when the reconnect does not connect", async () => {
    const fake = createFakeMcpClient({
      addStatuses: [{ status: "connected" }, { status: "failed", error: "still closed" }],
    });
    const { bindings } = createBindings();
    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" });
    fake.setStatus(undefined);

    await expect(
      bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" }),
    ).rejects.toThrow(
      'Status is "failed" (still closed). Status before reconnect was "missing". Check the OpenDucktor MCP bridge in Diagnostics and retry.',
    );
    await expect(
      bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/b" }),
    ).rejects.toThrow('its OpenDucktor MCP server is bound to repository "/a"');
  });

  test("clear forgets every binding", async () => {
    const fake = createFakeMcpClient();
    const { bindings } = createBindings();
    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/a" });
    await bindings.ensure({ client: fake.client, workingDirectory: "/b", repoPath: "/b" });

    bindings.clear();
    await bindings.ensure({ client: fake.client, workingDirectory: "/a", repoPath: "/b" });

    expect(fake.addCalls.map((call) => call.directory)).toEqual(["/a", "/b", "/a"]);
    expect(fake.statusCalls).toEqual([]);
  });
  test("a status read that outlives its binding never authorizes the operation", async () => {
    let releaseStatus = (): void => {};
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const fake = createFakeMcpClient({ status: { status: "connected" } });
    const baseStatus = fake.client.mcp.status;
    let holdStatus = false;
    fake.client.mcp.status = async (parameters) => {
      if (holdStatus) await statusGate;
      return baseStatus(parameters);
    };
    const { bindings } = createBindings();
    await bindings.ensure({
      client: fake.client,
      workingDirectory: "/shared",
      repoPath: "/repo-a",
    });

    holdStatus = true;
    const staleRead = bindings.ensure({
      client: fake.client,
      workingDirectory: "/shared",
      repoPath: "/repo-a",
    });
    await Promise.resolve();
    bindings.forget("/shared");
    holdStatus = false;
    await bindings.ensure({
      client: fake.client,
      workingDirectory: "/shared",
      repoPath: "/repo-b",
    });
    releaseStatus();

    await expect(staleRead).rejects.toThrow('bound to repository "/repo-b"');
    await expect(
      bindings.ensure({ client: fake.client, workingDirectory: "/shared", repoPath: "/repo-a" }),
    ).rejects.toThrow('bound to repository "/repo-b"');
  });

  test("a setup released by disposal fails, and a later binding is added after it", async () => {
    let releaseAdd = (): void => {};
    const holdAdd = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const fake = createFakeMcpClient({ holdAdd });
    const { bindings } = createBindings();

    const first = bindings.ensure({
      client: fake.client,
      workingDirectory: "/shared",
      repoPath: "/repo-a",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    bindings.forget("/shared");
    const second = bindings.ensure({
      client: fake.client,
      workingDirectory: "/shared",
      repoPath: "/repo-b",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second `mcp.add` waits until the first native setup settled.
    expect(fake.addCalls).toHaveLength(1);
    releaseAdd();

    await expect(first).rejects.toThrow("released this directory");
    await second;
    expect(fake.addCalls.map((call) => call.config)).toEqual([
      expect.objectContaining({ environment: { ODT_WORKSPACE_ID: "workspace:/repo-a" } }),
      expect.objectContaining({ environment: { ODT_WORKSPACE_ID: "workspace:/repo-b" } }),
    ]);
    await expect(
      bindings.ensure({ client: fake.client, workingDirectory: "/shared", repoPath: "/repo-a" }),
    ).rejects.toThrow('bound to repository "/repo-b"');
  });
});
