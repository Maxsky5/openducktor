import { describe, expect, test } from "bun:test";
import {
  buildDevServerDraftValidationMap,
  countDevServerDraftValidationErrors,
  hasConfiguredHookCommands,
  hasConfiguredRepoScriptCommands,
  normalizeDevServers,
  normalizeHooksWithTrust,
  normalizeRepoScriptsWithTrust,
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

  test("hasConfiguredRepoScriptCommands includes dev server commands", () => {
    expect(
      hasConfiguredRepoScriptCommands({
        hooks: { preStart: [], postComplete: [] },
        devServers: [{ id: "frontend", name: "Frontend", command: " bun run dev " }],
      }),
    ).toBe(true);
  });

  test("normalizeHooksWithTrust trims commands and disables trust when commands are empty", () => {
    expect(
      normalizeHooksWithTrust(
        {
          preStart: [" bun install ", " "],
          postComplete: ["npm test"],
        },
        true,
      ),
    ).toEqual({
      hooks: {
        preStart: ["bun install"],
        postComplete: ["npm test"],
      },
      trustedHooks: true,
    });

    expect(
      normalizeHooksWithTrust(
        {
          preStart: [" "],
          postComplete: [""],
        },
        true,
      ),
    ).toEqual({
      hooks: {
        preStart: [],
        postComplete: [],
      },
      trustedHooks: false,
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
      backend: {
        command: "Command is required.",
      },
    });
    expect(
      countDevServerDraftValidationErrors([
        { id: "frontend", name: "", command: " bun run dev " },
        { id: "backend", name: "Backend", command: "   " },
      ]),
    ).toBe(2);
  });

  test("normalizeDevServers trims entries and rejects blank fields", () => {
    expect(
      normalizeDevServers([{ id: "frontend", name: " Frontend ", command: " bun run dev " }]),
    ).toEqual([{ id: "frontend", name: "Frontend", command: "bun run dev" }]);

    expect(() =>
      normalizeDevServers([{ id: "frontend", name: "   ", command: "bun run dev" }]),
    ).toThrow("Dev server tab labels cannot be blank");
    expect(() =>
      normalizeDevServers([{ id: "frontend", name: "Frontend", command: "   " }]),
    ).toThrow("Dev server commands cannot be blank");
  });

  test("normalizeRepoScriptsWithTrust preserves trust while scripts remain configured", () => {
    expect(
      normalizeRepoScriptsWithTrust(
        {
          hooks: { preStart: [], postComplete: [] },
          devServers: [{ id: "frontend", name: " Frontend ", command: " bun run dev " }],
        },
        true,
      ),
    ).toEqual({
      hooks: { preStart: [], postComplete: [] },
      devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
      trustedHooks: true,
    });
  });
});
