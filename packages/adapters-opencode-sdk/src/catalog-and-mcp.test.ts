import { describe, expect, mock, test } from "bun:test";
import { listAvailableSlashCommands, searchFiles } from "./catalog-and-mcp";

describe("catalog-and-mcp listAvailableSlashCommands", () => {
  test("normalizes command payloads into a slash catalog", async () => {
    const list = mock(async () => ({
      data: [
        { name: "review", description: "Review changes", source: "command", hints: ["$ARG"] },
        { name: "mcp-prompt", source: "mcp", hints: [] },
        { name: "skill-run", source: "skill", hints: ["one", "two"] },
        { name: "unknown-source", source: "other", hints: ["ignored"] },
        { name: "   " },
        {},
      ],
      error: undefined,
    }));
    const createClient = mock(() => ({ command: { list } }));

    const catalog = await listAvailableSlashCommands(createClient as never, {
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: "/repo",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: "/repo",
    });
    expect(list).toHaveBeenCalledWith({ directory: "/repo" });
    expect(catalog.commands).toEqual([
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
      {
        id: "unknown-source",
        trigger: "unknown-source",
        title: "unknown-source",
        hints: ["ignored"],
      },
    ]);
  });

  test("fails when the runtime does not expose command listing", async () => {
    await expect(
      listAvailableSlashCommands((() => ({})) as never, {
        runtimeEndpoint: "http://127.0.0.1:1234",
        workingDirectory: "/repo",
      }),
    ).rejects.toThrow(
      "OpenCode request failed: list slash commands: OpenCode runtime does not expose the command listing API.",
    );
  });

  test("fails when the slash command payload is not an array", async () => {
    await expect(
      listAvailableSlashCommands(
        (() => ({ command: { list: async () => ({ data: {} }) } })) as never,
        {
          runtimeEndpoint: "http://127.0.0.1:1234",
          workingDirectory: "/repo",
        },
      ),
    ).rejects.toThrow(
      "OpenCode request failed: list slash commands: Invalid slash command payload: expected an array.",
    );
  });

  test("wraps command listing failures with context", async () => {
    await expect(
      listAvailableSlashCommands(
        (() => ({
          command: {
            list: async () => {
              throw new Error("boom");
            },
          },
        })) as never,
        {
          runtimeEndpoint: "http://127.0.0.1:1234",
          workingDirectory: "/repo",
        },
      ),
    ).rejects.toThrow("OpenCode request failed: list slash commands: boom");
  });

  test("rejects duplicate slash command triggers at runtime", async () => {
    await expect(
      listAvailableSlashCommands(
        (() => ({
          command: {
            list: async () => ({
              data: [
                { name: "review", hints: [] },
                { name: "review", hints: [] },
              ],
            }),
          },
        })) as never,
        {
          runtimeEndpoint: "http://127.0.0.1:1234",
          workingDirectory: "/repo",
        },
      ),
    ).rejects.toThrow(/Duplicate slash command trigger: review/);
  });
});

describe("catalog-and-mcp searchFiles", () => {
  test("merges directory and file hits into normalized file search results", async () => {
    const files = mock(async (input: { type?: string }) => ({
      data:
        input.type === "directory"
          ? ["src/components", "/repo/src/styles"]
          : ["src/components/button.tsx", "src/styles.css"],
      error: undefined,
    }));
    const createClient = mock(() => ({ find: { files } }));

    const results = await searchFiles(createClient as never, {
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: "/repo",
      query: "src",
    });

    expect(createClient).toHaveBeenCalledWith({
      runtimeEndpoint: "http://127.0.0.1:1234",
      workingDirectory: "/repo",
    });
    expect(files).toHaveBeenCalledTimes(2);
    expect(files).toHaveBeenNthCalledWith(1, {
      directory: "/repo",
      query: "src",
      dirs: "true",
      type: "directory",
      limit: 20,
    });
    expect(files).toHaveBeenNthCalledWith(2, {
      directory: "/repo",
      query: "src",
      dirs: "false",
      type: "file",
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
        kind: "ts",
      },
      {
        id: "src/styles",
        path: "src/styles",
        name: "styles",
        kind: "directory",
      },
      {
        id: "src/styles.css",
        path: "src/styles.css",
        name: "styles.css",
        kind: "css",
      },
    ]);
  });

  test("fails when the runtime does not expose file search", async () => {
    await expect(
      searchFiles((() => ({})) as never, {
        runtimeEndpoint: "http://127.0.0.1:1234",
        workingDirectory: "/repo",
        query: "src",
      }),
    ).rejects.toThrow(
      "OpenCode request failed: search files: OpenCode runtime does not expose the file search API.",
    );
  });

  test("fails when the runtime returns a malformed payload", async () => {
    const files = mock(async (input: { type?: string }) => ({
      data: input.type === "directory" ? [] : { bad: true },
      error: undefined,
    }));

    await expect(
      searchFiles((() => ({ find: { files } })) as never, {
        runtimeEndpoint: "http://127.0.0.1:1234",
        workingDirectory: "/repo",
        query: "src",
      }),
    ).rejects.toThrow(
      "OpenCode request failed: search files: Invalid file search payload: expected an array of file paths.",
    );
  });
});
