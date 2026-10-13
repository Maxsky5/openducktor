import { describe, expect, test } from "bun:test";
import type { GitHistoryCommit } from "@openducktor/contracts";
import {
  authorInitials,
  formatCompactCommitAge,
  formatExactCommitDate,
  formatRelativeCommitDate,
  layoutHistoryGraph,
} from "./git-history-graph-model";

const oid = (name: string) => name.padEnd(40, "0");

const commit = (
  name: string,
  parents: string[],
  membership: GitHistoryCommit["membership"],
  outside: string[] = [],
): GitHistoryCommit => ({
  oid: oid(name),
  parentOids: parents.map(oid),
  outsideParentOids: outside.map(oid),
  membership,
  subject: name,
  message: name,
  authorName: "Ada",
  authorEmail: "ada@example.invalid",
  refs: [],
  authorDate: "2026-10-13T14:05:22+02:00",
});

describe("layoutHistoryGraph", () => {
  test("keeps a linear branch in one lane and ends at the comparison limit", () => {
    const layout = layoutHistoryGraph([
      commit("c2", ["c1"], "current"),
      commit("c1", ["base"], "current"),
      commit("base", ["old"], "boundary", ["old"]),
    ]);

    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.rows[0]?.incoming).toEqual([]);
    expect(layout.rows[1]?.incoming).toEqual([{ lane: 0, tone: "current" }]);
    expect(layout.rows[2]?.outgoing).toEqual([]);
    expect(layout.rows[2]?.reachesLimit).toBe(true);
  });

  test("draws both sides of the comparison and joins them at the shared base", () => {
    const layout = layoutHistoryGraph([
      commit("current", ["base"], "current"),
      commit("target", ["base"], "target"),
      commit("base", [], "boundary"),
    ]);

    const [current, target, base] = layout.rows;
    expect(current?.lane).toBe(0);
    expect(target?.lane).toBe(1);
    expect(target?.passThrough).toEqual([{ lane: 0, tone: "current" }]);
    // The second child joins the lane that already waits for the base.
    expect(target?.outgoing).toEqual([{ lane: 0, tone: "current" }]);
    expect(base?.lane).toBe(0);
    expect(base?.incoming).toEqual([{ lane: 0, tone: "current" }]);
    expect(base?.reachesLimit).toBe(false);
    expect(layout.laneCount).toBe(2);
  });

  test("opens a lane for the second parent of a merge and colors it by that parent", () => {
    const layout = layoutHistoryGraph([
      commit("merge", ["feature", "main"], "current"),
      commit("feature", ["base"], "current"),
      commit("main", ["base"], "boundary"),
      commit("base", [], "boundary"),
    ]);

    const [merge, feature, main] = layout.rows;
    expect(merge?.outgoing).toEqual([
      { lane: 0, tone: "current" },
      { lane: 1, tone: "boundary" },
    ]);
    expect(feature?.passThrough).toEqual([{ lane: 1, tone: "boundary" }]);
    expect(main?.lane).toBe(1);
    expect(main?.incoming).toEqual([{ lane: 1, tone: "boundary" }]);
  });

  test("keeps earlier rows unchanged when a later page adds rows", () => {
    const firstPage = [commit("c3", ["c2"], "current"), commit("c2", ["c1"], "current")];
    const secondPage = [commit("c1", ["base"], "current"), commit("base", [], "boundary")];

    const partial = layoutHistoryGraph(firstPage);
    const complete = layoutHistoryGraph([...firstPage, ...secondPage]);

    expect(complete.rows.slice(0, 2)).toEqual(partial.rows);
    // A lane that waits for an unloaded parent continues to the bottom of the loaded rows.
    expect(partial.rows[1]?.outgoing).toEqual([{ lane: 0, tone: "current" }]);
  });
});

describe("commit dates", () => {
  test("keeps the author's clock time and offset", () => {
    expect(formatExactCommitDate("2026-10-13T14:05:22+02:00")).toBe("2026-10-13 14:05:22 +02:00");
    expect(formatExactCommitDate("2026-10-13T14:05:22Z")).toBe("2026-10-13 14:05:22 +00:00");
  });

  test("describes the age of a commit", () => {
    const now = Date.parse("2026-10-13T15:05:22+02:00");
    expect(formatRelativeCommitDate("2026-10-13T14:05:22+02:00", now)).toBe("1 hour ago");
    expect(formatRelativeCommitDate("2026-10-11T15:05:22+02:00", now)).toBe("2 days ago");
    expect(formatRelativeCommitDate("2026-10-13T15:05:00+02:00", now)).toBe("this minute");
  });
});

describe("compact commit ages", () => {
  const now = Date.parse("2026-10-13T15:05:22+02:00");

  test("uses the largest whole unit", () => {
    expect(formatCompactCommitAge("2026-10-13T15:05:00+02:00", now)).toBe("now");
    expect(formatCompactCommitAge("2026-10-13T14:55:22+02:00", now)).toBe("10m");
    expect(formatCompactCommitAge("2026-10-13T12:05:22+02:00", now)).toBe("3h");
    expect(formatCompactCommitAge("2026-10-11T15:05:22+02:00", now)).toBe("2d");
    expect(formatCompactCommitAge("2026-09-29T15:05:22+02:00", now)).toBe("2w");
    expect(formatCompactCommitAge("2026-06-13T15:05:22+02:00", now)).toBe("4mo");
    expect(formatCompactCommitAge("2024-10-13T15:05:22+02:00", now)).toBe("2y");
  });

  test("shows a commit dated in the future as new", () => {
    expect(formatCompactCommitAge("2026-10-14T15:05:22+02:00", now)).toBe("now");
  });
});

describe("authorInitials", () => {
  test("takes the first and last name", () => {
    expect(authorInitials("Maxime Ribera")).toBe("MR");
    expect(authorInitials("  ada  king lovelace ")).toBe("AL");
  });

  test("takes two letters of a single name", () => {
    expect(authorInitials("dependabot[bot]")).toBe("DE");
    expect(authorInitials("x")).toBe("X");
  });
});
