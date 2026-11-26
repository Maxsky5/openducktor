import type {
  GitReadContext,
  GitTargetBranch,
  RepoConfig,
  WorkspaceSessionExecutionTarget,
  WorkspaceSessionRefInput,
  WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import {
  startupStep,
  updateStartup,
  type StartupStepUpdate,
} from "../agent-sessions/session-startup-progress";
import {
  buildWorktreeSetupPlanSteps,
  copyWorktreeConfiguredFiles,
} from "../agent-sessions/worktree-setup-plan";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { GitPort, OwnedTrackingRef } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorktreeActionRunner } from "../actions/worktree-action-runner";
import { managedWorktreeBaseForRepoConfig } from "../git/managed-worktree-roots";
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
  invalidTargetField,
  planNewBranch,
  resolveUniqueManagedWorktreeName,
  validateWorktreeBranch,
} from "./workspace-session-target-planning";
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
    | "deleteOwnedReference"
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
      return yield* invalidTargetField(
        "workingDirectory",
        `The directory of this session is not a Git checkout: ${target.workingDirectory}. Restore the checkout at this path, or archive this session.`,
      );
    }
    if (checkout === target.kind) return canonicalPath;
    if (target.kind === "local_repo_root") {
      return yield* invalidTargetField(
        "workingDirectory",
        `This session works in ${target.workingDirectory}, but the workspace repository is now ${repoPath}. Archive this session and start a new one.`,
      );
    }
    if (checkout === "local_repo_root") {
      return yield* invalidTargetField(
        "workingDirectory",
        `The worktree of this session is now the repository checkout: ${canonicalPath}. Archive this session, or start a Current checkout session.`,
      );
    }
    return yield* invalidTargetField(
      "workingDirectory",
      `The directory of this session is not a registered worktree of ${repoPath}: ${canonicalPath}. If you moved this worktree, run git worktree repair in it. Otherwise archive this session.`,
    );
  });

const planSimpleCheckout = (
  label: string,
  directory: string,
  tailSteps: readonly StartupStepUpdate[],
) =>
  tailSteps.length > 0
    ? updateStartup((progress) =>
        progress.plan([
          { id: "checkout", label, state: "pending", details: [directory] },
          ...tailSteps,
        ]),
      )
    : Effect.void;

export type WorkspaceSessionTargetBranchNaming = {
  step: { id: string; label: string };
  resolve: (repoPath: string) => Effect.Effect<{ branch: string; title: string | null }, HostError>;
};

export const withWorkspaceSessionTarget = <A, E>(
  dependencies: WorkspaceSessionTargetCreationDependencies,
  input: {
    owner: WorkspaceSessionRefInput;
    destination: WorkspaceSessionDestination;
    repoConfig: RepoConfig;
    targetBranch: GitTargetBranch;
    startPoint?: string;
    rollbackMode?: "all_owned";
    branchNaming?: WorkspaceSessionTargetBranchNaming;
    tailSteps?: readonly StartupStepUpdate[];
  },
  use: (
    target: WorkspaceSessionExecutionTarget,
    retainTarget: () => void,
    generatedTitle: string | null,
  ) => Effect.Effect<A, E>,
): Effect.Effect<A, E | HostError> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { git, settingsConfig, worktreeFiles } = dependencies;
      const { repoConfig, destination } = input;
      const tailSteps = input.tailSteps ?? [];
      const repoPath = yield* git.canonicalizePath(repoConfig.repoPath);
      // The existing worktree check reads the repository checkout itself.
      if (destination.location === "existing_worktree") {
        const { workingDirectory } = destination.existingWorktree;
        yield* planSimpleCheckout("Reuse existing worktree", workingDirectory, tailSteps);
        yield* dependencies.lifecycle.acquireWorktreeLifecycle([
          yield* worktreeFiles.resolveWorktreeRemovalPath(workingDirectory),
        ]);
        const target = yield* readExistingWorktreeTarget(dependencies, repoPath, workingDirectory);
        yield* updateStartup((progress) =>
          progress.step({
            id: "checkout",
            label: "Reuse existing worktree",
            state: "completed",
            details: [target.workingDirectory],
            resources: [{ kind: "worktree", value: target.workingDirectory, state: "reused" }],
          }),
        );
        return yield* restore(use(target, () => {}, null));
      }
      if (!(yield* git.isGitRepository(repoPath))) {
        return yield* invalidTargetField(
          "repoPath",
          `Workspace is not a Git repository: ${repoPath}`,
        );
      }
      if (destination.location === "local_repo_root") {
        yield* planSimpleCheckout("Use current checkout", repoPath, tailSteps);
        yield* updateStartup((progress) =>
          progress.step({
            id: "checkout",
            label: "Use current checkout",
            state: "completed",
            details: [repoPath],
          }),
        );
        return yield* restore(
          use({ kind: "local_repo_root", workingDirectory: repoPath }, () => {}, null),
        );
      }
      const { worktree } = destination;
      const createBranch = worktree.mode === "from_name";
      const newBranch = createBranch
        ? yield* planNewBranch(git, repoPath, input.targetBranch)
        : null;
      const base = managedWorktreeBaseForRepoConfig(settingsConfig, repoConfig);
      const namespace = settingsConfig.join(base, "workspace-sessions");
      const dirName =
        createBranch && worktree.name === ""
          ? yield* resolveUniqueManagedWorktreeName(
              settingsConfig,
              namespace,
              input.owner.sessionId,
            )
          : worktree.name;
      const workingDirectory = settingsConfig.join(namespace, dirName);
      // A restore of this directory holds its guard. Check the directory after it finishes.
      yield* dependencies.lifecycle.acquireWorktreeRead(
        yield* worktreeFiles.resolveWorktreeRemovalPath(workingDirectory),
      );
      if (yield* settingsConfig.pathExists(workingDirectory)) {
        return yield* invalidTargetField(
          "worktree.name",
          `Worktree directory already exists: ${workingDirectory}. Choose another name.`,
        );
      }
      const upstreamRemote = newBranch?.upstreamRemote;
      const plannedBranch =
        createBranch && input.branchNaming
          ? null
          : (worktree.branchName ?? `${repoConfig.branchPrefix}/${dirName}`);
      if (plannedBranch !== null) {
        yield* validateWorktreeBranch(git, repoPath, plannedBranch, createBranch);
      }
      yield* updateStartup((progress) =>
        progress.plan([
          ...buildWorktreeSetupPlanSteps({
            label: "Create workspace worktree",
            worktreePath: workingDirectory,
            branch: plannedBranch,
            namingStep:
              createBranch && input.branchNaming
                ? { ...input.branchNaming.step, state: "pending" }
                : null,
            upstreamRemote,
            repoConfig,
          }),
          ...tailSteps,
        ]),
      );
      let branch = plannedBranch ?? "";
      let generatedTitle: string | null = null;
      if (createBranch && input.branchNaming) {
        const named = yield* restore(input.branchNaming.resolve(repoPath));
        branch = named.branch;
        generatedTitle = named.title;
        yield* validateWorktreeBranch(git, repoPath, branch, true);
      }
      yield* worktreeFiles.ensureDirectory(namespace);
      let acquired = false;
      let retained = false;
      let ownedTrackingRef: OwnedTrackingRef | null = null;
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
                yield* startupStep(
                  {
                    id: "checkout",
                    label: "Create workspace worktree",
                    details: [workingDirectory, branch],
                  },
                  git
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
                    ),
                  () => ({
                    resources: [
                      { kind: "worktree", value: workingDirectory, state: "created" },
                      { kind: "branch", value: branch, state: createBranch ? "created" : "reused" },
                    ],
                  }),
                );
                acquired = true;
                if (upstreamRemote) {
                  const upstream = yield* startupStep(
                    { id: "upstream", label: "Set branch upstream" },
                    git.configureBranchUpstream(
                      repoPath,
                      workingDirectory,
                      branch,
                      upstreamRemote,
                      false,
                    ),
                  );
                  ownedTrackingRef = upstream;
                }
              }),
            );
            yield* copyWorktreeConfiguredFiles(
              worktreeFiles,
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
                generatedTitle,
              ),
            );
          }),
        ),
      );
      if (Exit.isSuccess(result)) return result.value;
      if (!acquired || retained) return yield* Effect.failCause(result.cause);
      yield* updateStartup((progress) => {
        progress.phase("settling");
        progress.step({
          id: "cleanup",
          label: "Clean up new worktree",
          state: "running",
          resources: [
            { kind: "worktree", value: workingDirectory, state: "retained" },
            { kind: "branch", value: branch, state: "retained" },
          ],
        });
      });

      const stopActions =
        input.rollbackMode === "all_owned"
          ? actionRun.stopTerminals().pipe(
              Effect.mapError(
                (cause) =>
                  new HostOperationError({
                    operation: "workspaceSession.create.cleanup",
                    message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}\nCould not stop worktree action terminals ${cause.terminalIds.join(", ")}: ${cause.cause.map((failure) => failure.message).join("; ")}. OpenDucktor kept worktree ${workingDirectory} and branch ${branch}. Close these terminals before removing these resources.`,
                    cause,
                  }),
              ),
            )
          : stopWorktreeActionTerminals(actionRun, {
              operation: "workspaceSession.create.cleanup",
              message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}`,
            });
      const stopped = yield* Effect.exit(stopActions);
      if (Exit.isFailure(stopped)) return yield* Effect.failCause(stopped.cause);
      const cleanupSteps: Effect.Effect<void, HostError>[] = [
        Effect.gen(function* () {
          if (yield* git.isRegisteredWorktree(repoPath, workingDirectory))
            yield* git.removeWorktree(repoPath, workingDirectory, true);
        }),
        Effect.gen(function* () {
          if (!(yield* settingsConfig.pathExists(workingDirectory))) return;
          if (!(yield* worktreeFiles.pathIsWithinRoot(namespace, workingDirectory))) {
            return yield* invalidTargetField(
              "workingDirectory",
              `Cannot clean Workspace Session directory outside its namespace: ${workingDirectory}`,
            );
          }
          yield* worktreeFiles.removePathIfPresent(workingDirectory);
        }),
        Effect.gen(function* () {
          if (createBranch && (yield* git.referenceExists(repoPath, `refs/heads/${branch}`)))
            yield* git.deleteLocalBranch(repoPath, branch, true);
        }),
        ownedTrackingRef !== null
          ? git.deleteOwnedReference(repoPath, ownedTrackingRef)
          : Effect.void,
      ];
      const failures: Cause.Cause<HostError>[] = [];
      for (const cleanup of cleanupSteps) {
        const cleaned = yield* Effect.exit(cleanup);
        if (Exit.isFailure(cleaned)) {
          failures.push(cleaned.cause);
          if (input.rollbackMode !== "all_owned") break;
        }
      }
      if (failures.length > 0)
        return yield* new HostOperationError({
          operation: "workspaceSession.create.cleanup",
          message: `Workspace Session creation failed: ${Cause.pretty(result.cause)}\nCleanup for worktree ${workingDirectory} and branch ${branch} also failed: ${failures.map(Cause.pretty).join("; ")}. Inspect these resources before retrying.`,
          cause: { creation: result.cause, cleanup: failures },
          details: { workingDirectory, branch },
        });
      yield* updateStartup((progress) =>
        progress.step({
          id: "cleanup",
          label: "Clean up new worktree",
          state: "completed",
          resources: [
            { kind: "worktree", value: workingDirectory, state: "removed" },
            { kind: "branch", value: branch, state: createBranch ? "removed" : "reused" },
          ],
        }),
      );
      return yield* Effect.failCause(result.cause);
    }),
  ).pipe(Effect.scoped);
