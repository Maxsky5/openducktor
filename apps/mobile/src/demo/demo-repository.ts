import type {
  FileStatus,
  GitFileDiff,
  GitLocalChanges,
  GitWorktreeStatus,
  WorkspaceFileTreeRefreshResult,
  WorkspaceTextFileReadResult,
} from "@openducktor/contracts";

/** A file of the demo repository: text, or a bundled image as base64. */
export type DemoFile =
  | { kind: "text"; text: string }
  | {
      kind: "image";
      mime: Extract<WorkspaceTextFileReadResult, { kind: "image" }>["mime"];
      base64: string;
    };

/** File changes by path. `null` deletes the file. */
type DemoFileChanges = ReadonlyMap<string, DemoFile | null>;

/** One commit of a demo branch: its ID and the files that it changes. */
type DemoCommit = { readonly id: string; readonly changes: DemoFileChanges };

/** One checkout of the demo repository: the repository root or a worktree of a task or a chat. */
export type DemoCheckout = {
  readonly workingDirectory: string;
  readonly branch: string;
  /** The commit of the checkout, which changes with each scripted commit. */
  revision: string;
  /**
   * The commits of the branch since the target branch, oldest first. Branches that share commits
   * share their IDs, so the merge base of two branches is their common first commits.
   */
  log: DemoCommit[];
  /** The changes of the working files that no commit holds yet. */
  uncommitted: Map<string, DemoFile | null>;
};

const CONTEXT_LINES = 3;

/** A 64-bit FNV-1a hash as 16 hex digits, for the snapshot hashes of the Git reads. */
const hash16 = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
};

/** A commit ID of 40 hex digits made from `seed`. */
const commitId = (seed: string): string =>
  `${hash16(seed)}${hash16(`${seed}:1`)}${hash16(`${seed}:2`)}`.slice(0, 40);

const linesOf = (file: DemoFile | null | undefined): string[] => {
  if (!file || file.kind !== "text" || file.text === "") return [];
  const lines = file.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

type Edit = { kind: "same" | "add" | "remove"; line: string; oldIndex: number; newIndex: number };

/** The line edits from `before` to `after`, from their longest common subsequence. */
const lineEdits = (before: string[], after: string[]): Edit[] => {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const lengths = new Uint32Array(rows * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i * columns + j] =
        before[i] === after[j]
          ? (lengths[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * columns + j] ?? 0, lengths[i * columns + j + 1] ?? 0);
    }
  }
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      edits.push({ kind: "same", line: before[i] ?? "", oldIndex: i, newIndex: j });
      i += 1;
      j += 1;
    } else if (
      i < before.length &&
      (j === after.length ||
        (lengths[(i + 1) * columns + j] ?? 0) >= (lengths[i * columns + j + 1] ?? 0))
    ) {
      // Removed lines come before added lines, as `git diff` prints them.
      edits.push({ kind: "remove", line: before[i] ?? "", oldIndex: i, newIndex: j });
      i += 1;
    } else {
      edits.push({ kind: "add", line: after[j] ?? "", oldIndex: i, newIndex: j });
      j += 1;
    }
  }
  return edits;
};

/** A unified patch of one file, as `git diff` prints it. */
export const fileDiff = (
  path: string,
  before: DemoFile | null | undefined,
  after: DemoFile | null | undefined,
): GitFileDiff => {
  const type: GitFileDiff["type"] = !before ? "added" : !after ? "deleted" : "modified";
  const oldLines = linesOf(before);
  const newLines = linesOf(after);
  const edits = lineEdits(oldLines, newLines);
  const header = [
    `diff --git a/${path} b/${path}`,
    ...(type === "added" ? ["new file mode 100644"] : []),
    ...(type === "deleted" ? ["deleted file mode 100644"] : []),
    `index ${hash16(JSON.stringify(before ?? null)).slice(0, 7)}..${hash16(JSON.stringify(after ?? null)).slice(0, 7)}`,
    type === "added" ? "--- /dev/null" : `--- a/${path}`,
    type === "deleted" ? "+++ /dev/null" : `+++ b/${path}`,
  ];
  const isImage = before?.kind === "image" || after?.kind === "image";
  if (isImage) {
    return {
      file: path,
      type,
      additions: 0,
      deletions: 0,
      diff: [...header.slice(0, -2), `Binary files differ`, ""].join("\n"),
    };
  }
  const changed = edits
    .map((edit, index) => (edit.kind === "same" ? -1 : index))
    .filter((at) => at >= 0);
  const hunks: string[] = [];
  let start = 0;
  while (start < changed.length) {
    let end = start;
    while (
      end + 1 < changed.length &&
      (changed[end + 1] ?? 0) - (changed[end] ?? 0) <= CONTEXT_LINES * 2 + 1
    ) {
      end += 1;
    }
    const from = Math.max(0, (changed[start] ?? 0) - CONTEXT_LINES);
    const to = Math.min(edits.length - 1, (changed[end] ?? 0) + CONTEXT_LINES);
    const slice = edits.slice(from, to + 1);
    const first = slice[0];
    const oldStart = first ? first.oldIndex + 1 : 0;
    const newStart = first ? first.newIndex + 1 : 0;
    const oldCount = slice.filter((edit) => edit.kind !== "add").length;
    const newCount = slice.filter((edit) => edit.kind !== "remove").length;
    hunks.push(
      `@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@`,
    );
    for (const edit of slice) {
      hunks.push(`${edit.kind === "add" ? "+" : edit.kind === "remove" ? "-" : " "}${edit.line}`);
    }
    start = end + 1;
  }
  return {
    file: path,
    type,
    additions: edits.filter((edit) => edit.kind === "add").length,
    deletions: edits.filter((edit) => edit.kind === "remove").length,
    diff: `${[...header, ...hunks].join("\n")}\n`,
  };
};

const sameFile = (left: DemoFile | null | undefined, right: DemoFile | null | undefined) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

type Hunk = { start: number; end: number; lines: string[]; side: "ours" | "theirs" };

/** The changed line ranges of `other` against `base`: each replaces base lines `start` to `end`. */
const hunksOf = (base: string[], other: string[], side: Hunk["side"]): Hunk[] => {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const edit of lineEdits(base, other)) {
    if (edit.kind === "same") {
      current = null;
      continue;
    }
    if (!current) {
      current = { start: edit.oldIndex, end: edit.oldIndex, lines: [], side };
      hunks.push(current);
    }
    if (edit.kind === "remove") current.end = edit.oldIndex + 1;
    else current.lines.push(edit.line);
  }
  return hunks;
};

/**
 * A three-way line merge, as `git merge-file` does: changes that touch the same lines conflict.
 * With `union`, two insertions at the same line keep both, `theirs` first, as `merge=union` does,
 * and a line that both insert stays once.
 * Returns null on a conflict.
 */
const mergeLines = (
  base: string[],
  ours: string[],
  theirs: string[],
  union: boolean,
): string[] | null => {
  const hunks = [...hunksOf(base, ours, "ours"), ...hunksOf(base, theirs, "theirs")].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: Hunk[] = [];
  for (const hunk of hunks) {
    const last = merged.at(-1);
    if (!last || hunk.start > last.end) {
      merged.push({ ...hunk, lines: [...hunk.lines] });
      continue;
    }
    const same =
      hunk.start === last.start &&
      hunk.end === last.end &&
      hunk.lines.join("\n") === last.lines.join("\n");
    if (same) continue;
    const insertions =
      union && hunk.start === last.start && hunk.end === hunk.start && last.end === last.start;
    if (!insertions) return null;
    // A line that both sides inserted, such as an inherited changelog entry, stays once.
    const [first, second] =
      hunk.side === "theirs" ? [hunk.lines, last.lines] : [last.lines, hunk.lines];
    const kept = new Set(first);
    last.lines = [...first, ...second.filter((line) => !kept.has(line))];
  }
  const output: string[] = [];
  let position = 0;
  for (const hunk of merged) {
    output.push(...base.slice(position, hunk.start), ...hunk.lines);
    position = hunk.end;
  }
  output.push(...base.slice(position));
  return output;
};

/** The paths that `.gitattributes` merges with the `union` driver. */
const unionPaths = (attributes: DemoFile | null): Set<string> =>
  new Set(
    linesOf(attributes).flatMap((line) => {
      const [pattern, ...rest] = line.trim().split(/\s+/);
      return pattern && rest.includes("merge=union") ? [pattern] : [];
    }),
  );

const statusLetter = (diff: GitFileDiff): string =>
  diff.type === "added" ? "A" : diff.type === "deleted" ? "D" : "M";

/**
 * The demo repository of one workspace: its first files and the commit log of each branch. The
 * repository root holds the target branch. Every Git read compares these files, so Changes, Files,
 * and tool diffs agree.
 */
export type DemoRepository = {
  readonly repoPath: string;
  readonly targetBranch: string;
  checkout(workingDirectory: string): DemoCheckout;
  findCheckout(workingDirectory: string): DemoCheckout | null;
  /**
   * Adds a worktree on a new branch from the target branch, from the branch `base`, or from the
   * commits of `from`. An existing checkout at that folder stops it.
   */
  addWorktree(input: {
    workingDirectory: string;
    branch: string;
    from?: DemoCheckout;
    base?: string;
  }): DemoCheckout;
  removeWorktree(workingDirectory: string): void;
  worktrees(): DemoCheckout[];
  /** The file at `path` in the working files of a checkout, or null. */
  readFile(checkout: DemoCheckout, path: string): DemoFile | null;
  /** Writes changes to the working files and commits them, as a scripted agent does. */
  commit(checkout: DemoCheckout, changes: DemoFileChanges, message: string): GitFileDiff[];
  /** Puts a branch back on the branch `base` and drops its working changes. */
  resetBranch(checkout: DemoCheckout, base: string): void;
  /**
   * Squashes the changes of a branch since its merge base into one commit on `targetRef`, as
   * Direct Merge does, with a three-way merge of each file. A conflict throws before any change.
   * The target is the default branch or the branch of another checkout.
   */
  mergeInto(checkout: DemoCheckout, targetRef: string): void;
  /** The changes of a branch since the default target branch. */
  branchDiffs(checkout: DemoCheckout): GitFileDiff[];
  localChanges(checkout: DemoCheckout, observedAtMs: number): GitLocalChanges;
  worktreeStatus(
    checkout: DemoCheckout,
    targetRef: string,
    observedAtMs: number,
  ): GitWorktreeStatus;
  fileTree(checkout: DemoCheckout, targetBranch: string | null): WorkspaceFileTreeRefreshResult;
  readFileResult(checkout: DemoCheckout, relativePath: string): WorkspaceTextFileReadResult;
  /** The paths of the working files of a checkout. */
  paths(checkout: DemoCheckout): string[];
  /** `git status` lines for a demo terminal. */
  statusLines(checkout: DemoCheckout): string[];
};

export const createDemoRepository = (input: {
  repoPath: string;
  targetBranch: string;
  files: ReadonlyMap<string, DemoFile>;
}): DemoRepository => {
  const initial = new Map<string, DemoFile>(input.files);
  const checkouts = new Map<string, DemoCheckout>();
  const initialRevision = commitId(`${input.repoPath}:${input.targetBranch}`);
  /** The repository root, on the target branch. Its log is the history of the target branch. */
  const root: DemoCheckout = {
    workingDirectory: input.repoPath,
    branch: input.targetBranch,
    revision: initialRevision,
    log: [],
    uncommitted: new Map(),
  };
  checkouts.set(input.repoPath, root);
  let treeRevision = 0;

  /** The file at `path` after the commits of `log`, on top of the first files of the repository. */
  const fileAfter = (log: readonly DemoCommit[], path: string): DemoFile | null => {
    for (let index = log.length - 1; index >= 0; index -= 1) {
      const changes = log[index]?.changes;
      if (changes?.has(path)) return changes.get(path) ?? null;
    }
    return initial.get(path) ?? null;
  };
  const headFile = (checkout: DemoCheckout, path: string): DemoFile | null =>
    fileAfter(checkout.log, path);
  const readFile = (checkout: DemoCheckout, path: string): DemoFile | null => {
    if (checkout.uncommitted.has(path)) return checkout.uncommitted.get(path) ?? null;
    return headFile(checkout, path);
  };
  const changedPaths = (log: readonly DemoCommit[]): string[] => [
    ...new Set(log.flatMap((commit) => [...commit.changes.keys()])),
  ];
  const paths = (checkout: DemoCheckout): string[] => {
    const all = new Set([
      ...initial.keys(),
      ...changedPaths(checkout.log),
      ...checkout.uncommitted.keys(),
    ]);
    return [...all].filter((path) => readFile(checkout, path) !== null).sort();
  };

  /** The checkout of a branch ref: the root for the target branch, or a worktree. */
  const checkoutOfRef = (ref: string): DemoCheckout => {
    const name = ref.replace(/^refs\/(heads|remotes)\//, "").replace(/^origin\//, "");
    if (name === input.targetBranch || name === "@{upstream}") return root;
    for (const checkout of checkouts.values()) {
      if (checkout.branch === name) return checkout;
    }
    throw new Error(`The demo repository has no branch ${name}. Choose another target branch.`);
  };
  /** The number of first commits that two branches share: their merge base. */
  const sharedCommits = (left: readonly DemoCommit[], right: readonly DemoCommit[]): number => {
    let count = 0;
    while (count < left.length && count < right.length && left[count]?.id === right[count]?.id)
      count += 1;
    return count;
  };
  /**
   * The changes of a checkout since its merge base with `baseLog`: the commits and the working
   * files, as the host diffs the merge base with the working tree.
   */
  const diffsSince = (checkout: DemoCheckout, baseLog: readonly DemoCommit[]): GitFileDiff[] => {
    const mergeBase = checkout.log.slice(0, sharedCommits(checkout.log, baseLog));
    const changed = new Set([
      ...changedPaths(checkout.log.slice(mergeBase.length)),
      ...checkout.uncommitted.keys(),
    ]);
    return [...changed]
      .sort()
      .filter((path) => !sameFile(fileAfter(mergeBase, path), readFile(checkout, path)))
      .map((path) => fileDiff(path, fileAfter(mergeBase, path), readFile(checkout, path)));
  };
  const branchDiffs = (checkout: DemoCheckout): GitFileDiff[] => diffsSince(checkout, root.log);
  const uncommittedDiffs = (checkout: DemoCheckout): GitFileDiff[] =>
    [...checkout.uncommitted.keys()]
      .sort()
      .filter((path) => !sameFile(headFile(checkout, path), checkout.uncommitted.get(path)))
      .map((path) => fileDiff(path, headFile(checkout, path), checkout.uncommitted.get(path)));

  const currentBranch = (checkout: DemoCheckout) => ({
    name: checkout.branch,
    detached: false,
    revision: checkout.revision,
  });

  const upstream = (checkout: DemoCheckout): GitLocalChanges["upstreamAheadBehind"] =>
    checkout.workingDirectory === input.repoPath
      ? { outcome: "tracking", ahead: 0, behind: 0 }
      : {
          outcome: "untracked",
          ahead: checkout.log.length - sharedCommits(checkout.log, root.log),
        };

  const snapshotHashes = (diffs: GitFileDiff[]) => ({
    hashVersion: 1,
    statusHash: hash16(diffs.map((diff) => `${diff.file}:${diff.type}`).join("|")),
    diffHash: hash16(diffs.map((diff) => diff.diff).join("|")),
  });

  const repository: DemoRepository = {
    repoPath: input.repoPath,
    targetBranch: input.targetBranch,
    checkout(workingDirectory) {
      const found = checkouts.get(workingDirectory);
      if (!found) throw new Error(`The demo has no checkout at ${workingDirectory}.`);
      return found;
    },
    findCheckout: (workingDirectory) => checkouts.get(workingDirectory) ?? null,
    addWorktree({ workingDirectory, branch, from, base }) {
      if (checkouts.has(workingDirectory))
        throw new Error("A worktree already uses this folder. Enter another name.");
      if ([...checkouts.values()].some((other) => other.branch === branch))
        throw new Error(`A worktree already uses the branch ${branch}. Enter another branch name.`);
      const log = from ? from.log : checkoutOfRef(base ?? input.targetBranch).log;
      const created: DemoCheckout = {
        workingDirectory,
        branch,
        revision: log.at(-1)?.id ?? initialRevision,
        log: [...log],
        uncommitted: new Map(),
      };
      checkouts.set(workingDirectory, created);
      return created;
    },
    removeWorktree(workingDirectory) {
      if (workingDirectory !== input.repoPath) checkouts.delete(workingDirectory);
    },
    worktrees: () =>
      [...checkouts.values()].filter((checkout) => checkout.workingDirectory !== input.repoPath),
    readFile,
    commit(checkout, changes, message) {
      const diffs = [...changes.entries()].map(([path, file]) =>
        fileDiff(path, readFile(checkout, path), file),
      );
      for (const path of changes.keys()) checkout.uncommitted.delete(path);
      checkout.revision = commitId(`${checkout.revision}:${message}`);
      checkout.log.push({ id: checkout.revision, changes: new Map(changes) });
      treeRevision += 1;
      return diffs;
    },
    resetBranch(checkout, base) {
      checkout.log = [...checkoutOfRef(base).log];
      checkout.uncommitted.clear();
      checkout.revision = checkout.log.at(-1)?.id ?? initialRevision;
      treeRevision += 1;
    },
    mergeInto(checkout, targetRef) {
      const into = checkoutOfRef(targetRef);
      const mergeBase = checkout.log.slice(0, sharedCommits(checkout.log, into.log));
      const union = unionPaths(headFile(into, ".gitattributes"));
      const changes = new Map<string, DemoFile | null>();
      const conflicts: string[] = [];
      for (const path of changedPaths(checkout.log.slice(mergeBase.length))) {
        const base = fileAfter(mergeBase, path);
        const theirs = headFile(checkout, path);
        const ours = headFile(into, path);
        // Only a real change of the branch goes in, and an unchanged target takes it as it is.
        if (sameFile(base, theirs) || sameFile(ours, theirs)) continue;
        if (sameFile(base, ours)) {
          changes.set(path, theirs);
          continue;
        }
        const lines =
          base?.kind === "text" && ours?.kind === "text" && theirs?.kind === "text"
            ? mergeLines(linesOf(base), linesOf(ours), linesOf(theirs), union.has(path))
            : null;
        if (lines)
          changes.set(path, { kind: "text", text: lines.map((line) => `${line}\n`).join("") });
        else conflicts.push(path);
      }
      // The merge checks every path first, so a conflict changes nothing.
      if (conflicts.length > 0)
        throw new Error(
          `${conflicts.join(", ")} changed on both branches. The demo cannot resolve Git conflicts, so choose another target branch or use a pull request.`,
        );
      if (changes.size === 0) return;
      // A squash merge adds one commit to the target branch. The source branch keeps its commits.
      into.revision = commitId(`${into.revision}:squash:${checkout.branch}`);
      into.log.push({ id: into.revision, changes });
      treeRevision += 1;
    },
    branchDiffs,
    localChanges(checkout, observedAtMs) {
      const diffs = uncommittedDiffs(checkout);
      const statuses: FileStatus[] = diffs.map((diff) => ({
        path: diff.file,
        status: statusLetter(diff),
        staged: false,
      }));
      const hashes = snapshotHashes(diffs);
      return {
        currentBranch: currentBranch(checkout),
        fileStatuses: statuses,
        unstaged: { fileStatuses: statuses, fileDiffs: diffs, snapshot: hashes },
        staged: { fileStatuses: [], fileDiffs: [], snapshot: snapshotHashes([]) },
        conflicted: { fileStatuses: [], fileDiffs: [] },
        upstreamAheadBehind: upstream(checkout),
        snapshot: {
          effectiveWorkingDir: checkout.workingDirectory,
          targetBranch: "",
          diffScope: "uncommitted",
          observedAtMs,
          ...hashes,
        },
      };
    },
    worktreeStatus(checkout, targetRef, observedAtMs) {
      const baseLog = checkoutOfRef(targetRef).log;
      const shared = sharedCommits(checkout.log, baseLog);
      const diffs = diffsSince(checkout, baseLog);
      return {
        currentBranch: currentBranch(checkout),
        fileStatuses: uncommittedDiffs(checkout).map((diff) => ({
          path: diff.file,
          status: statusLetter(diff),
          staged: false,
        })),
        fileDiffs: diffs,
        targetAheadBehind: { ahead: checkout.log.length - shared, behind: baseLog.length - shared },
        upstreamAheadBehind: upstream(checkout),
        snapshot: {
          effectiveWorkingDir: checkout.workingDirectory,
          targetBranch: targetRef,
          diffScope: "target",
          observedAtMs,
          ...snapshotHashes(diffs),
        },
      };
    },
    fileTree(checkout, targetBranch) {
      const uncommitted = new Map(uncommittedDiffs(checkout).map((diff) => [diff.file, diff]));
      const branch = new Map(
        diffsSince(checkout, checkoutOfRef(targetBranch ?? input.targetBranch).log).map((diff) => [
          diff.file,
          diff,
        ]),
      );
      const statusOf = (path: string) => {
        const diff = uncommitted.get(path) ?? branch.get(path);
        if (!diff) return null;
        return diff.type === "added" ? "added" : diff.type === "deleted" ? "deleted" : "modified";
      };
      treeRevision += 1;
      return {
        kind: "snapshot",
        rootPath: checkout.workingDirectory,
        context: {
          rootPath: checkout.workingDirectory,
          gitDirectory: `${input.repoPath}/.git`,
          branch: checkout.branch,
          head: checkout.revision,
          targetBranch,
          targetRevision: null,
          indexVersion: null,
          sparsePolicy: "none",
        },
        cursor: { viewId: `demo-tree:${checkout.workingDirectory}`, revision: treeRevision },
        entries: paths(checkout).map((path) => {
          const file = readFile(checkout, path);
          return {
            path,
            kind: "file" as const,
            size: file?.kind === "text" ? file.text.length : (file?.base64.length ?? 0),
            mtimeMs: null,
            gitStatus: statusOf(path),
          };
        }),
      };
    },
    readFileResult(checkout, relativePath) {
      const file = readFile(checkout, relativePath);
      if (!file)
        throw new Error(`${relativePath} is not in this demo worktree. Refresh the files.`);
      if (file.kind === "image")
        return {
          kind: "image",
          rootPath: checkout.workingDirectory,
          relativePath,
          mime: file.mime,
          base64: file.base64,
          revision: hash16(file.base64),
          size: file.base64.length,
          mtimeMs: null,
        };
      return {
        kind: "text",
        rootPath: checkout.workingDirectory,
        relativePath,
        contents: file.text,
        size: file.text.length,
        mtimeMs: null,
        revision: hash16(file.text),
      };
    },
    paths,
    statusLines(checkout) {
      const changes = uncommittedDiffs(checkout);
      const lines = [`On branch ${checkout.branch}`];
      if (changes.length === 0) return [...lines, "nothing to commit, working tree clean"];
      return [
        ...lines,
        "Changes not staged for commit:",
        ...changes.map((diff) => `        ${diff.type}:   ${diff.file}`),
      ];
    },
  };
  return repository;
};
