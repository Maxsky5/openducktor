import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import { LOCAL_BRANCH_REF_PREFIX } from "../../domain/task";

const REMOTE = "refs/remotes/";

/**
 * The branches that a remote-tracking ref can stand for: one for each configured remote whose
 * name starts the ref. Remote names can contain a slash and can overlap, such as `origin` and
 * `origin/fix`, so `refs/remotes/origin/fix/login` stands for `fix/login` on `origin` and `login`
 * on `origin/fix`. Empty for a ref of no configured remote.
 */
const remoteBranchNames = (ref: string, remotes: readonly string[]): string[] => {
  const path = ref.slice(REMOTE.length);
  return remotes
    .filter((name) => path.startsWith(`${name}/`))
    .map((name) => path.slice(name.length + 1));
};

/** The branch names that a new branch must not take. */
export type TakenBranchNames = ReadonlySet<string>;

/**
 * Reads the names that a new branch must not take, in one ref listing: every local branch, every
 * branch of a configured remote, and `reserved`, such as the target branch. A remote branch counts
 * because the new branch would track it as its upstream, and a push would then update it.
 */
export const readTakenBranchNames = (
  git: Pick<GitPort, "listRefNames" | "listRemoteNames">,
  repoPath: string,
  reserved: readonly string[],
): Effect.Effect<TakenBranchNames, GitPortError> =>
  Effect.gen(function* () {
    const [refs, remotes] = yield* Effect.all(
      [
        git.listRefNames(repoPath, [LOCAL_BRANCH_REF_PREFIX, REMOTE]),
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
export const freeBranchName = (
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
