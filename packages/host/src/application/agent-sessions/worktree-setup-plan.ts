import type { RepoConfig } from "@openducktor/contracts";
import { plannedWorktreeActionSteps } from "../actions/worktree-action-runner";
import { updateStartup } from "./session-startup-progress";

/**
 * Publishes every setup step of a new worktree in one snapshot. Call it after validation and
 * before Git creates the worktree, so the client shows the full plan once.
 *
 * Clients read a planned `copies` step as the sign of a worktree creation, so plan it also when
 * the repository copies no files.
 */
export const planWorktreeSetup = (input: {
  label: string;
  worktreePath: string;
  branch: string;
  upstreamRemote: string | null | undefined;
  repoConfig: Pick<RepoConfig, "worktreeCopyPaths" | "actions">;
}) =>
  updateStartup((progress) =>
    progress.plan([
      {
        id: "checkout",
        label: input.label,
        state: "pending",
        details: [input.worktreePath, input.branch],
      },
      ...(input.upstreamRemote
        ? [
            {
              id: "upstream",
              label: "Set branch upstream",
              state: "pending" as const,
              details: [input.upstreamRemote],
            },
          ]
        : []),
      {
        id: "copies",
        label: "Copy configured files",
        state: "pending",
        details: input.repoConfig.worktreeCopyPaths,
      },
      ...plannedWorktreeActionSteps(input.repoConfig.actions),
    ]),
  );
