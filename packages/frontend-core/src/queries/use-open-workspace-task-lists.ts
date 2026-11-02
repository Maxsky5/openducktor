import type { WorkspaceRecord, WorkspaceRef } from "@openducktor/contracts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { repoTaskDataQueryOptions } from "./tasks";

/**
 * Keeps the task list of every open workspace cached, so a workspace switch shows it at once.
 * The task stream keeps these lists current. Returns the identities of the open workspaces
 * for the task stream.
 */
export function useOpenWorkspaceTaskLists({
  openWorkspaces,
  activeRepoPath,
  activeWorkspaceId,
}: {
  openWorkspaces: readonly Pick<WorkspaceRecord, "workspaceId" | "repoPath">[];
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
}): readonly WorkspaceRef[] {
  // The active workspace stays open until the next one becomes active, also after it closes.
  const openRepoPaths = useMemo(() => {
    const scopes = new Map(
      openWorkspaces.map((workspace) => [
        workspace.workspaceId,
        { workspaceId: workspace.workspaceId, repoPath: workspace.repoPath },
      ]),
    );
    if (activeRepoPath && activeWorkspaceId)
      scopes.set(activeWorkspaceId, { workspaceId: activeWorkspaceId, repoPath: activeRepoPath });
    return [...scopes.values()];
  }, [activeRepoPath, activeWorkspaceId, openWorkspaces]);

  // Disabled observers do not read, so they do not join the reads of the active queries.
  useQueries({
    queries: openRepoPaths.map((repoPath) => ({
      ...repoTaskDataQueryOptions(repoPath),
      enabled: false,
    })),
    combine: ignoreQueryResults,
  });

  return openRepoPaths;
}

// The observers only keep the lists cached, so a list change does not render the caller.
const ignoreQueryResults = (): null => null;
