import { describe, expect, test } from "bun:test";
import { createClaudeSessionSummary, toClaudeDisplayParts } from "./claude-agent-sdk-session-shape";
describe("createClaudeSessionSummary", () => {
  test("preserves repository scope without a fake task or role", () => {
    expect(
      createClaudeSessionSummary(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "repository", workspaceId: "repo" },
          systemPrompt: "Help with this repository",
        },
        { externalSessionId: "session-repository", title: "Repository session" },
        "2026-06-25T20:00:00.000Z",
      ),
    ).toEqual({
      externalSessionId: "session-repository",
      runtimeKind: "claude",
      workingDirectory: "/repo",
      title: "Repository session",
      sessionAssociation: { kind: "repository", workspaceId: "repo" },
      startedAt: "2026-06-25T20:00:00.000Z",
      status: "starting",
    });
  });
});

describe("toClaudeDisplayParts", () => {
  test("preserves non-skill slash commands as visible text", () => {
    expect(
      toClaudeDisplayParts([
        {
          kind: "slash_command",
          command: {
            id: "review",
            trigger: "review",
            title: "review",
            source: "command",
            hints: [],
          },
        },
        { kind: "text", text: " focus on auth" },
      ]),
    ).toEqual([
      { kind: "text", text: "/review" },
      { kind: "text", text: " focus on auth" },
    ]);
  });

  test("projects Claude skill commands as source-mapped skill chips", () => {
    expect(
      toClaudeDisplayParts([
        {
          kind: "slash_command",
          command: {
            id: "grill-me",
            trigger: "grill-me",
            title: "grill-me",
            description: "Grill a plan",
            source: "skill",
            hints: [],
          },
        },
      ]),
    ).toEqual([
      {
        kind: "skill_mention",
        skill: {
          id: "grill-me",
          name: "grill-me",
          path: "grill-me",
          title: "grill-me",
          description: "Grill a plan",
        },
        sourceText: {
          value: "/grill-me",
          start: 0,
          end: 9,
        },
      },
    ]);
  });

  test("offsets source-mapped references across attachment-separated text blocks", () => {
    expect(
      toClaudeDisplayParts([
        { kind: "text", text: "Before" },
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "pdf",
            mime: "application/pdf",
            name: "context.pdf",
            path: "/repo/context.pdf",
          },
        },
        {
          kind: "file_reference",
          file: {
            id: "src/after.ts",
            kind: "code",
            name: "after.ts",
            path: "src/after.ts",
          },
        },
      ]),
    ).toEqual([
      { kind: "text", text: "Before" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "pdf",
          mime: "application/pdf",
          name: "context.pdf",
          path: "/repo/context.pdf",
        },
      },
      { kind: "text", text: "\n" },
      {
        kind: "file_reference",
        file: {
          id: "src/after.ts",
          kind: "code",
          name: "after.ts",
          path: "src/after.ts",
        },
        sourceText: {
          value: "@src/after.ts",
          start: 7,
          end: 20,
        },
      },
    ]);
  });

  test("preserves the canonical separator between attachment-delimited text blocks", () => {
    expect(
      toClaudeDisplayParts([
        { kind: "text", text: "Before" },
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "pdf",
            mime: "application/pdf",
            name: "context.pdf",
            path: "/repo/context.pdf",
          },
        },
        { kind: "text", text: "After" },
      ]),
    ).toEqual([
      { kind: "text", text: "Before" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "pdf",
          mime: "application/pdf",
          name: "context.pdf",
          path: "/repo/context.pdf",
        },
      },
      { kind: "text", text: "\n" },
      { kind: "text", text: "After" },
    ]);
  });
});
