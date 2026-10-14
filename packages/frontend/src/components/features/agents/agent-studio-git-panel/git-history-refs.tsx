import type { GitHistoryCommit, GitHistoryComparison } from "@openducktor/contracts";
import { Cloud, GitBranch, type LucideIcon, Tag, Target } from "lucide-react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
const groupKey = (group: Pick<HistoryRefGroup, "kind" | "name">): string =>
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

/** The checkout shows as a branch, so a branch that is also the target keeps its own icon. */
const groupIcon = (group: HistoryRefGroup): LucideIcon => {
  if (group.isHead) return GitBranch;
  if (group.isTarget) return Target;
  if (group.kind === "tag") return Tag;
  if (group.remote && !group.local) return Cloud;
  return GitBranch;
};

const groupDescription = (group: HistoryRefGroup): string => {
  const roles: string[] = [];
  if (group.isHead) roles.push("checked out");
  if (group.isTarget) roles.push("target");
  const names = group.fullNames.join(", ");
  return roles.length > 0 ? `${names} (${roles.join(", ")})` : names;
};

/** The most extra refs that show as stacked icons. More refs add a count, so the name keeps its space. */
const MAX_STACKED = 2;

/**
 * The Branch / Tag cell. The first ref shows its name in the lane color, and the other refs stack
 * as small icons. A hover lists every ref with its full names.
 */
export function HistoryRefsCell({
  groups,
  color,
}: {
  groups: HistoryRefGroup[];
  color: string;
}): ReactElement | null {
  const [first, ...others] = groups;
  if (!first) return null;
  const FirstIcon = groupIcon(first);
  const stacked = others.slice(0, MAX_STACKED);
  const hiddenCount = others.length - stacked.length;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative z-10 flex h-[18px] max-w-full min-w-0 items-center"
          data-testid="agent-studio-git-history-markers"
        >
          <span
            className={cn(
              "relative inline-flex h-full min-w-0 items-center gap-1 overflow-hidden rounded-[4px] border-l-[3px] border-current px-1.5 text-[10.5px] leading-none",
              first.isHead ? "font-bold" : "font-semibold",
              color,
            )}
          >
            <span aria-hidden="true" className="absolute inset-0 bg-current opacity-20" />
            <FirstIcon className="relative size-3 shrink-0" aria-hidden="true" />
            <span className="relative truncate text-foreground">{first.name}</span>
          </span>
          {stacked.length > 0 ? (
            <span
              className="ml-1 flex shrink-0 items-center"
              data-testid="agent-studio-git-history-ref-stack"
            >
              {stacked.map((group, index) => {
                const Icon = groupIcon(group);
                return (
                  <span
                    key={groupKey(group)}
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full border border-card bg-muted text-muted-foreground",
                      index > 0 && "-ml-2",
                    )}
                  >
                    <Icon className="size-2.5" aria-hidden="true" />
                  </span>
                );
              })}
              {hiddenCount > 0 ? (
                <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                  +{hiddenCount}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="sr-only">
            {groups.map((group) => groupDescription(group)).join("; ")}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-72 p-2">
        <ul className="space-y-1" data-testid="agent-studio-git-history-ref-details">
          {groups.map((group) => {
            const Icon = groupIcon(group);
            return (
              <li key={groupKey(group)} className="flex min-w-0 items-center gap-1.5">
                <Icon className="size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{groupDescription(group)}</span>
              </li>
            );
          })}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
