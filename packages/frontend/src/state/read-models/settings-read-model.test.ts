import { describe, expect, test } from "bun:test";
import {
  buildDevServerDraftValidationMap,
  buildReusablePromptValidationErrors,
  countDevServerDraftValidationErrors,
  hasConfiguredHookCommands,
  normalizeDevServers,
  normalizeHooks,
  normalizeRepoScripts,
  parseHookLines,
  prepareReusablePromptsForSave,
} from "./settings-read-model";

describe("settings-read-model", () => {
  test("parseHookLines preserves blank lines and raw spacing while editing", () => {
    expect(parseHookLines(" bun install \n\n npm test \n")).toEqual([
      " bun install ",
      "",
      " npm test ",
      "",
    ]);
  });

  test("hasConfiguredHookCommands ignores blank draft rows", () => {
    expect(
      hasConfiguredHookCommands({
        preStart: ["", ""],
        postComplete: [""],
      }),
    ).toBe(false);

    expect(
      hasConfiguredHookCommands({
        preStart: ["bun install", ""],
        postComplete: [],
      }),
    ).toBe(true);

    expect(
      hasConfiguredHookCommands({
        preStart: ["   "],
        postComplete: [],
      }),
    ).toBe(false);
  });

  test("normalizeHooks trims commands and removes blank rows", () => {
    expect(
      normalizeHooks({
        preStart: [" bun install ", " "],
        postComplete: ["npm test"],
      }),
    ).toEqual({
      preStart: ["bun install"],
      postComplete: ["npm test"],
    });

    expect(
      normalizeHooks({
        preStart: [" "],
        postComplete: [""],
      }),
    ).toEqual({
      preStart: [],
      postComplete: [],
    });
  });

  test("builds validation errors for incomplete dev server drafts", () => {
    expect(
      buildDevServerDraftValidationMap([
        { id: "frontend", name: "", command: " bun run dev " },
        { id: "backend", name: "Backend", command: "   " },
        { id: "   ", name: "", command: "bun run api" },
      ]),
    ).toEqual({
      frontend: {
        name: "Tab label is required.",
      },
    });
    expect(
      countDevServerDraftValidationErrors([
        { id: "frontend", name: "", command: " bun run dev " },
        { id: "backend", name: "Backend", command: "   " },
        { id: "   ", name: "", command: "bun run api" },
      ]),
    ).toBe(3);
  });

  test("normalizeDevServers trims entries, skips blank commands, and rejects invalid configured rows", () => {
    expect(
      normalizeDevServers([{ id: "frontend", name: " Frontend ", command: " bun run dev " }]),
    ).toEqual([{ id: "frontend", name: "Frontend", command: "bun run dev" }]);
    expect(normalizeDevServers([{ id: "frontend", name: "Frontend", command: "   " }])).toEqual([]);

    expect(() =>
      normalizeDevServers([{ id: "frontend", name: "   ", command: "bun run dev" }]),
    ).toThrow("Dev server tab labels cannot be blank");
    expect(() =>
      normalizeDevServers([{ id: "   ", name: "Frontend", command: "bun run dev" }]),
    ).toThrow("Dev server id cannot be blank.");
  });

  test("normalizeRepoScripts normalizes hooks and dev server scripts", () => {
    expect(
      normalizeRepoScripts({
        hooks: { preStart: [" bun install "], postComplete: [] },
        devServers: [{ id: "frontend", name: " Frontend ", command: " bun run dev " }],
      }),
    ).toEqual({
      hooks: { preStart: ["bun install"], postComplete: [] },
      devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
    });
  });

  test("validates reusable prompt required fields, names, and duplicates", () => {
    expect(
      buildReusablePromptValidationErrors([
        { id: "missing", name: "", description: "", content: "" },
        { id: "invalid", name: "bad prompt", description: "", content: "content" },
        { id: "one", name: "Prompt.One", description: "", content: "content" },
        { id: "two", name: "prompt.one", description: "", content: "content" },
      ]),
    ).toEqual({
      missing: {
        name: "Prompt name is required.",
        content: "Prompt content is required.",
      },
      invalid: {
        name: "Use only letters, digits, dots, underscores, colons, or dashes.",
      },
      one: {
        name: "Prompt names must be unique.",
      },
      two: {
        name: "Prompt names must be unique.",
      },
    });
  });

  test("prepareReusablePromptsForSave trims persisted fields and rejects invalid prompts", () => {
    expect(
      prepareReusablePromptsForSave([
        {
          id: " prompt-1 ",
          name: " prompt.name ",
          description: " description ",
          content: " body ",
        },
      ]),
    ).toEqual([
      { id: "prompt-1", name: "prompt.name", description: "description", content: "body" },
    ]);

    expect(() =>
      prepareReusablePromptsForSave([
        { id: "prompt-1", name: "", description: "", content: "body" },
      ]),
    ).toThrow("Reusable prompts contain invalid fields.");
  });
});
