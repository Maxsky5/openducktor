import { describe, expect, test } from "bun:test";
import { agentToolDataSchema, type AgentToolData } from "@openducktor/contracts";
import { hasMeaningfulToolInput } from "@/state/operations/agent-orchestrator/events/session-helpers";
import { extractPathFromInput, readInputString } from "./tool-input-utils";
import { hasNonEmptyInput, hasNonEmptyText } from "./tool-lifecycle";

describe("validated tool input semantics", () => {
  const cases: Array<[AgentToolData | undefined, boolean]> = [
    [undefined, false],
    [{}, false],
    [{ value: "  " }, false],
    [{ value: null }, false],
    [{ value: { nested: [null, " ", {}, []] } }, false],
    [{ value: { nested: [null, " text "] } }, true],
    [{ value: 0 }, true],
    [{ value: false }, true],
    [{ value: { nested: [false] } }, true],
  ];
  test.each(cases)("preserves meaningful input for %j", (input, expected) => {
    expect(hasNonEmptyInput(input)).toBe(expected);
    expect(hasMeaningfulToolInput(input)).toBe(expected);
  });

  test("rejects invalid JSON values at the tool boundary", () => {
    for (const value of [NaN, Infinity, undefined, new Date(), new Map(), () => 0]) {
      expect(agentToolDataSchema.safeParse({ value }).success).toBe(false);
    }
  });

  test("reads the first nonblank string in key order", () => {
    const input = { first: false, second: " ", third: " value ", fourth: "other" };
    expect(readInputString(input, ["missing", "first", "second", "third", "fourth"])).toBe("value");
    expect(readInputString(input, ["missing", "first", "second"])).toBeNull();
    expect(readInputString(undefined, ["missing"])).toBeNull();
    expect(hasNonEmptyText(false)).toBe(false);
    expect(hasNonEmptyText(undefined)).toBe(false);
    expect(hasNonEmptyText(" ")).toBe(false);
    expect(hasNonEmptyText(" value ")).toBe(true);
  });

  test("keeps path alias precedence and dot handling", () => {
    expect(extractPathFromInput({ filePath: false, path: "/repo/file" })).toBeNull();
    expect(extractPathFromInput({ filePath: null, path: " /repo/file " })).toBe("/repo/file");
    expect(extractPathFromInput({ path: "." })).toBeNull();
  });
});
