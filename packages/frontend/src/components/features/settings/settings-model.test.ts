import { describe, expect, test } from "bun:test";
import {
  buildDevServerDraftValidationMap,
  countDevServerDraftValidationErrors,
  hasConfiguredHookCommands,
  normalizeDevServers,
  normalizeHooks,
  normalizeRepoScripts,
  parseHookLines,
} from "./settings-model";

describe("settings-model", () => {
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
      ]),
    ).toBe(1);
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
    ).toThrow("Dev server ids cannot be blank.");
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
});
