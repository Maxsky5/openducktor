import { Effect, Fiber } from "effect";
import { LOCAL_BRANCH_REF_PREFIX } from "../../domain/task";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import { namingFailureNotice, type NamingRepoConfig, type NamingService } from "./naming-service";

const REMOTE_REF_PREFIX = "refs/remotes/";

export type BranchNamingDependencies = {
  naming: NamingService;
  git: Pick<GitPort, "listRefNames" | "listRemoteNames">;
};

export type BranchNamingRequest = {
  repoConfig: NamingRepoConfig;
  /** A checkout of the repository, where Git lists the branches. */
  gitDirectory: string;
  workText: string;
  /** Names that the branch must not take besides the existing branches, such as the target branch. */
  reserved: readonly string[];
  /** The branch when the naming model gives none, such as a branch from the task title. */
  fallback: string;
  /** Also asks the model for a title, in the same answer. */
  withTitle: boolean;
};

export type NamedBranch = {
  /** The model branch, or the fallback. No local or remote branch has it. */
  branch: string;
  /** `branch` comes from the naming model. */
  generated: boolean;
  /**
   * The fallback, free of the existing branches and of `branch`, or null when a branch blocks it as
   * a folder. A caller whose Git change of a generated `branch` fails uses it.
   */
  fallback: string | null;
  /** The model title, or null when the request asked for none or the model gave none. */
  title: string | null;
  /** Why the branch is not the model branch, for the user, or null. A time-out shows none. */
  notice: string | null;
};

/** The startup step of the branch naming, or null when the workspace has no naming model. */
export const branchNamingStep = (
  repoConfig: Pick<NamingRepoConfig, "namingModel">,
  withTitle: boolean,
): { id: string; label: string } | null => {
  if (!repoConfig.namingModel) return null;
  return {
    id: "naming",
    label: withTitle ? "Generate branch name and session title" : "Generate branch name",
  };
};

/**
 * Names a new branch from the work text with the naming model of the workspace, and makes it free:
 * `-2`, `-3`, and so on when a local or remote branch or a reserved name has it. Git lists the
 * branches while the model writes the name. Without a usable model branch, the branch is the free
 * fallback, and `notice` says why. Fails only when Git cannot list the branches, or when the branch
 * is the fallback and a branch blocks it as a folder.
 */
export const nameBranch = (
  { naming, git }: BranchNamingDependencies,
  request: BranchNamingRequest,
): Effect.Effect<NamedBranch, GitPortError | HostValidationError> =>
  Effect.gen(function* () {
    const listing = yield* Effect.forkChild(
      readTakenBranchNames(git, request.gitDirectory, request.reserved),
    );
    const outcome = yield* naming.generate({
      repoConfig: request.repoConfig,
      kind: request.withTitle ? "branch_and_title" : "branch",
      workText: request.workText,
    });
    const taken = yield* Fiber.join(listing);
    /** The free fallback. `failure` says why naming failed, for the notice. */
    const fallback = (failure: string | null) =>
      freeBranchName(taken, request.fallback).pipe(
        Effect.map((branch): NamedBranch => ({
          branch,
          generated: false,
          fallback: branch,
          title: null,
          notice:
            failure === null
              ? null
              : namingFailureNotice(
                  failure,
                  `the branch ${branch}${request.withTitle ? " and the default title" : ""}`,
                ),
        })),
      );
    switch (outcome.status) {
      case "disabled":
      case "timed_out":
        return yield* fallback(null);
      case "failed":
        return yield* fallback(outcome.message);
      case "generated": {
        const generated = yield* Effect.result(freeBranchName(taken, outcome.answer.branch));
        if (generated._tag === "Failure") return yield* fallback(generated.failure.message);
        const branch = generated.success;
        const freeFallback = yield* Effect.result(
          freeBranchName(new Set([...taken, branch]), request.fallback),
        );
        return {
          branch,
          generated: true,
          fallback: freeFallback._tag === "Success" ? freeFallback.success : null,
          title: "title" in outcome.answer ? outcome.answer.title : null,
          notice: null,
        };
      }
    }
  });

/** The branch names that a new branch must not take. */
type TakenBranchNames = ReadonlySet<string>;

/**
 * The branches that a remote-tracking ref can stand for: one for each configured remote whose
 * name starts the ref. Remote names can contain a slash and can overlap, such as `origin` and
 * `origin/fix`, so `refs/remotes/origin/fix/login` stands for `fix/login` on `origin` and `login`
 * on `origin/fix`. Empty for a ref of no configured remote.
 */
const remoteBranchNames = (ref: string, remotes: readonly string[]): string[] => {
  const path = ref.slice(REMOTE_REF_PREFIX.length);
  return remotes
    .filter((name) => path.startsWith(`${name}/`))
    .map((name) => path.slice(name.length + 1));
};

/**
 * Reads the names that a new branch must not take, in one ref listing: every local branch, every
 * branch of a configured remote, and `reserved`. A remote branch counts because the new branch
 * would track it as its upstream, and a push would then update it.
 */
const readTakenBranchNames = (
  git: BranchNamingDependencies["git"],
  repoPath: string,
  reserved: readonly string[],
): Effect.Effect<TakenBranchNames, GitPortError> =>
  Effect.gen(function* () {
    const [refs, remotes] = yield* Effect.all(
      [
        git.listRefNames(repoPath, [LOCAL_BRANCH_REF_PREFIX, REMOTE_REF_PREFIX]),
        git.listRemoteNames(repoPath),
      ],
      { concurrency: "unbounded" },
    );
    const taken = new Set(reserved);
    for (const ref of refs) {
      if (ref.startsWith(LOCAL_BRANCH_REF_PREFIX))
        taken.add(ref.slice(LOCAL_BRANCH_REF_PREFIX.length));
      else for (const name of remoteBranchNames(ref, remotes)) taken.add(name);
    }
    return taken;
  });

/**
 * The first free name of a new branch: `branch`, then `branch-2`, `branch-3`, and so on. Git keeps
 * refs as files, so `fix` and `fix/login` cannot both exist: a name is also taken when a taken name
 * sits inside it as a folder. Fails when a taken name is a folder of `branch`, because no suffix
 * can free it.
 */
const freeBranchName = (
  taken: TakenBranchNames,
  branch: string,
): Effect.Effect<string, HostValidationError> => {
  const names = [...taken];
  const folder = names.find((name) => branch.startsWith(`${name}/`));
  if (folder !== undefined)
    return Effect.fail(
      new HostValidationError({
        field: "branchName",
        message: `Git cannot create branch ${branch}, because the branch ${folder} exists.`,
      }),
    );
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? branch : `${branch}-${suffix}`;
    if (!taken.has(candidate) && !names.some((name) => name.startsWith(`${candidate}/`)))
      return Effect.succeed(candidate);
  }
};
