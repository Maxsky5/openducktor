import type { QueryClient } from "@tanstack/react-query";
import { gitRefreshPriority } from "@/lib/git-refresh-priority";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import type { GitFileRefresh } from "./git-refresh-coordinator";

/** The file refresh batch merges the Git jobs of one panel context. */
const GIT_PANEL_FILE_JOB = {};

/**
 * Adds the file reads of each root to a Git refresh. A manual Refresh ends with its Git reads, and
 * the file views show their own refresh and errors. Other refreshes read Git in the file refresh
 * batch, so the Git and file reads share one read context.
 */
export const withFileQueries =
  (queryClient: QueryClient, roots: readonly string[], context: string): GitFileRefresh =>
  async (mode, readGit) => {
    if (roots.length === 0) {
      await readGit();
      return;
    }
    if (mode === "hard") {
      try {
        await readGit();
      } finally {
        for (const root of roots) {
          void refreshWorkspaceFileQueries(queryClient, root, "full").catch(() => undefined);
        }
      }
      return;
    }
    await Promise.all(
      roots.map((root, index) =>
        refreshWorkspaceFileQueries(
          queryClient,
          root,
          "incremental",
          index === 0
            ? {
                consumer: GIT_PANEL_FILE_JOB,
                context,
                priority: gitRefreshPriority(mode),
                // A fetch can move the target, so file reads wait for it.
                mayFetch: mode === "scheduled",
                run: readGit,
              }
            : undefined,
        ),
      ),
    );
  };
