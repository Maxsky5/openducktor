import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import { buildDiffPreloadEntries } from "./diff-preload-queue-model";

const buildDiff = (file: string, diff: string): GitFileDiff => ({
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

  test("skips oversized changes before parsing and still fills the preload limit", () => {
    const patch = (file: string, lines: number) =>
      [
        `--- a/${file}`,
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines} @@`,
        ...Array(lines).fill("+line"),
        "",
      ].join("\n");
    const entries = buildDiffPreloadEntries(
      [
        {
          ...buildDiff("large-added.ts", patch("large-added.ts", 1001)),
          additions: 1001,
          deletions: 0,
        },
        { ...buildDiff("large-deleted.ts", "@@ -1,1001 +0,0 @@\n"), additions: 0, deletions: 1001 },
        { ...buildDiff("at-limit.ts", patch("at-limit.ts", 1000)), additions: 1000, deletions: 0 },
        buildDiff("small.ts", "@@ -1 +1 @@\n-old\n+new"),
      ],
      new Set(),
      2,
    );

    expect(entries.map((entry) => entry.file)).toEqual(["at-limit.ts", "small.ts"]);
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
