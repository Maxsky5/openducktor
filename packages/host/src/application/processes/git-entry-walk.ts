import type { CanonicalPathPlatform } from "@openducktor/path-support";
import { Effect } from "effect";
import type { GitPort } from "../../ports/git-port";
import { parentDirectory, pathKey } from "./process-path-keys";

type GitEntryWalkDependencies = {
  git: Pick<GitPort, "hasGitEntry">;
  pathPlatform: CanonicalPathPlatform;
};

/**
 * Whether a folder from `directory` up to the folder with the key `stopKey` has a `.git` entry,
 * like the search of Git for the checkout root. The walk does not check `stopKey` itself. With a
 * null `stopKey`, it ends at the file system root. `unknown` when the file system cannot answer.
 */
export type GitEntryWalk = (
  directory: string,
  stopKey: string | null,
) => Effect.Effect<boolean | "unknown">;

/** A walk for one read. Processes share folders, so it checks each folder once. */
export const createGitEntryWalk = (dependencies: GitEntryWalkDependencies): GitEntryWalk => {
  const { git, pathPlatform } = dependencies;
  const checked = new Map<string, boolean | "unknown">();
  const check = (directory: string, key: string) =>
    Effect.gen(function* () {
      const known = checked.get(key);
      if (known !== undefined) return known;
      const read = yield* git.hasGitEntry(directory).pipe(Effect.result);
      const result = read._tag === "Success" ? read.success : "unknown";
      checked.set(key, result);
      return result;
    });
  return (directory, stopKey) =>
    Effect.gen(function* () {
      for (
        let current: string | null = directory;
        current !== null;
        current = parentDirectory(current, pathPlatform)
      ) {
        const key = pathKey(current, pathPlatform);
        if (key === stopKey) return false;
        const found = yield* check(current, key);
        if (found !== false) return found;
      }
      return false;
    });
};
