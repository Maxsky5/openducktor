import {
  type GitTargetBranch,
  type RepoConfig,
  type WorkspaceSessionExecutionTarget,
  type WorkspaceSessionRefInput,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionBranchNameSchema,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { canonicalTargetBranch } from "../../domain/task/task-branch-policy";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorktreeActionRunner } from "../actions/worktree-action-runner";
import { classifyWorkspaceCheckout, type WorkspaceCheckoutGitPort } from "./workspace-checkout";
import {
  runWorkspaceSessionWorktreeActions,
  stopWorktreeActionTerminals,
} from "./workspace-session-worktree-actions";

export type WorkspaceSessionTargetDependencies = {
  git: GitPort;
  settingsConfig: SettingsConfigPort;
  worktreeFiles: WorktreeFilePort;
  worktreeActions: WorktreeActionRunner;
};

export const validateWorkspaceSessionTarget = (
  { git }: { git: Pick<GitPort, "canonicalizePath"> & WorkspaceCheckoutGitPort },
  repoPath: string,
  target: WorkspaceSessionExecutionTarget,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* git.canonicalizePath(repoPath);
    const canonicalPath = yield* git.canonicalizePath(target.workingDirectory);
    const checkout = yield* classifyWorkspaceCheckout(git, {
      canonicalRepoPath,
      canonicalDirectory: canonicalPath,
    });
    if (checkout === "not_git_directory") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Workspace Session directory is not the saved canonical Git directory: ${target.workingDirectory}`,
          field: "workingDirectory",
        }),
      );
    }
    if (checkout === target.kind) {
      return;
    }
    if (target.kind === "local_repo_root") {
      return yield* Effect.fail(
        new HostValidationError({
          message: "Workspace Session checkout no longer matches its Workspace.",
          field: "workingDirectory",
        }),
      );
    }
    if (checkout === "local_repo_root") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Workspace Session worktree resolves to the Workspace repository root: ${canonicalPath}. Select a session that uses a worktree.`,
          field: "workingDirectory",
        }),
      );
    }
    return yield* Effect.fail(
      new HostValidationError({
        message: `Workspace Session directory is not a registered worktree of ${repoPath}: ${canonicalPath}`,
        field: "workingDirectory",
      }),
    );
  });

export const withWorkspaceSessionTarget = <A, E>(
  dependencies: WorkspaceSessionTargetDependencies,
  input: {
    owner: WorkspaceSessionRefInput;
    worktree: WorkspaceSessionWorktreeInput | undefined;
    repoConfig: RepoConfig;
    location: WorkspaceSessionExecutionTarget["kind"];
    targetBranch: GitTargetBranch;
  },
  use: (target: WorkspaceSessionExecutionTarget, retainTarget: () => void) => Effect.Effect<A, E>,
): Effect.Effect<A, E | HostError> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { git, settingsConfig, worktreeFiles } = dependencies;
      const { repoConfig } = input;
      const repoPath = yield* git.canonicalizePath(repoConfig.repoPath);
      if (!(yield* git.isGitRepository(repoPath))) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace is not a Git repository: ${repoPath}`,
            field: "repoPath",
          }),
        );
      }
      if (input.location === "local_repo_root") {
        return yield* restore(
          use({ kind: "local_repo_root", workingDirectory: repoPath }, () => {}),
        );
      }
      const worktree = input.worktree;
      if (!worktree) {
        return yield* Effect.fail(
          new HostValidationError({
            message: "Choose a worktree name and creation mode.",
            field: "worktree",
          }),
        );
      }
      const createBranch = worktree.mode === "from_name";
      const branch = worktree.branchName ?? `${repoConfig.branchPrefix}/${worktree.name}`;
      if (!workspaceSessionBranchNameSchema.safeParse(branch).success) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Invalid branch name: ${branch}. Choose a valid name under Advanced.`,
            field: "worktree.branchName",
          }),
        );
      }
      const branchExists = yield* git.referenceExists(repoPath, `refs/heads/${branch}`);
      if (createBranch === branchExists) {
        return yield* Effect.fail(
          new HostValidationError({
            message: createBranch
              ? `Branch already exists: ${branch}. Choose another name or use Existing branch.`
              : `Local branch no longer exists: ${branch}. Select another branch.`,
            field: "worktree.branchName",
          }),
        );
      }
      if (!createBranch) {
        const existingBranch = (yield* git.listBranches(repoPath)).find(
          (entry) => !entry.isRemote && entry.name === branch,
        );
        if (existingBranch?.worktreePath) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "worktree.branchName",
              message: `Branch ${branch} is already checked out at ${existingBranch.worktreePath}. Choose another branch or use Current checkout.`,
            }),
          );
        }
      }
      const newBranch = createBranch
        ? yield* planNewBranch(git, repoPath, branch, input.targetBranch)
        : null;
      const base =
        repoConfig.worktreeBasePath === undefined
          ? settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
          : settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
      const namespace = settingsConfig.join(base, "workspace-sessions");
      const workingDirectory = settingsConfig.join(namespace, worktree.name);
      if (yield* settingsConfig.pathExists(workingDirectory)) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Worktree directory already exists: ${workingDirectory}. Choose another name.`,
            field: "worktree.name",
          }),
        );
      }
      yield* worktreeFiles.ensureDirectory(namespace);
      let acquired = false;
      let retained = false;
      let createdTrackingRef: string | null = null;
      const actionRun = dependencies.worktreeActions.createRun({
        worktreePath: workingDirectory,
        branch,
      });
      const retainTarget = () => {
        retained = true;
      };
      const result = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                yield* git
                  .createWorktree(
                    repoPath,
                    workingDirectory,
                    branch,
                    createBranch,
                    newBranch?.startPoint,
                  )
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new HostOperationError({
                          operation: "workspaceSession.create.acquire",
                          message: `Git did not confirm worktree creation at ${workingDirectory} for branch ${branch}. Inspect the directory and branch before retrying. No automatic cleanup ran.\n${cause.message}`,
                          cause,
                        }),
                    ),
                  );
                acquired = true;
                if (newBranch?.upstreamRemote) {
                  const upstream = yield* git.configureBranchUpstream(
                    repoPath,
                    workingDirectory,
                    branch,
                    newBranch.upstreamRemote,
                  );
                  createdTrackingRef = upstream.createdTrackingRef;
                }
              }),
            );
            yield* worktreeFiles.copyConfiguredPaths(
              repoPath,
              workingDirectory,
              repoConfig.worktreeCopyPaths,
            );
            yield* runWorkspaceSessionWorktreeActions(actionRun, {
              owner: input.owner,
              repoPath,
              actions: repoConfig.actions,
            });
            const canonicalPath = yield* git.canonicalizePath(workingDirectory);
            return yield* Effect.uninterruptible(
              use(
                {
                  kind: "local_worktree",
                  workingDirectory: canonicalPath,
                  branchName: branch,
                  worktreeState: "present",
                },
                retainTarget,
              ),
            );
          }),
        ),
      );
      if (Exit.isSuccess(result)) return result.value;
      if (!acquired || retained) return yield* Effect.failCause(result.cause);

      yield* stopWorktreeActionTerminals(actionRun, {
        operation: "workspaceSession.create.cleanup",
        message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}`,
      });
      const cleanup = yield* Effect.exit(
        Effect.gen(function* () {
          if (yield* git.isRegisteredWorktree(repoPath, workingDirectory)) {
            yield* git.removeWorktree(repoPath, workingDirectory, true);
          }
          if (yield* settingsConfig.pathExists(workingDirectory)) {
            if (!(yield* worktreeFiles.pathIsWithinRoot(namespace, workingDirectory))) {
              return yield* Effect.fail(
                new HostValidationError({
                  message: `Cannot clean Workspace Session directory outside its namespace: ${workingDirectory}`,
                  field: "workingDirectory",
                }),
              );
            }
            yield* worktreeFiles.removePathIfPresent(workingDirectory);
          }
          if (createBranch && (yield* git.referenceExists(repoPath, `refs/heads/${branch}`))) {
            yield* git.deleteLocalBranch(repoPath, branch, true);
          }
          if (createdTrackingRef !== null) {
            yield* git.deleteReference(repoPath, createdTrackingRef);
          }
        }),
      );
      if (Exit.isFailure(cleanup)) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "workspaceSession.create.cleanup",
            message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}\nGit cleanup also failed: ${Cause.pretty(cleanup.cause)}`,
            cause: { creation: result.cause, cleanup: cleanup.cause },
          }),
        );
      }
      return yield* Effect.failCause(result.cause);
    }),
  );

/**
 * A new branch starts from the target branch. A remote target also gives the branch its upstream,
 * which Git names `<remote>/<branch>`. Both checks run before any Git write.
 */
const planNewBranch = (
  git: Pick<GitPort, "referenceExists">,
  repoPath: string,
  branch: string,
  targetBranch: GitTargetBranch,
) =>
  Effect.gen(function* () {
    const startPoint = canonicalTargetBranch(targetBranch);
    if (!(yield* git.referenceExists(repoPath, startPoint))) {
      return yield* new HostValidationError({
        message: `Target branch ${startPoint} is unavailable. Fetch it or select another target branch.`,
        field: "targetBranch",
      });
    }
    const upstreamRemote = targetBranch.remote?.trim() || null;
    // An existing remote branch with this name would become the upstream of an unrelated branch.
    if (
      upstreamRemote &&
      (yield* git.referenceExists(repoPath, `refs/remotes/${upstreamRemote}/${branch}`))
    ) {
      return yield* new HostValidationError({
        message: `Branch ${branch} already exists on ${upstreamRemote}. Choose another name.`,
        field: "worktree.branchName",
      });
    }
    return { startPoint, upstreamRemote };
  });
