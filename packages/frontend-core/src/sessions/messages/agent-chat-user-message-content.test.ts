import { describe, expect, test } from "bun:test";
import { buildMessage } from "../../test-support/agent-chat-transcript-fixtures";
import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import {
  buildUserMessageContent,
  isUserMessageReferencePart,
  readUserMessageSummary,
} from "./agent-chat-user-message-content";

const file = {
  kind: "file_reference" as const,
  file: { id: "f1", path: "src/app.ts", name: "app.ts", kind: "code" as const },
};
const skill = {
  kind: "skill_mention" as const,
  skill: { id: "s1", name: "review", path: "/skills/review" },
};

const nodesOf = (content: string, parts: AgentUserMessageDisplayPart[]) =>
  buildUserMessageContent(
    buildMessage("user", content, { meta: { kind: "user", state: "read", parts } }),
  ).nodes;

describe("user message content nodes", () => {
  test("keeps text and references in part order when the text has no markers", () => {
    const nodes = nodesOf("", [
      { kind: "text", text: "Read " },
      file,
      { kind: "text", text: " now" },
    ]);
    expect(nodes?.map((node) => node.kind)).toEqual(["text", "reference", "text"]);
    expect(nodes?.map((node) => node.key)).toEqual([
      "text-1",
      "reference-file_reference-1",
      "text-2",
    ]);
  });

  test("places references at their source text range", () => {
    const text = "Use $review on @app.ts";
    const nodes = nodesOf(text, [
      { kind: "text", text },
      { ...skill, sourceText: { value: "$review", start: 4, end: 11 } },
    ]);
    expect(nodes).toEqual([
      { kind: "text", key: "text-0", text: "Use " },
      {
        kind: "reference",
        key: "reference-4",
        part: expect.objectContaining({ kind: "skill_mention" }),
      },
      { kind: "text", key: "text-11", text: " on @app.ts" },
    ]);
  });

  test("gives inline and trailing reference chips different keys", () => {
    const secondFile = { ...file, file: { ...file.file, id: "f2", name: "main.ts" } };
    const nodes = nodesOf("ab $review", [
      { kind: "text", text: "ab $review" },
      skill,
      file,
      secondFile,
    ]);
    const keys = nodes?.map((node) => node.key) ?? [];
    expect(keys).toEqual(["text-0", "reference-3", "trailing-reference-0", "trailing-reference-1"]);
  });

  test("returns null for a message without text or references", () => {
    expect(nodesOf("", [])).toBeNull();
  });
});

describe("buildUserMessageContent", () => {
  test("splits attachments and reads the unread state of a queued message", () => {
    const content = buildUserMessageContent(
      buildMessage("user", "See image", {
        meta: {
          kind: "user",
          state: "queued",
          parts: [
            { kind: "text", text: "See image" },
            {
              kind: "attachment",
              attachment: { id: "a1", path: "/tmp/a.png", name: "a.png", kind: "image" },
            },
          ],
        },
      }),
    );
    expect(content.isUnread).toBe(true);
    expect(content.attachments.map((part) => part.attachment.name)).toEqual(["a.png"]);
    expect(content.nodes).toEqual([{ kind: "text", key: "text", text: "See image" }]);
  });

  test("tells reference parts from other parts", () => {
    expect(isUserMessageReferencePart(file)).toBe(true);
    expect(isUserMessageReferencePart({ kind: "text", text: "x" })).toBe(false);
  });
});

describe("user message summary", () => {
  const summaryOf = (content: string, parts: AgentUserMessageDisplayPart[]) =>
    readUserMessageSummary(
      buildMessage("user", content, { meta: { kind: "user", state: "read", parts } }),
    );

  test("reads the first line with text and shortens a long line", () => {
    expect(summaryOf("\n  Fix the build  \nthen test", [])).toBe("Fix the build");
    expect(summaryOf("x".repeat(130), [])).toBe(`${"x".repeat(120)}…`);
  });

  test("names the attachments of a message without text", () => {
    const attachment = {
      kind: "attachment" as const,
      attachment: { id: "a1", path: "/tmp/shot.png", name: "shot.png", kind: "image" as const },
    };
    expect(summaryOf("", [attachment])).toBe("Attachments: shot.png");
    expect(summaryOf("", [])).toBe("");
  });
});
