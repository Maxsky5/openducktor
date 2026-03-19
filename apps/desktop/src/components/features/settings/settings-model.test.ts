import { describe, expect, test } from "bun:test";
import {
  hasConfiguredHookCommands,
  normalizeHooksWithTrust,
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
});
