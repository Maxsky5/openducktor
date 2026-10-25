import type { WorkspaceSessionLocation } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { workspaceSessionWorktreesQueryOptions } from "../../queries/workspace-sessions";

/** Holds the selected worktree and reads the worktrees only while the selector shows. */
export function useExistingWorktreeChoice(
  workspaceId: string,
  open: boolean,
  location: WorkspaceSessionLocation,
) {
  const worktrees = useQuery({
    ...workspaceSessionWorktreesQueryOptions(workspaceId),
    enabled: open && location === "existing_worktree",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const isSelectedListed =
    worktrees.data?.worktrees.some((entry) => entry.workingDirectory === selected) ?? false;
  // A pending or failed read cannot confirm that the selected worktree still exists.
  const isReadDone = worktrees.isSuccess && !worktrees.isFetching;
  return {
    selected,
    select: setSelected,
    worktrees,
    isSelectedListed,
    /** The selected worktree once the latest finished read lists it, else null. */
    listedWorktree: isReadDone && isSelectedListed ? selected : null,
    isSelectedUnavailable: selected !== null && isReadDone && !isSelectedListed,
  };
}

export type ExistingWorktreeChoice = ReturnType<typeof useExistingWorktreeChoice>;
