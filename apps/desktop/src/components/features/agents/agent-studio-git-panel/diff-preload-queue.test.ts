import { describe, expect, test } from "bun:test";
import type { FileDiff } from "@openducktor/contracts";
import { buildDiffPreloadEntries } from "./diff-preload-queue";

const buildDiff = (file: string, diff: string): FileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff,
});

describe("buildDiffPreloadEntries", () => {
  test("selects non-expanded entries with non-empty diff and respects limit", () => {
    const entries = buildDiffPreloadEntries(
      [
        buildDiff("src/a.ts", "@@ -1 +1 @@\n-a\n+b"),
        buildDiff("src/b.ts", "   \n  \n"),
        buildDiff("src/c.ts", "@@ -1 +1 @@\n-old\n+new"),
        buildDiff("src/d.ts", "@@ -2 +2 @@\n-d\n+dd"),
      ],
      new Set(),
      2,
    );

    expect(entries).toEqual([
      { file: "src/a.ts", diff: "@@ -1 +1 @@\n-a\n+b" },
      { file: "src/c.ts", diff: "@@ -1 +1 @@\n-old\n+new" },
    ]);
  });

  test("returns empty list when limit is zero", () => {
    const entries = buildDiffPreloadEntries(
      [buildDiff("src/a.ts", "@@ -1 +1 @@\n-a\n+b")],
      new Set(),
      0,
    );

    expect(entries).toEqual([]);
  });

  test("pauses preloading while a diff is expanded", () => {
    const entries = buildDiffPreloadEntries(
      [
        buildDiff("src/a.ts", "@@ -1 +1 @@\n-a\n+b"),
        buildDiff("src/b.ts", "@@ -1 +1 @@\n-old\n+new"),
      ],
      new Set(["src/a.ts"]),
      2,
    );

    expect(entries).toEqual([]);
  });
});
