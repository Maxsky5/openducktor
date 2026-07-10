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
  test("classifies Claude AskUserQuestion tool rows as question tools", () => {
    expect(toolPartType("AskUserQuestion")).toBe("question");
    expect(toolPartType("permission_ask_user_question")).toBe("question");
  });
});

describe("toClaudeMessageFromParts", () => {
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
  test("treats every Bash command as mutating at the permission boundary", () => {
    expect(mutationForTool("Bash", { command: "rg Claude packages/host" })).toBe("mutating");
    expect(mutationForTool("Agent")).toBe("unknown");
    expect(mutationForTool("WebFetch")).toBe("unknown");
    expect(mutationForTool("WebSearch")).toBe("unknown");
    expect(mutationForTool("Skill")).toBe("read_only");
  });

  test("classifies mutating or unrecognized shell commands as mutating", () => {
    expect(mutationForTool("Bash", { command: "rm -rf dist" })).toBe("mutating");
    expect(mutationForTool("Bash", { command: "sed -i 's/a/b/' file.txt" })).toBe("mutating");
    expect(mutationForTool("Bash", { command: "find . -name '*.tmp' -delete" })).toBe("mutating");
    expect(mutationForTool("Bash", { command: "node scripts/update.js" })).toBe("mutating");
    expect(
      mutationForTool("Bash", {
        command: "node -e \"require('fs').writeFileSync('/tmp/odt-proof','x')\"",
      }),
    ).toBe("mutating");
  });

  test("classifies shell expansion and write-capable inspection tools as mutating", () => {
    const commands = [
      "rg Claude packages/host\nnode scripts/update.js",
      "git diff --stat $(touch /tmp/odt-proof)",
      "git diff --stat `touch /tmp/odt-proof`",
      "cat $'/etc/passwd'",
      'cat $"/etc/passwd"',
      "cat <(touch /tmp/odt-proof)",
      "awk 'BEGIN { system(\"touch /tmp/odt-proof\") }'",
      "sed 'w /tmp/odt-proof' /dev/null",
      "echo proof > /tmp/odt-proof",
      "find . -exec touch /tmp/odt-proof ;",
      "sort -o /tmp/odt-proof package.json",
      "git branch new-branch",
      "git branch -D old-branch",
      "git diff --output=/tmp/odt-proof",
      "git diff --no-index package.json /etc/passwd",
      "node -e \"const f=require('../secret.json'); console.log(JSON.stringify(f))\"",
      "rg --pre 'touch /tmp/odt-proof' foo .",
      "fd -x touch /tmp/odt-proof",
      "npm test -- --updateSnapshot",
      "bun run lint -- --write",
    ];

    for (const command of commands) {
      expect(mutationForTool("Bash", { command })).toBe("mutating");
    }
  });
});
