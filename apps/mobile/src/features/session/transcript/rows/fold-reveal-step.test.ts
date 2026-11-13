import { describe, expect, test } from "bun:test";
import { readFoldStep } from "./fold-reveal-step";

describe("readFoldStep", () => {
  test("opens a row that still folds again at once with the height of its content", () => {
    expect(readFoldStep("folding", true, 120)).toEqual({ kind: "reopen", height: 120 });
  });

  test("measures folded content before the row opens", () => {
    expect(readFoldStep("folded", true, 120)).toEqual({ kind: "measure" });
    expect(readFoldStep("folding", true, 0)).toEqual({ kind: "measure" });
  });

  test("folds open content with the motion, and other content at once", () => {
    expect(readFoldStep("open", false, 120)).toEqual({ kind: "fold", height: 120 });
    expect(readFoldStep("measuring", false, 120)).toEqual({ kind: "hide" });
    expect(readFoldStep("open", false, 0)).toEqual({ kind: "hide" });
  });
});
