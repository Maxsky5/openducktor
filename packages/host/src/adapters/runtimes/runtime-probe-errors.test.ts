import { describe, expect, test } from "bun:test";

import { isTimeoutError } from "./runtime-probe-errors";

type CauseNode = {
  cause?: CauseNode | Error;
};

describe("isTimeoutError", () => {
  test("finds timeout evidence through nested causes", () => {
    expect(isTimeoutError({ cause: { code: "ETIMEDOUT" } })).toBe(true);
    expect(isTimeoutError({ cause: { details: { failureKind: "timeout" } } })).toBe(true);
  });

  test("terminates on self-referential and multi-node cause cycles", () => {
    const selfCycle: CauseNode = {};
    selfCycle.cause = selfCycle;

    const first: CauseNode = {};
    const second: CauseNode = { cause: first };
    first.cause = second;

    expect(isTimeoutError(selfCycle)).toBe(false);
    expect(isTimeoutError(first)).toBe(false);
  });

  test("finds timeout evidence before a cause cycle repeats", () => {
    const first: CauseNode = {};
    const second: CauseNode & { name: string } = {
      cause: first,
      name: "TimeoutError",
    };
    first.cause = second;

    expect(isTimeoutError(first)).toBe(true);
  });
});
