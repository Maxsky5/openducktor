import {
  automaticWorktreeName,
  type GitTargetBranch,
  workspaceSessionBranchNameSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { canonicalTargetBranch, targetBranchRef } from "../../domain/task/task-branch-policy";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export const invalidTargetField = (field: string, message: string) =>
  Effect.fail(new HostValidationError({ message, field }));

export const resolveUniqueManagedWorktreeName = (
  settingsConfig: Pick<SettingsConfigPort, "join" | "pathExists">,
  namespace: string,
  sessionId: string,
) =>
  Effect.gen(function* () {
    const base = automaticWorktreeName(sessionId);
    for (let suffix = 1; ; suffix += 1) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      if (!(yield* settingsConfig.pathExists(settingsConfig.join(namespace, candidate)))) {
        return candidate;
      }
    }
  });

export const validateWorktreeBranch = (
  git: Pick<GitPort, "referenceExists" | "listBranches">,
  repoPath: string,
  branch: string,
  createBranch: boolean,
) =>
  Effect.gen(function* () {
    if (!workspaceSessionBranchNameSchema.safeParse(branch).success) {
      return yield* invalidTargetField(
        "worktree.branchName",
        `Invalid branch name: ${branch}. Choose a valid name under Advanced.`,
      );
    }
    const branchExists = yield* git.referenceExists(repoPath, `refs/heads/${branch}`);
    if (createBranch === branchExists) {
      return yield* invalidTargetField(
        "worktree.branchName",
        createBranch
          ? `Branch already exists: ${branch}. Choose another name or use Existing branch.`
          : `Local branch no longer exists: ${branch}. Select another branch.`,
      );
    }
    if (!createBranch) {
      const existingBranch = (yield* git.listBranches(repoPath)).find(
        (entry) => !entry.isRemote && entry.name === branch,
      );
      if (existingBranch?.worktreePath) {
        return yield* invalidTargetField(
          "worktree.branchName",
          `Branch ${branch} is already checked out at ${existingBranch.worktreePath}. Choose another branch or use Current checkout.`,
        );
      }
    }
  });

/** Validate the selected target before Git writes. A remote target gives the new branch its upstream. */
export const planNewBranch = (
  git: Pick<GitPort, "referenceExists">,
  repoPath: string,
  targetBranch: GitTargetBranch,
) =>
  Effect.gen(function* () {
    const startPoint = targetBranchRef(targetBranch);
    if (!(yield* git.referenceExists(repoPath, startPoint))) {
      return yield* invalidTargetField(
        "targetBranch",
        `Target branch ${canonicalTargetBranch(targetBranch)} is unavailable. Fetch it or select another target branch.`,
      );
    }
    return { startPoint, upstreamRemote: targetBranch.remote?.trim() || null };
  });
