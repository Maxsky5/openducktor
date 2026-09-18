import { describe, expect, mock, test } from "bun:test";
import type { Agent, Command } from "@opencode-ai/sdk/v2/client";
import { loadRuntimeCatalog, searchFiles } from "./catalog-and-mcp";

const commandFixture = (overrides: Partial<Command>): Command => ({
  hints: [],
  name: "command",
  template: "",
  ...overrides,
});

const agentFixture = (overrides: Partial<Agent>): Agent => ({
  mode: "subagent",
  name: "agent",
  options: {},
  permission: [],
  ...overrides,
});

type CatalogClient = {
  app: { agents: (input: { directory: string }) => Promise<{ data: unknown; error?: unknown }> };
  config: {
    providers: (input: { directory: string }) => Promise<{ data: unknown; error?: unknown }>;
  };
  command: { list: (input: { directory: string }) => Promise<{ data: unknown; error?: unknown }> };
};

const catalogClient = (overrides: Partial<CatalogClient>): CatalogClient => ({
  app: {
    agents: async () => {
      throw new Error("Unexpected agent list read.");
    },
  },
  config: {
    providers: async () => {
      throw new Error("Unexpected provider list read.");
    },
  },
  command: {
    list: async () => {
      throw new Error("Unexpected command list read.");
    },
  },
  ...overrides,
});

const loadCatalog = (
  client: CatalogClient,
  directory = "/repo",
): ReturnType<typeof loadRuntimeCatalog> =>
  loadRuntimeCatalog(
    // SAFETY: The test client implements the three catalog namespaces used by the loader.
    (() => client) as never,
    {
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: directory,
      repoPath: directory,
    },
  );

const failureMessage = (surface: { status: string; cause?: unknown } | undefined): string => {
  if (surface?.status !== "failed") {
    throw new Error(`Expected a failed surface, received ${surface?.status ?? "no surface"}.`);
  }
  return String(surface.cause);
};

describe("catalog-and-mcp combined runtime catalog", () => {
  test("normalizes command payloads into the slash command surface", async () => {
    const list = mock(async () => ({
      data: [
        commandFixture({
          name: "review",
          description: "Review changes",
          source: "command",
          hints: ["$ARG"],
        }),
        commandFixture({ name: "mcp-prompt", source: "mcp" }),
        commandFixture({ name: "skill-run", source: "skill", hints: ["one", "two"] }),
      ],
      error: undefined,
    }));

    const catalog = await loadCatalog(catalogClient({ command: { list } }));

    expect(list).toHaveBeenCalledWith({ directory: "/repo" });
    expect(catalog.slashCommands).toEqual({
      status: "available",
      catalog: {
        commands: [
          {
            id: "system:compact",
            trigger: "compact",
            title: "Compact session",
            description: "Summarize the current session to reduce context size",
            source: "system",
            hints: [],
          },
          {
            id: "mcp-prompt",
            trigger: "mcp-prompt",
            title: "mcp-prompt",
            source: "mcp",
            hints: [],
          },
          {
            id: "review",
            trigger: "review",
            title: "review",
            description: "Review changes",
            source: "command",
            hints: ["$ARG"],
          },
          {
            id: "skill-run",
            trigger: "skill-run",
            title: "skill-run",
            source: "skill",
            hints: ["one", "two"],
          },
        ],
      },
    });
  });

  test("stamps the OpenCode runtime descriptor on the combined read", async () => {
    const catalog = await loadCatalog(catalogClient({}));

    expect(catalog.runtime?.kind).toBe("opencode");
  });

  test("reserves compact case-insensitively after a successful runtime read", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        command: {
          list: async () => ({
            data: [
              commandFixture({ name: "Compact", source: "command" }),
              commandFixture({ name: "review", source: "command" }),
            ],
          }),
        },
      }),
    );

    expect(catalog.slashCommands).toMatchObject({ status: "available" });
    const commands =
      catalog.slashCommands?.status === "available"
        ? catalog.slashCommands.catalog.commands.map((command) => command.id)
        : [];
    expect(commands).toEqual(["system:compact", "review"]);
  });

  test("accepts nullable metadata and lazy templates from the runtime", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        command: {
          list: async () => ({
            data: [
              {
                name: "review",
                description: null,
                agent: null,
                model: null,
                source: null,
                template: {},
                subtask: null,
                hints: [],
              },
            ],
          }),
        },
      }),
    );

    const ids =
      catalog.slashCommands?.status === "available"
        ? catalog.slashCommands.catalog.commands.map((command) => command.id)
        : [];
    expect(ids).toEqual(["system:compact", "review"]);
  });

  test("fails the slash command surface when the payload is not an array", async () => {
    const catalog = await loadCatalog(
      catalogClient({ command: { list: async () => ({ data: {} }) } }),
    );

    expect(failureMessage(catalog.slashCommands)).toContain(
      "OpenCode request failed: list slash commands: Invalid slash command payload: expected an array.",
    );
  });

  test("wraps command listing failures with context", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        command: {
          list: async () => {
            throw new Error("boom");
          },
        },
      }),
    );

    expect(failureMessage(catalog.slashCommands)).toContain(
      "OpenCode request failed: list slash commands: boom",
    );
  });

  test("fails a surface without removing the other surfaces from the catalog", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        app: {
          agents: async () => ({
            data: [agentFixture({ name: "reviewer", hidden: false })],
          }),
        },
        command: {
          list: async () => {
            throw new Error("boom");
          },
        },
      }),
    );

    expect(catalog.slashCommands?.status).toBe("failed");
    expect(catalog.subagents).toMatchObject({
      status: "available",
      catalog: { subagents: [{ id: "reviewer", name: "reviewer", label: "reviewer" }] },
    });
  });

  test("reuses one agent list read when the repository root is the working directory", async () => {
    const agents = mock(async () => ({
      data: [agentFixture({ name: "reviewer", hidden: false })],
    }));

    await loadCatalog(catalogClient({ app: { agents } }));

    expect(agents).toHaveBeenCalledTimes(1);
    expect(agents).toHaveBeenCalledWith({ directory: "/repo" });
  });

  test("reads the agent list once per directory when the working directory differs", async () => {
    const agents = mock(async (input: { directory: string }) => ({
      data: input.directory === "/repo" ? [] : [agentFixture({ name: "reviewer", hidden: false })],
    }));

    await loadRuntimeCatalog(
      // SAFETY: The test client implements the three catalog namespaces used by the loader.
      (() =>
        catalogClient({
          app: { agents },
          config: {
            providers: async () => ({ data: { default: {}, providers: [] } }),
          },
        })) as never,
      {
        runtimeEndpoint: "http://127.0.0.1:1234",
        workingDirectory: "/worktrees/task",
        repoPath: "/repo",
      },
    );

    expect(agents).toHaveBeenCalledTimes(2);
    expect(agents).toHaveBeenCalledWith({ directory: "/repo" });
    expect(agents).toHaveBeenCalledWith({ directory: "/worktrees/task" });
  });

  test("rejects duplicate slash command triggers at runtime", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        command: {
          list: async () => ({
            data: [commandFixture({ name: "review" }), commandFixture({ name: "review" })],
          }),
        },
      }),
    );

    expect(failureMessage(catalog.slashCommands)).toMatch(
      /Duplicate slash command trigger: review/,
    );
  });

  test("filters visible non-primary agents into the subagent surface", async () => {
    const agents = mock(async () => ({
      data: [
        agentFixture({
          name: " reviewer ",
          description: " Review changes ",
          hidden: false,
        }),
        agentFixture({ name: "planner", hidden: false, mode: "all" }),
        agentFixture({ name: "build", hidden: false, mode: "primary" }),
        agentFixture({ name: "secret", hidden: true }),
      ],
      error: undefined,
    }));

    const catalog = await loadCatalog(catalogClient({ app: { agents } }));

    expect(agents).toHaveBeenCalledWith({ directory: "/repo" });
    expect(catalog.subagents).toEqual({
      status: "available",
      catalog: {
        subagents: [
          {
            id: "planner",
            name: "planner",
            label: "planner",
          },
          {
            id: "reviewer",
            name: "reviewer",
            label: "reviewer",
            description: "Review changes",
          },
        ],
      },
    });
  });

  test("fails the subagent surface for malformed agent payloads", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        app: { agents: async () => ({ data: [{ description: "missing name" }] }) },
      }),
    );

    expect(failureMessage(catalog.subagents)).toContain("OpenCode request failed: list subagents:");
  });

  test("fails the subagent surface for duplicate ids after trimming runtime names", async () => {
    const catalog = await loadCatalog(
      catalogClient({
        app: {
          agents: async () => ({
            data: [
              agentFixture({ name: " reviewer" }),
              agentFixture({ name: "reviewer ", mode: "all" }),
            ],
          }),
        },
      }),
    );

    expect(failureMessage(catalog.subagents)).toMatch(/Duplicate subagent id: reviewer/);
  });

  test("omits the skills surface because OpenCode has no skill catalog", async () => {
    const catalog = await loadCatalog(catalogClient({}));

    expect(catalog.skills).toBeUndefined();
  });
});

describe("catalog-and-mcp searchFiles", () => {
  test("preserves runtime ordering when normalizing file search results", async () => {
    const files = mock(async () => ({
      data: [
        "src/components/",
        "src/components/button.tsx",
        "src/styles.scss",
        "assets/preview.webp",
        "recordings/demo.webm",
      ],
      error: undefined,
    }));
    const createClient = mock(() => ({ find: { files } }));

    const results = await searchFiles(createClient, {
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: "/repo",
      query: "src",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: "/repo",
    });
    expect(files).toHaveBeenCalledTimes(1);
    expect(files).toHaveBeenCalledWith({
      directory: "/repo",
      query: "src",
      limit: 20,
    });
    expect(results).toEqual([
      {
        id: "src/components",
        path: "src/components",
        name: "components",
        kind: "directory",
      },
      {
        id: "src/components/button.tsx",
        path: "src/components/button.tsx",
        name: "button.tsx",
        kind: "code",
      },
      {
        id: "src/styles.scss",
        path: "src/styles.scss",
        name: "styles.scss",
        kind: "css",
      },
      {
        id: "assets/preview.webp",
        path: "assets/preview.webp",
        name: "preview.webp",
        kind: "image",
      },
      {
        id: "recordings/demo.webm",
        path: "recordings/demo.webm",
        name: "demo.webm",
        kind: "video",
      },
    ]);
  });

  test("fails when the runtime returns a malformed payload", async () => {
    const files = mock(async (input: { type?: string }) => ({
      data: input.type === "directory" ? [] : { bad: true },
      error: undefined,
    }));

    await expect(
      searchFiles(() => ({ find: { files } }), {
        runtimeEndpoint: "http://127.0.0.1:1234",
        workingDirectory: "/repo",
        query: "src",
      }),
    ).rejects.toThrow(
      "OpenCode request failed: search files: Invalid file search payload: expected an array of file paths.",
    );
  });
});
