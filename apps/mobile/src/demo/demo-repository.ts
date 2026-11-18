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
export type DemoFileChanges = ReadonlyMap<string, DemoFile | null>;

/** One checkout of the demo repository: the repository root or a worktree of a task or a chat. */
export type DemoCheckout = {
  readonly workingDirectory: string;
  readonly branch: string;
  /** The commit of the checkout, which changes with each scripted commit. */
  revision: string;
  /** The commits of the branch since the target branch, as file changes. */
  committed: Map<string, DemoFile | null>;
  /** The changes of the working files that no commit holds yet. */
  uncommitted: Map<string, DemoFile | null>;
  /** The number of commits on the branch since the target branch. */
  commits: number;
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

const statusLetter = (diff: GitFileDiff): string =>
  diff.type === "added" ? "A" : diff.type === "deleted" ? "D" : "M";

/**
 * The demo repository of one workspace: the files of the target branch and the checkouts that
 * change them. Every Git read compares these files, so Changes, Files, and tool diffs agree.
 */
export type DemoRepository = {
  readonly repoPath: string;
  readonly targetBranch: string;
  checkout(workingDirectory: string): DemoCheckout;
  findCheckout(workingDirectory: string): DemoCheckout | null;
  /**
   * Adds a worktree on a new branch from the target branch, or from the commits of `from`. An
   * existing checkout at that folder stops it.
   */
  addWorktree(input: {
    workingDirectory: string;
    branch: string;
    from?: DemoCheckout;
  }): DemoCheckout;
  removeWorktree(workingDirectory: string): void;
  worktrees(): DemoCheckout[];
  /** The file at `path` in the working files of a checkout, or null. */
  readFile(checkout: DemoCheckout, path: string): DemoFile | null;
  /** Writes changes to the working files and commits them, as a scripted agent does. */
  commit(checkout: DemoCheckout, changes: DemoFileChanges, message: string): GitFileDiff[];
  /** Merges the commits of a branch into the target branch, as Direct Merge does. */
  mergeIntoTarget(checkout: DemoCheckout): void;
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
  const target = new Map<string, DemoFile>(input.files);
  const checkouts = new Map<string, DemoCheckout>();
  let targetRevision = commitId(`${input.repoPath}:${input.targetBranch}`);
  checkouts.set(input.repoPath, {
    workingDirectory: input.repoPath,
    branch: input.targetBranch,
    revision: targetRevision,
    committed: new Map(),
    uncommitted: new Map(),
    commits: 0,
  });
  let treeRevision = 0;

  const headFile = (checkout: DemoCheckout, path: string): DemoFile | null => {
    if (checkout.committed.has(path)) return checkout.committed.get(path) ?? null;
    return target.get(path) ?? null;
  };
  const readFile = (checkout: DemoCheckout, path: string): DemoFile | null => {
    if (checkout.uncommitted.has(path)) return checkout.uncommitted.get(path) ?? null;
    return headFile(checkout, path);
  };
  const paths = (checkout: DemoCheckout): string[] => {
    const all = new Set([
      ...target.keys(),
      ...checkout.committed.keys(),
      ...checkout.uncommitted.keys(),
    ]);
    return [...all].filter((path) => readFile(checkout, path) !== null).sort();
  };
  const branchDiffs = (checkout: DemoCheckout): GitFileDiff[] =>
    [...checkout.committed.keys()]
      .sort()
      .filter((path) => !sameFile(target.get(path), checkout.committed.get(path)))
      .map((path) => fileDiff(path, target.get(path), checkout.committed.get(path)));
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
    addWorktree({ workingDirectory, branch, from }) {
      if (checkouts.has(workingDirectory))
        throw new Error("A worktree already uses this folder. Enter another name.");
      const created: DemoCheckout = {
        workingDirectory,
        branch,
        revision: from?.revision ?? targetRevision,
        committed: new Map(from?.committed),
        uncommitted: new Map(),
        commits: from?.commits ?? 0,
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
      for (const [path, file] of changes) {
        checkout.uncommitted.delete(path);
        checkout.committed.set(path, file);
      }
      checkout.commits += 1;
      checkout.revision = commitId(`${checkout.revision}:${message}`);
      treeRevision += 1;
      return diffs;
    },
    mergeIntoTarget(checkout) {
      for (const [path, file] of checkout.committed) {
        if (file) target.set(path, file);
        else target.delete(path);
      }
      checkout.committed.clear();
      checkout.commits = 0;
      targetRevision = commitId(`${targetRevision}:${checkout.branch}`);
      const root = checkouts.get(input.repoPath);
      if (root) root.revision = targetRevision;
      treeRevision += 1;
    },
    branchDiffs,
    localChanges(checkout, observedAtMs) {
      const all = [...checkout.uncommitted.keys()]
        .sort()
        .filter((path) => !sameFile(headFile(checkout, path), checkout.uncommitted.get(path)));
      const diffs = all.map((path) =>
        fileDiff(path, headFile(checkout, path), checkout.uncommitted.get(path)),
      );
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
        upstreamAheadBehind:
          checkout.workingDirectory === input.repoPath
            ? { outcome: "tracking", ahead: 0, behind: 0 }
            : { outcome: "untracked", ahead: checkout.commits },
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
      const diffs = branchDiffs(checkout);
      return {
        currentBranch: currentBranch(checkout),
        fileStatuses: uncommittedDiffs(checkout).map((diff) => ({
          path: diff.file,
          status: statusLetter(diff),
          staged: false,
        })),
        fileDiffs: diffs,
        targetAheadBehind: { ahead: checkout.commits, behind: 0 },
        upstreamAheadBehind:
          checkout.workingDirectory === input.repoPath
            ? { outcome: "tracking", ahead: 0, behind: 0 }
            : { outcome: "untracked", ahead: checkout.commits },
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
      const branch = new Map(branchDiffs(checkout).map((diff) => [diff.file, diff]));
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
