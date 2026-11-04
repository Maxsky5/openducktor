import { describe, expect, test } from "bun:test";
import { readLegacyTargetBranch } from "./legacy-target-branch";

describe("legacy target branch", () => {
  test("reads a saved target without a branch as its main branch", () => {
    expect(readLegacyTargetBranch({})).toEqual({ branch: "main" });
    expect(readLegacyTargetBranch({ remote: "upstream" })).toEqual({
      remote: "upstream",
      branch: "main",
    });
  });

  test("keeps a saved branch and leaves other values to schema validation", () => {
    expect(readLegacyTargetBranch({ remote: "origin", branch: "develop" })).toEqual({
      remote: "origin",
      branch: "develop",
    });
    expect(readLegacyTargetBranch("main")).toBe("main");
  });
});
