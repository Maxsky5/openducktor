import { Cloud, GitBranch, type LucideIcon, Tag, Target } from "lucide-react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { groupKey, type HistoryRefGroup } from "./git-history-ref-groups";

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
