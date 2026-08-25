import { describe, expect, test } from "bun:test";

import { hasOwnKey } from "./object-key";

describe("hasOwnKey", () => {
  test("narrows a dynamic key to an owned key", () => {
    const values = { ready: 1 } as const;
    const key: string = "ready";

    if (!hasOwnKey(values, key)) {
      throw new Error("Expected an owned key.");
    }

    expect(values[key]).toBe(1);
    expect(hasOwnKey(values, "missing")).toBe(false);
  });
});
