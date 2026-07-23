import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeClaudePromptText, toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import { mutationForTool, toolPartType } from "./claude-agent-sdk-utils";

const slashCommand = {
  id: "review",
  trigger: "review",
  title: "Review",
  source: "command" as const,
  hints: [],
};

const fileReference = {
  id: "src/index.ts",
  path: "src/index.ts",
  name: "index.ts",
  kind: "code" as const,
};

describe("encodeClaudePromptText", () => {
  test("encodes SDK-native slash commands and file references as Claude prompt text", () => {
    expect(
      encodeClaudePromptText([
        { kind: "slash_command", command: slashCommand },
        { kind: "text", text: " " },
        { kind: "file_reference", file: fileReference },
        { kind: "text", text: " please" },
      ]),
    ).toBe("/review @src/index.ts please");
  });

  test("preserves whitespace in SDK-native slash command names", () => {
    expect(
      encodeClaudePromptText([
        {
          kind: "slash_command",
          command: {
            id: "gitnexus:generate_map (MCP)",
            trigger: "gitnexus:generate_map (MCP)",
            title: "gitnexus:generate_map (MCP)",
            source: "command",
            hints: ["repo"],
          },
        },
      ]),
    ).toBe("/gitnexus:generate_map (MCP)");
  });

  test("rejects slash-command parts without a native Claude trigger", () => {
    expect(() =>
      encodeClaudePromptText([
        {
          kind: "slash_command",
          command: {
            id: "review",
            title: "Review",
            source: "command",
            hints: [],
          } as never,
        },
      ]),
    ).toThrow("cannot encode a slash command without a trigger");
  });

  test("encodes skill mentions as Claude skill slash commands", () => {
    expect(
      encodeClaudePromptText([
        {
          kind: "skill_mention",
          skill: {
            id: "pdf",
            name: "pdf",
            path: "pdf",
          },
        },
        { kind: "text", text: " summarize this" },
      ]),
    ).toBe("/pdf summarize this");
  });

  test("rejects explicit subagent references that Claude does not advertise", () => {
    expect(() =>
      encodeClaudePromptText([
        {
          kind: "subagent_reference",
          subagent: { id: "reviewer", name: "reviewer" },
        },
      ]),
    ).toThrow("does not support explicit subagent references");
  });

  test("rejects attachments instead of silently dropping them", () => {
    expect(() =>
      encodeClaudePromptText([
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "pdf",
            name: "invoice.pdf",
            path: "/tmp/invoice.pdf",
          },
        },
      ]),
    ).toThrow("cannot encode pdf attachment");
  });
});

describe("toolPartType", () => {
  test("classifies Claude task tools as TODO tools", () => {
    expect(toolPartType("TaskCreate")).toBe("todo");
    expect(toolPartType("TaskUpdate")).toBe("todo");
    expect(toolPartType("TaskGet")).toBe("todo");
    expect(toolPartType("TaskList")).toBe("todo");
  });

  test("classifies Claude AskUserQuestion tool rows as question tools", () => {
    expect(toolPartType("AskUserQuestion")).toBe("question");
    expect(toolPartType("permission_ask_user_question")).toBe("question");
  });
});

describe("toClaudeMessageFromParts", () => {
  test("encodes text-only slash commands as Claude SDK content blocks", async () => {
    await expect(
      toClaudeMessageFromParts([
        { kind: "slash_command", command: slashCommand },
        { kind: "text", text: " src/index.ts" },
      ]),
    ).resolves.toEqual({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: "/review src/index.ts" }],
      },
    });
  });

  test("encodes image attachments as Claude SDK content blocks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-attachment-"));
    try {
      const imagePath = join(workspace, "screenshot.png");
      await writeFile(imagePath, Buffer.from("png-bytes"));

      await expect(
        toClaudeMessageFromParts([
          { kind: "text", text: "Inspect this" },
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "image",
              mime: "image/png",
              name: "screenshot.png",
              path: imagePath,
            },
          },
          { kind: "text", text: " please" },
        ]),
      ).resolves.toEqual({
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            { type: "text", text: "Inspect this" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: Buffer.from("png-bytes").toString("base64"),
              },
            },
            { type: "text", text: "please" },
          ],
        },
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("encodes PDF attachments as Claude SDK document blocks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-attachment-"));
    try {
      const pdfPath = join(workspace, "brief.pdf");
      await writeFile(pdfPath, Buffer.from("%PDF"));

      await expect(
        toClaudeMessageFromParts([
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "pdf",
              mime: "application/pdf",
              name: "brief.pdf",
              path: pdfPath,
            },
          },
        ]),
      ).resolves.toMatchObject({
        message: {
          content: [
            {
              type: "document",
              title: "brief.pdf",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: Buffer.from("%PDF").toString("base64"),
              },
            },
          ],
        },
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("rejects image MIME types the Claude SDK message contract does not support", async () => {
    await expect(
      toClaudeMessageFromParts([
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "image",
            mime: "image/heic",
            name: "photo.heic",
            path: "/tmp/photo.heic",
          },
        },
      ]),
    ).rejects.toThrow("supports image attachments only as JPEG, PNG, GIF, or WebP");
  });
});

describe("mutationForTool", () => {
  test("leaves Bash mutation classification to Claude", () => {
    expect(mutationForTool("Bash", { command: "rg Claude packages/host" })).toBe("unknown");
    expect(mutationForTool("Bash", { command: "rm -rf dist" })).toBe("unknown");
    expect(mutationForTool("Bash", { command: "node scripts/update.js" })).toBe("unknown");
  });

  test("classifies native tools without parsing shell commands", () => {
    expect(mutationForTool("Agent")).toBe("unknown");
    expect(mutationForTool("WebFetch")).toBe("unknown");
    expect(mutationForTool("WebSearch")).toBe("unknown");
    expect(mutationForTool("Skill")).toBe("read_only");
    expect(mutationForTool("Write")).toBe("mutating");
    expect(mutationForTool("TodoWrite")).toBe("mutating");
  });
});
