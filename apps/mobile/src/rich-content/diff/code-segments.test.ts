import { describe, expect, test } from "bun:test";
import { changedRanges, codeSegments } from "./code-segments";

describe("code segments", () => {
  test("splits tokens at the edges of the changed words", () => {
    expect(
      codeSegments(
        [
          { text: "const ", tone: "keyword" },
          { text: "value", tone: "variable" },
          { text: " = 1;", tone: "plain" },
        ],
        { start: 8, end: 13 },
      ),
    ).toEqual([
      { text: "const ", tone: "keyword", emphasized: false },
      { text: "va", tone: "variable", emphasized: false },
      { text: "lue", tone: "variable", emphasized: true },
      { text: " =", tone: "plain", emphasized: true },
      { text: " 1;", tone: "plain", emphasized: false },
    ]);
    expect(codeSegments([{ text: "a", tone: "plain" }], null)).toEqual([
      { text: "a", tone: "plain", emphasized: false },
    ]);
  });

  test("finds the changed words between a shared start and a shared end", () => {
    expect(
      changedRanges(
        'import { useEffect, useMemo, useReducer, useRef } from "react";',
        'import { useEffect, useMemo, useReducer } from "react";',
      ),
    ).toEqual({ removed: { start: 39, end: 47 }, added: { start: 39, end: 39 } });
    expect(changedRanges("same", "same")).toBeNull();
    expect(changedRanges("alpha", "omega and more")).toBeNull();
  });
});
