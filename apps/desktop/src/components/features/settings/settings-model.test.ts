import { describe, expect, test } from "bun:test";
import { hasConfiguredHookCommands, parseHookLines } from "./settings-model";

describe("settings-model", () => {
  test("parseHookLines preserves blank lines while trimming entered commands", () => {
    expect(parseHookLines(" bun install \n\n npm test \n")).toEqual([
      "bun install",
      "",
      "npm test",
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
  });
});
