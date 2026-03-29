import { describe, expect, mock, test } from "bun:test";
import { listAvailableSlashCommands } from "./catalog-and-mcp";

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
