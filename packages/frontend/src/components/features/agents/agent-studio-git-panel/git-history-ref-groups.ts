import type { GitHistoryCommit, GitHistoryComparison } from "@openducktor/contracts";

/**
 * The refs of one commit as the Branch / Tag column shows them. A local branch and its remote
 * branches share one entry, as in GitKraken, so the same branch shows once.
 */
export type HistoryRefGroup = {
  /** The branch name without its remote, the tag name, or `HEAD` for a detached checkout. */
  name: string;
  kind: "branch" | "tag" | "head";
  /** The full names, such as `main` and `origin/main`, for the hover details. */
  fullNames: string[];
  local: boolean;
  remote: boolean;
  isHead: boolean;
  isTarget: boolean;
};

const remoteBranchName = (fullName: string): string => fullName.slice(fullName.indexOf("/") + 1);

const emptyGroup = (name: string, kind: HistoryRefGroup["kind"]): HistoryRefGroup => ({
  name,
  kind,
  fullNames: [],
  local: false,
  remote: false,
  isHead: false,
  isTarget: false,
});

/** A branch and a tag can share a name, so the key keeps them apart. */
export const groupKey = (group: Pick<HistoryRefGroup, "kind" | "name">): string =>
  `${group.kind}:${group.name}`;

const groupRank = (group: HistoryRefGroup): number => {
  if (group.isHead) return 0;
  if (group.isTarget) return 1;
  if (group.kind === "tag") return 3;
  return 2;
};

/**
 * Groups the refs of a commit. The checked-out branch comes first, then the comparison target,
 * then other branches, then tags. A detached checkout and a target without a ref get an entry of
 * their own, so both tips always show.
 */
export function historyRefGroups(
  commit: GitHistoryCommit,
  comparison: GitHistoryComparison,
  targetLabel: string,
): HistoryRefGroup[] {
  const groups = new Map<string, HistoryRefGroup>();
  for (const ref of commit.refs) {
    const name = ref.kind === "remote" ? remoteBranchName(ref.name) : ref.name;
    const kind = ref.kind === "tag" ? "tag" : "branch";
    const key = groupKey({ kind, name });
    const group = groups.get(key) ?? emptyGroup(name, kind);
    group.fullNames.push(ref.name);
    group.local ||= ref.kind === "local";
    group.remote ||= ref.kind === "remote";
    group.isHead ||= ref.isHead;
    group.isTarget ||= commit.oid === comparison.targetTip && ref.name === targetLabel;
    groups.set(key, group);
  }
  const result = [...groups.values()];
  if (commit.oid === comparison.currentTip && !result.some((group) => group.isHead)) {
    result.push({ ...emptyGroup("HEAD", "head"), fullNames: ["HEAD"], isHead: true });
  }
  if (commit.oid === comparison.targetTip && !result.some((group) => group.isTarget)) {
    result.push({ ...emptyGroup(targetLabel, "branch"), fullNames: [targetLabel], isTarget: true });
  }
  return result.sort((left, right) => groupRank(left) - groupRank(right));
}
