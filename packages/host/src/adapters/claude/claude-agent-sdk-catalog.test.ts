import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelInfo, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  searchClaudeWorkspaceFiles,
  toClaudeHistoryMessages,
  toClaudeModelDescriptor,
  toClaudeSkillCatalog,
  toClaudeSlashCommandCatalog,
} from "./claude-agent-sdk-catalog";

const tempWorkspaces: string[] = [];

const createTempWorkspace = async (): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-files-"));
  tempWorkspaces.push(workspace);
  return workspace;
};

afterEach(async () => {
  await Promise.all(
    tempWorkspaces.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("searchClaudeWorkspaceFiles", () => {
  test("returns initial file candidates for empty autocomplete queries", async () => {
    const workspace = await createTempWorkspace();
    await writeFile(join(workspace, "README.md"), "# Project\n");

    await expect(
      searchClaudeWorkspaceFiles({
        repoPath: workspace,
        runtimeKind: "claude",
        workingDirectory: workspace,
        query: "",
      }),
    ).resolves.toEqual([
      {
        id: "README.md",
        path: "README.md",
        name: "README.md",
        kind: "code",
      },
    ]);
  });
});

describe("toClaudeModelDescriptor", () => {
  test("maps Claude SDK effort levels to OpenDucktor variants", () => {
    const descriptor = toClaudeModelDescriptor({
      value: "claude-sonnet-4-6-20260601",
      displayName: "Claude Sonnet 4.6",
      description: "Claude Sonnet",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    } satisfies ModelInfo);

    expect(descriptor).toMatchObject({
      id: "claude-sonnet-4-6-20260601",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-sonnet-4-6-20260601",
      modelName: "Claude Sonnet 4.6",
      attachmentSupport: {
        audio: false,
        image: true,
        pdf: true,
        video: false,
        mimeTypes: {
          image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
          pdf: ["application/pdf"],
        },
      },
      variants: ["low", "medium", "high", "xhigh", "max"],
      liveSessionUpdates: {
        profile: false,
        variants: ["low", "medium", "high", "xhigh"],
      },
    });
  });

  test("leaves variants empty when the SDK does not expose effort levels", () => {
    const descriptor = toClaudeModelDescriptor({
      value: "claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      description: "Claude Haiku",
    } satisfies ModelInfo);

    expect(descriptor.variants).toEqual([]);
  });
});

describe("toClaudeSlashCommandCatalog", () => {
  test("maps Claude slash commands into OpenDucktor catalogs", () => {
    expect(
      toClaudeSlashCommandCatalog([
        {
          name: "thermos",
          description: "Run thermos review",
          argumentHint: "[scope]",
        },
        {
          name: "review",
        },
      ] as never),
    ).toEqual({
      commands: [
        {
          id: "review",
          trigger: "review",
          title: "review",
          source: "command",
          hints: [],
        },
        {
          id: "thermos",
          trigger: "thermos",
          title: "thermos",
          description: "Run thermos review",
          source: "command",
          hints: ["[scope]"],
        },
      ],
    });
  });

  test("keeps the first SDK definition when inherited scopes expose the same command", () => {
    expect(
      toClaudeSlashCommandCatalog([
        {
          name: "code-review",
          description: "User code review command",
          argumentHint: "",
        },
        {
          name: "code-review",
          description: "Plugin code review command",
          argumentHint: "[effort]",
        },
      ]),
    ).toEqual({
      commands: [
        {
          id: "code-review",
          trigger: "code-review",
          title: "code-review",
          description: "User code review command",
          source: "command",
          hints: [],
        },
      ],
    });
  });
});

describe("toClaudeSkillCatalog", () => {
  test("keeps the first SDK definition when inherited scopes expose the same skill", () => {
    expect(
      toClaudeSkillCatalog([
        {
          name: "code-review",
          description: "User code review skill",
          argumentHint: "",
        },
        {
          name: "code-review",
          description: "Plugin code review skill",
          argumentHint: "[effort]",
        },
        {
          name: "research",
          description: "Research a topic",
          argumentHint: "[topic]",
        },
      ]),
    ).toEqual({
      skills: [
        {
          id: "code-review",
          name: "code-review",
          path: "code-review",
          title: "code-review",
          description: "User code review skill",
        },
        {
          id: "research",
          name: "research",
          path: "research",
          title: "research",
          description: "Research a topic",
        },
      ],
    });
  });
});

describe("toClaudeHistoryMessages", () => {
  test("skips empty user and assistant transcript envelopes", () => {
    const history = toClaudeHistoryMessages(
      [
        {
          type: "user",
          uuid: "user-empty",
          parent_tool_use_id: null,
          message: { role: "user", content: [] },
        },
        {
          type: "assistant",
          uuid: "assistant-empty",
          parent_tool_use_id: null,
          message: { role: "assistant", content: [] },
        },
      ] as unknown as SessionMessage[],
      () => "2026-06-25T20:00:00.000Z",
    );

    expect(history).toEqual([]);
  });

  test("hydrates Claude tool-use and tool-result entries as tool parts instead of blank messages", () => {
    const history = toClaudeHistoryMessages(
      [
        {
          type: "assistant",
          uuid: "assistant-tool",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "mcp__openducktor__odt_read_task",
                input: { taskId: "fairnest-io69" },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "user-tool-result",
          parent_tool_use_id: "tool-1",
          tool_use_result: {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [{ type: "text", text: "task loaded" }],
          },
          message: { role: "user", content: [] },
        },
      ] as unknown as SessionMessage[],
      () => "2026-06-25T20:00:00.000Z",
    );

    expect(history).toEqual([
      expect.objectContaining({
        messageId: "assistant-tool",
        role: "assistant",
        text: "",
        parts: [
          expect.objectContaining({
            kind: "tool",
            callId: "tool-1",
            output: "task loaded",
            status: "completed",
            tool: "mcp__openducktor__odt_read_task",
            toolType: "workflow",
          }),
        ],
      }),
    ]);
  });
});
