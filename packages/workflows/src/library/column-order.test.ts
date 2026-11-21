import { describe, expect, test } from "bun:test";
import { columnOrder } from "./column-order";

describe("column order", () => {
  test("pins open first and closed last, and keeps the other states in definition order", () => {
    const states = ["closed", "triage", "open", "fixing"].map((id) => ({ id }));
    expect(columnOrder(states).map(({ state, index }) => [state.id, index])).toEqual([
      ["open", 2],
      ["triage", 1],
      ["fixing", 3],
      ["closed", 0],
    ]);
  });
});
