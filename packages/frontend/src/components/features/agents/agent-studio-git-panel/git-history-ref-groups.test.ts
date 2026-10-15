import { describe, expect, test } from "bun:test";
import type { GitHistoryCommit, GitHistoryComparison } from "@openducktor/contracts";
import { historyRefGroups } from "./git-history-ref-groups";

const oid = (name: string) => name.padEnd(40, "0");
const commit = (name: string, refs: GitHistoryCommit["refs"]): GitHistoryCommit => ({
  oid: oid(name),
  parentOids: [],
  outsideParentOids: [],
  membership: "current",
  subject: name,
  message: name,
  authorName: "Ada",
  authorEmail: "ada@example.invalid",
  authorDate: "2026-10-13T14:05:22+02:00",
  refs,
});
const comparison = (currentTip: string, targetTip: string): GitHistoryComparison => ({
  currentTip: oid(currentTip),
  targetTip: oid(targetTip),
  boundaryOids: [],
  aheadBehind: { ahead: 0, behind: 0 },
});

describe("historyRefGroups", () => {
  test("joins a local branch with its remote branches and puts the checkout and target first", () => {
    const groups = historyRefGroups(
      commit("a", [
        { name: "feature", kind: "local", isHead: true },
        { name: "main", kind: "local", isHead: false },
        { name: "origin/feature", kind: "remote", isHead: false },
        { name: "origin/main", kind: "remote", isHead: false },
        { name: "upstream/only", kind: "remote", isHead: false },
        { name: "v1", kind: "tag", isHead: false },
      ]),
      comparison("a", "a"),
      "origin/main",
    );

    expect(
      groups.map(({ name, kind, local, remote, isHead, isTarget }) => ({
        name,
        kind,
        local,
        remote,
        isHead,
        isTarget,
      })),
    ).toEqual([
      { name: "feature", kind: "branch", local: true, remote: true, isHead: true, isTarget: false },
      { name: "main", kind: "branch", local: true, remote: true, isHead: false, isTarget: true },
      { name: "only", kind: "branch", local: false, remote: true, isHead: false, isTarget: false },
      { name: "v1", kind: "tag", local: false, remote: false, isHead: false, isTarget: false },
    ]);
    expect(groups[1]?.fullNames).toEqual(["main", "origin/main"]);
  });

  test("names a detached checkout and a target without a ref, so both tips show", () => {
    expect(
      historyRefGroups(commit("a", []), comparison("a", "a"), "origin/main").map((group) => [
        group.name,
        group.kind,
        group.isHead,
        group.isTarget,
      ]),
    ).toEqual([
      ["HEAD", "head", true, false],
      ["origin/main", "branch", false, true],
    ]);
    expect(historyRefGroups(commit("b", []), comparison("a", "c"), "origin/main")).toEqual([]);
  });
});
