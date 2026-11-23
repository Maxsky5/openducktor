import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentUserMessagePart } from "@openducktor/core";
import {
  encodeAntigravityPrompt,
  readAntigravityUserBlocks,
  toAntigravityUserMessage,
} from "./antigravity-prompt";

// Resolved paths, so the file URLs and their replay match on Windows too.
const REPO = resolve("/repo");
const STAGE = resolve("/tmp/openducktor-local-attachments");
const fileUrl = (path: string): string => pathToFileURL(path).href;

const parts: AgentUserMessagePart[] = [
  {
    kind: "slash_command",
    command: { id: "antigravity:plan", trigger: "plan", title: "/plan", hints: [] },
  },
  { kind: "text", text: " read " },
  {
    kind: "file_reference",
    file: { id: "src/app.ts", path: "src/app.ts", name: "app.ts", kind: "code" },
  },
  { kind: "text", text: " and " },
  { kind: "file_reference", file: { id: "docs", path: "docs", name: "docs", kind: "directory" } },
  {
    kind: "attachment",
    attachment: {
      id: "shot",
      path: join(STAGE, "shot.png"),
      name: "shot.png",
      kind: "image",
      mime: "image/png",
    },
  },
];

describe("Antigravity prompt parts", () => {
  test("encodes commands as text and references as file links", () => {
    expect(encodeAntigravityPrompt(parts, REPO)).toEqual([
      // Text next to text is one block, so a replay can tell the messages apart.
      { type: "text", text: "/plan read " },
      { type: "resource_link", uri: fileUrl(join(REPO, "src", "app.ts")), name: "app.ts" },
      { type: "text", text: " and " },
      { type: "resource_link", uri: `${fileUrl(join(REPO, "docs"))}/`, name: "docs" },
      {
        type: "resource_link",
        uri: fileUrl(join(STAGE, "shot.png")),
        name: "shot.png",
        mimeType: "image/png",
      },
    ]);
  });

  test("rebuilds the same user message from a replay", () => {
    const replayed = readAntigravityUserBlocks(encodeAntigravityPrompt(parts, REPO), REPO, STAGE);
    const live = toAntigravityUserMessage(parts);
    const history = toAntigravityUserMessage(replayed);

    // The replay has the slash command as text, so only its display form must match.
    expect(history.text).toBe(live.text);
    expect(history.displayParts).toEqual(live.displayParts);
  });

  test("puts a space between a command and the word after it, live and on replay", () => {
    const plan: AgentUserMessagePart = {
      kind: "slash_command",
      command: { id: "antigravity:plan", trigger: "plan", title: "/plan", hints: [] },
    };
    const reference: AgentUserMessagePart = {
      kind: "file_reference",
      file: { id: "a.ts", path: "a.ts", name: "a.ts", kind: "code" },
    };
    const typed: AgentUserMessagePart[] = [plan, { kind: "text", text: "fix it" }, reference, plan];

    const blocks = encodeAntigravityPrompt(typed, REPO);
    expect(blocks.filter((block) => block.type === "text")).toEqual([
      { type: "text", text: "/plan fix it" },
      { type: "text", text: "/plan" },
    ]);
    const live = toAntigravityUserMessage(typed);
    const history = toAntigravityUserMessage(readAntigravityUserBlocks(blocks, REPO, STAGE));
    expect(live.displayParts[0]).toEqual({ kind: "text", text: "/plan fix it" });
    expect(history.displayParts).toEqual(live.displayParts);
  });

  test("names a replayed attachment without its staging prefix", () => {
    const [part] = readAntigravityUserBlocks(
      [
        {
          type: "resource_link",
          uri: fileUrl(join(STAGE, "18a6e02d-c5ab-4408-ac3c-8b30a4b4e550-red.png")),
          name: "18a6e02d-c5ab-4408-ac3c-8b30a4b4e550-red.png",
        },
      ],
      REPO,
      STAGE,
    );

    expect(part?.kind === "attachment" ? part.attachment.name : null).toBe("red.png");
  });

  test("sends a skill as its slash command, which a replay shows the same way", () => {
    const skillParts: AgentUserMessagePart[] = [
      {
        kind: "skill_mention",
        skill: { id: "clean-code", name: "clean-code", path: "clean-code" },
      },
      { kind: "text", text: "review this" },
    ];

    expect(encodeAntigravityPrompt(skillParts, REPO)).toEqual([
      { type: "text", text: "/clean-code review this" },
    ]);
    const live = toAntigravityUserMessage(skillParts);
    const history = toAntigravityUserMessage(
      readAntigravityUserBlocks(encodeAntigravityPrompt(skillParts, REPO), REPO, STAGE),
    );
    expect(live.text).toBe("/clean-code review this");
    // The skill shows as a skill, and a built-in command stays text.
    // The skill names its place in the text, so its chip replaces the `/clean-code` text.
    expect(live.displayParts).toEqual([
      {
        kind: "skill_mention",
        skill: { id: "clean-code", name: "clean-code", path: "clean-code" },
        sourceText: { value: "/clean-code", start: 0, end: 11 },
      },
      { kind: "text", text: " review this" },
    ]);
    expect(toAntigravityUserMessage([{ kind: "text", text: "/plan next" }]).displayParts).toEqual([
      { kind: "text", text: "/plan next" },
    ]);
    expect(history.text).toBe(live.text);
    expect(history.displayParts).toEqual(live.displayParts);
  });

  test("refuses a part kind that Antigravity has no form for", () => {
    expect(() =>
      encodeAntigravityPrompt(
        [{ kind: "subagent_reference", subagent: { id: "explore", name: "explore" } }],
        REPO,
      ),
    ).toThrow("Antigravity cannot send subagent_reference message parts.");
  });
});
