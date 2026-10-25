import {
  type GitReadContext,
  type GitTargetBranch,
  type RepoConfig,
  type WorkspaceSessionExecutionTarget,
  type WorkspaceSessionRefInput,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionBranchNameSchema,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { canonicalTargetBranch, targetBranchRef } from "../../domain/task/task-branch-policy";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorktreeActionRunner } from "../actions/worktree-action-runner";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import {
  type ExistingWorktreeDependencies,
  readExistingWorktreeTarget,
} from "./workspace-session-existing-worktree";
import {
  classifyWorkspaceCheckout,
  type WorkspaceCheckoutGitPort,
} from "../git/workspace-checkout";
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

export type WorkspaceSessionTargetValidationDependencies = {
  git: Pick<GitPort, "canonicalizePath"> & WorkspaceCheckoutGitPort;
};

export type WorkspaceSessionTargetCreationDependencies = {
  git: Pick<
    GitPort,
    | "canonicalizePath"
    | "isGitRepository"
    | "referenceExists"
    | "listBranches"
    | "createWorktree"
    | "configureBranchUpstream"
    | "isRegisteredWorktree"
    | "removeWorktree"
    | "deleteLocalBranch"
    | "deleteReference"
  > &
    ExistingWorktreeDependencies["git"];
  settingsConfig: Pick<
    SettingsConfigPort,
    "defaultWorktreeBasePath" | "resolveConfiguredPath" | "join" | "pathExists"
  >;
  worktreeFiles: Pick<
    WorktreeFilePort,
    | "ensureDirectory"
    | "copyConfiguredPaths"
    | "pathIsWithinRoot"
    | "removePathIfPresent"
    | "resolveWorktreeRemovalPath"
  >;
  worktreeActions: WorktreeActionRunner;
  lifecycle: Pick<
    TaskSessionLifecycleCoordinator,
    "acquireWorktreeRead" | "acquireWorktreeLifecycle"
  >;
};

/** Where a new chat works: the repository checkout, a new worktree, or an existing worktree. */
export type WorkspaceSessionDestination =
  | { location: "local_repo_root" }
  | { location: "local_worktree"; worktree: WorkspaceSessionWorktreeInput }
  | { location: "existing_worktree"; existingWorktree: { workingDirectory: string } };

/** Checks that a saved target is still its checkout of the workspace, and returns its real path. */
export const validateWorkspaceSessionTarget = (
  { git }: WorkspaceSessionTargetValidationDependencies,
  repoPath: string,
  target: WorkspaceSessionExecutionTarget,
  readContext?: GitReadContext,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* git.canonicalizePath(repoPath);
    const canonicalPath = yield* git.canonicalizePath(target.workingDirectory);
    const checkout = yield* classifyWorkspaceCheckout(
      git,
      { canonicalRepoPath, canonicalDirectory: canonicalPath },
      readContext,
    );
    if (checkout === "not_git_directory") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `The directory of this chat is not a Git checkout: ${target.workingDirectory}. Restore the checkout at this path, or archive this chat.`,
          field: "workingDirectory",
        }),
      );
    }
    if (checkout === target.kind) {
      return canonicalPath;
    }
    if (target.kind === "local_repo_root") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `This chat works in ${target.workingDirectory}, but the workspace repository is now ${repoPath}. Archive this chat and start a new chat.`,
          field: "workingDirectory",
        }),
      );
    }
    if (checkout === "local_repo_root") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `The worktree of this chat is now the repository checkout: ${canonicalPath}. Archive this chat, or start a Current checkout chat.`,
          field: "workingDirectory",
        }),
      );
    }
    return yield* Effect.fail(
      new HostValidationError({
        message: `The directory of this chat is not a registered worktree of ${repoPath}: ${canonicalPath}. If you moved this worktree, run git worktree repair in it. Otherwise archive this chat.`,
        field: "workingDirectory",
      }),
    );
  });

/**
 * Resolves the destination of a new chat and runs `use` with its target. Archive removal holds the
 * write guard of a directory, so a worktree destination holds a guard until `use` ends: a new chat
 * never saves a directory that archive removes. A new worktree holds a read guard, because runtime
 * and setup reads of it take read guards too. An existing worktree holds the write guard, so it
 * waits until a new worktree at that path finishes its setup or its rollback.
 */
export const withWorkspaceSessionTarget = <A, E>(
  dependencies: WorkspaceSessionTargetCreationDependencies,
  input: {
    owner: WorkspaceSessionRefInput;
    destination: WorkspaceSessionDestination;
    repoConfig: RepoConfig;
    targetBranch: GitTargetBranch;
    startPoint?: string;
    rollbackMode?: "all_owned";
  },
  use: (target: WorkspaceSessionExecutionTarget, retainTarget: () => void) => Effect.Effect<A, E>,
): Effect.Effect<A, E | HostError> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { git, settingsConfig, worktreeFiles } = dependencies;
      const { repoConfig, destination } = input;
      const repoPath = yield* git.canonicalizePath(repoConfig.repoPath);
      // The existing worktree check reads the repository checkout itself.
      if (destination.location === "existing_worktree") {
        const { workingDirectory } = destination.existingWorktree;
        yield* dependencies.lifecycle.acquireWorktreeLifecycle([
          yield* worktreeFiles.resolveWorktreeRemovalPath(workingDirectory),
        ]);
        const target = yield* readExistingWorktreeTarget(dependencies, repoPath, workingDirectory);
        return yield* restore(use(target, () => {}));
      }
      if (!(yield* git.isGitRepository(repoPath))) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace is not a Git repository: ${repoPath}`,
            field: "repoPath",
          }),
        );
      }
      if (destination.location === "local_repo_root") {
        return yield* restore(
          use({ kind: "local_repo_root", workingDirectory: repoPath }, () => {}),
        );
      }
      const { worktree } = destination;
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
        ? yield* planNewBranch(git, repoPath, input.targetBranch)
        : null;
      const base =
        repoConfig.worktreeBasePath === undefined
          ? settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
          : settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
      const namespace = settingsConfig.join(base, "workspace-sessions");
      const workingDirectory = settingsConfig.join(namespace, worktree.name);
      // A restore of this directory holds its guard. Check the directory after it finishes.
      yield* dependencies.lifecycle.acquireWorktreeRead(
        yield* worktreeFiles.resolveWorktreeRemovalPath(workingDirectory),
      );
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
                    createBranch ? (input.startPoint ?? newBranch?.startPoint) : undefined,
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

      const stopActions =
        input.rollbackMode === "all_owned"
          ? actionRun.stopTerminals().pipe(
              Effect.mapError(
                (cause) =>
                  new HostOperationError({
                    operation: "workspaceSession.create.cleanup",
                    message: `Could not stop worktree action terminals ${cause.terminalIds.join(", ")}: ${cause.cause.map((failure) => failure.message).join("; ")}. Close these terminals before retrying.`,
                    cause,
                  }),
              ),
            )
          : stopWorktreeActionTerminals(actionRun, {
              operation: "workspaceSession.create.cleanup",
              message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}`,
            });
      const stopped = yield* Effect.exit(stopActions);
      if (Exit.isFailure(stopped) && input.rollbackMode !== "all_owned")
        return yield* Effect.failCause(stopped.cause);
      const removeWorktree = Effect.gen(function* () {
        if (yield* git.isRegisteredWorktree(repoPath, workingDirectory))
          yield* git.removeWorktree(repoPath, workingDirectory, true);
      });
      const removeDirectory = Effect.gen(function* () {
        if (yield* settingsConfig.pathExists(workingDirectory)) {
          if (!(yield* worktreeFiles.pathIsWithinRoot(namespace, workingDirectory)))
            return yield* new HostValidationError({
              message: `Cannot clean Workspace Session directory outside its namespace: ${workingDirectory}`,
              field: "workingDirectory",
            });
          yield* worktreeFiles.removePathIfPresent(workingDirectory);
        }
      });
      const removeBranch = Effect.gen(function* () {
        if (createBranch && (yield* git.referenceExists(repoPath, `refs/heads/${branch}`)))
          yield* git.deleteLocalBranch(repoPath, branch, true);
      });
      const removeTrackingRef = Effect.gen(function* () {
        if (createdTrackingRef !== null) yield* git.deleteReference(repoPath, createdTrackingRef);
      });
      const cleanups: Exit.Exit<void, HostError>[] = [stopped];
      for (const cleanup of [removeWorktree, removeDirectory, removeBranch, removeTrackingRef]) {
        const cleaned = yield* Effect.exit(cleanup);
        cleanups.push(cleaned);
        if (Exit.isFailure(cleaned) && input.rollbackMode !== "all_owned") break;
      }
      const failures = cleanups.flatMap((cleanup) =>
        Exit.isFailure(cleanup) ? [cleanup.cause] : [],
      );
      if (failures.length > 0)
        return yield* new HostOperationError({
          operation: "workspaceSession.create.cleanup",
          message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}\nCleanup for worktree ${workingDirectory} and branch ${branch} also failed: ${failures.map(Cause.pretty).join("; ")}. Inspect these resources before retrying.`,
          cause: { creation: result.cause, cleanup: failures },
          details: { workingDirectory, branch },
        });
      return yield* Effect.failCause(result.cause);
    }),
  ).pipe(Effect.scoped);

/** Validate the selected target before Git writes. A remote target gives the new branch its upstream. */
const planNewBranch = (
  git: Pick<GitPort, "referenceExists">,
  repoPath: string,
  targetBranch: GitTargetBranch,
) =>
  Effect.gen(function* () {
    const startPoint = targetBranchRef(targetBranch);
    if (!(yield* git.referenceExists(repoPath, startPoint))) {
      return yield* new HostValidationError({
        message: `Target branch ${canonicalTargetBranch(targetBranch)} is unavailable. Fetch it or select another target branch.`,
        field: "targetBranch",
      });
    }
    return { startPoint, upstreamRemote: targetBranch.remote?.trim() || null };
  });
