import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitChangeSelectionRequest, GitLocalChanges } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createDefaultGitRunner } from "../../infrastructure/git/git-command-runner";
import { STALE_SELECTION_MESSAGE } from "../../infrastructure/git/git-local-changes";
import { gitFixtureCommand, gitFixtureEnv } from "../../test-support/git-repository-fixture";
import { createGitService } from "./git-service";

// These tests start real Git processes, because index and patch behavior belongs to Git.
// Real Git processes start slowly on Windows runners, so each test gets more time.
const GIT_TEST_TIMEOUT_MS = 30_000;
const service = createGitService(
  createGitCliAdapter({
    resolveCommand: () => Effect.succeed(gitFixtureCommand),
    readEnv: () => gitFixtureEnv,
  }),
);

let repo = "";
const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync(gitFixtureCommand, args, {
    cwd,
    encoding: "utf8",
    env: gitFixtureEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
const git = (...args: string[]) => gitIn(repo, ...args);
const write = (file: string, content: string) => writeFile(path.join(repo, file), content);
const read = (file: string) => readFile(path.join(repo, file), "utf8");
const lines = (count: number, replace: Record<number, string> = {}) =>
  `${Array.from({ length: count }, (_, index) => replace[index + 1] ?? `line ${index + 1}`).join("\n")}\n`;
const accentedName = "\u00e9.txt";
const submoduleCommitText = `Subproject commit ${"0332".padEnd(40, "0")}`;

const localChanges = () => Effect.runPromise(service.getLocalChanges({ repoPath: repo }));

const change = async (
  changes: GitLocalChanges,
  request: Pick<GitChangeSelectionRequest, "action" | "group" | "selection">,
) =>
  Effect.runPromise(
    service.changeSelection({
      repoPath: repo,
      expectedBranch: changes.currentBranch,
      snapshots: { unstaged: changes.unstaged.snapshot, staged: changes.staged.snapshot },
      ...request,
    }),
  );

const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the Git action to fail.");
};

let templateRoot = "";
let emptyTemplate = "";
let committedTemplate = "";
// Build the two initial states once. Each test writes to its own copy.
beforeAll(async () => {
  templateRoot = await mkdtemp(path.join(tmpdir(), "git-local-changes-template-"));
  emptyTemplate = path.join(templateRoot, "empty");
  committedTemplate = path.join(templateRoot, "committed");
  await mkdir(emptyTemplate);
  for (const args of [
    ["init", "--initial-branch=main", "--template="],
    ["config", "user.name", "Local Changes Test"],
    ["config", "user.email", "local@example.invalid"],
    ["config", "commit.gpgsign", "false"],
    // Windows runners convert line endings by default, and these tests compare exact bytes.
    ["config", "core.autocrlf", "false"],
  ]) {
    gitIn(emptyTemplate, ...args);
  }
  await cp(emptyTemplate, committedTemplate, { recursive: true });
  await writeFile(path.join(committedTemplate, "app.txt"), lines(20));
  await writeFile(path.join(committedTemplate, "other.txt"), "other\n");
  await writeFile(path.join(committedTemplate, accentedName), "old\n");
  await writeFile(path.join(committedTemplate, "two words.txt"), lines(20));
  await writeFile(path.join(committedTemplate, "note.txt"), `${submoduleCommitText}\n`);
  gitIn(committedTemplate, "add", ".");
  gitIn(committedTemplate, "commit", "-m", "base");
}, GIT_TEST_TIMEOUT_MS);

afterAll(async () => {
  await rm(templateRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  repo = path.join(await mkdtemp(path.join(tmpdir(), "git-local-changes-")), "repo");
});

afterEach(async () => {
  await rm(path.dirname(repo), { recursive: true, force: true });
});

const copyBaseRepository = () => cp(committedTemplate, repo, { recursive: true });
const copyEmptyRepository = () => cp(emptyTemplate, repo, { recursive: true });

const initSubmodule = async () => {
  const sub = path.join(repo, "sub");
  await cp(emptyTemplate, sub, { recursive: true });
  return { sub, subGit: (...args: string[]) => gitIn(sub, ...args) };
};

describe("local changes", () => {
  test(
    "changes selected chunks and preserves other edits and the file mode",
    async () => {
      await copyBaseRepository();
      const workingText = lines(20, { 2: "first chunk", 10: "second chunk", 18: "third chunk" });
      const stagedText = lines(20, { 10: "second chunk" });
      const remainingText = lines(20, { 10: "second chunk", 18: "third chunk" });
      const filePath = path.join(repo, "app.txt");
      const hasExecutableBit = process.platform !== "win32";
      const expectedIndexMode = hasExecutableBit ? "100755" : "100644";
      await write("app.txt", workingText);
      await write("new.txt", "untracked\n");
      if (hasExecutableBit) await chmod(filePath, 0o755);
      const indexMode = () => git("ls-files", "--stage", "--", "app.txt").split(" ")[0];
      const stagedChunk = await change(await localChanges(), {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 1 },
      });
      expect(git("show", ":app.txt")).toBe(stagedText);
      expect(await read("app.txt")).toBe(workingText);
      expect(indexMode()).toBe("100644");

      const { staged, unstaged, snapshot } = stagedChunk.localChanges;
      expect(staged.fileStatuses).toEqual([{ path: "app.txt", status: "modified", staged: true }]);
      expect(unstaged.fileStatuses).toEqual([
        { path: "app.txt", status: "modified", staged: false },
        { path: "new.txt", status: "untracked", staged: false },
      ]);
      expect(unstaged.fileDiffs.map((diff) => diff.file)).toEqual(["app.txt", "new.txt"]);
      expect(staged.fileDiffs[0]?.diff).toContain("+second chunk");
      expect(staged.fileDiffs[0]?.diff).not.toContain("+third chunk");
      expect(unstaged.fileDiffs[0]?.diff).toContain("+third chunk");
      expect(unstaged.fileDiffs[0]?.diff).not.toContain("+second chunk");
      expect(staged.snapshot.hashVersion).toBe(2);
      expect(snapshot.diffScope).toBe("uncommitted");

      const discardedChunk = await change(stagedChunk.localChanges, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
      });
      expect(await read("app.txt")).toBe(remainingText);
      expect(git("show", ":app.txt")).toBe(stagedText);
      if (hasExecutableBit) expect((await stat(filePath)).mode & 0o777).toBe(0o755);

      const stagedFile = await change(discardedChunk.localChanges, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "app.txt" },
      });
      expect(indexMode()).toBe(expectedIndexMode);

      await change(stagedFile.localChanges, {
        action: "unstage",
        group: "staged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
      });
      expect(git("show", ":app.txt")).toBe(lines(20, { 18: "third chunk" }));
      expect(await read("app.txt")).toBe(remainingText);
      expect(indexMode()).toBe(expectedIndexMode);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "shows and changes the raw chunks when a text conversion driver hides some",
    async () => {
      await copyBaseRepository();
      // This driver hides the first line, so a converted diff would show only the second chunk.
      const info = path.join(repo, ".git", "info");
      await mkdir(info, { recursive: true });
      await writeFile(path.join(info, "attributes"), "app.txt diff=hidefirst\n");
      git("config", "diff.hidefirst.textconv", "sed -e 1d");
      await write("app.txt", lines(20, { 1: "first chunk", 20: "second chunk" }));
      const changes = await localChanges();

      const diff = changes.unstaged.fileDiffs.find((entry) => entry.file === "app.txt")?.diff ?? "";
      expect(diff).toContain("+first chunk");
      expect(diff).toContain("+second chunk");

      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 1 },
      });
      expect(await read("app.txt")).toBe(lines(20, { 1: "first chunk" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "refuses a chunk whose text changed after review on the same lines",
    async () => {
      await copyBaseRepository();
      await write("app.txt", lines(20, { 2: "reviewed edit" }));
      const changes = await localChanges();
      const live = createDefaultGitRunner(() => gitFixtureEnv, { command: gitFixtureCommand });
      // Another writer replaces the edit after the snapshot check and before the chunk read.
      const racing = createGitService(
        createGitCliAdapter({
          runner: (directory, args, options) =>
            args[0] === "diff" && args.at(-1) === ":(top,literal)app.txt"
              ? Effect.promise(() => write("app.txt", lines(20, { 2: "replacement edit" }))).pipe(
                  Effect.flatMap(() => live(directory, args, options)),
                )
              : live(directory, args, options),
        }),
      );

      const message = await failure(
        Effect.runPromise(
          racing.changeSelection({
            repoPath: repo,
            expectedBranch: changes.currentBranch,
            snapshots: { unstaged: changes.unstaged.snapshot, staged: changes.staged.snapshot },
            action: "discard",
            group: "unstaged",
            selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
          }),
        ),
      );

      expect(message).toBe(STALE_SELECTION_MESSAGE);
      expect(await read("app.txt")).toBe(lines(20, { 2: "replacement edit" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "protects submodule worktree edits and keeps its checkout when the recorded commit changes",
    async () => {
      await copyBaseRepository();
      const { sub, subGit } = await initSubmodule();
      await writeFile(path.join(sub, "inside.txt"), "one\n");
      subGit("add", "inside.txt");
      subGit("commit", "-m", "one");
      // A repository inside the working tree becomes a submodule entry with mode 160000.
      git("add", "sub");
      git("commit", "-m", "add submodule");

      await writeFile(path.join(sub, "inside.txt"), "two\n");
      await write("other.txt", "changed other\n");
      const dirty = await localChanges();
      const diff = dirty.unstaged.fileDiffs.find((entry) => entry.file === "sub");
      expect(diff?.type).toBe("submodule");
      expect(diff?.diff).toContain("-dirty");
      expect(
        await failure(
          change(dirty, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "file", filePath: "sub" },
          }),
        ),
      ).toContain("sub has edits only inside the submodule. Commit them in the submodule");
      expect(
        await failure(
          change(dirty, {
            action: "discard",
            group: "unstaged",
            selection: { kind: "file", filePath: "sub" },
          }),
        ),
      ).toContain("sub has edits inside the submodule. Discard them inside the submodule");
      expect(
        await failure(
          change(dirty, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "hunk", filePath: "sub", hunkIndex: 0 },
          }),
        ),
      ).toContain("Submodule changes have no text chunks.");
      expect(
        await failure(
          change(dirty, { action: "stage", group: "unstaged", selection: { kind: "all" } }),
        ),
      ).toContain("sub has edits only inside the submodule. Commit them in the submodule");
      expect(await readFile(path.join(sub, "inside.txt"), "utf8")).toBe("two\n");
      expect(git("status", "--porcelain=v1", "-z")).toBe(" M other.txt\0 M sub\0");

      subGit("commit", "-am", "two");
      const checkout = subGit("rev-parse", "HEAD");
      const changes = await localChanges();
      expect(changes.unstaged.fileDiffs.find((diff) => diff.file === "sub")?.type).toBe(
        "submodule",
      );

      const unstagedFile = await failure(
        change(changes, {
          action: "discard",
          group: "unstaged",
          selection: { kind: "file", filePath: "sub" },
        }),
      );
      expect(unstagedFile).toContain("sub is a submodule. Discard cannot change the commit");

      const { localChanges: staged } = await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "sub" },
      });
      expect(staged.staged.fileDiffs.find((diff) => diff.file === "sub")?.type).toBe("submodule");
      expect(
        await failure(
          change(staged, {
            action: "discard",
            group: "staged",
            selection: { kind: "file", filePath: "sub" },
          }),
        ),
      ).toContain("sub is a submodule. Discard cannot change the commit");
      expect(git("diff", "--cached", "--name-only")).toBe("sub\n");
      expect(subGit("rev-parse", "HEAD")).toBe(checkout);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "keeps chunk actions for a file whose text names a submodule commit",
    async () => {
      await copyBaseRepository();
      const edited = `${submoduleCommitText}-dirty\n`;
      await write("note.txt", edited);
      const changes = await localChanges();
      expect(changes.unstaged.fileDiffs.find((diff) => diff.file === "note.txt")?.type).toBe(
        "modified",
      );

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "note.txt", hunkIndex: 0 },
      });
      expect(git("show", ":note.txt")).toBe(edited);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "stages and unstages files from returned snapshots without losing working edits",
    async () => {
      await copyBaseRepository();
      await write("app.txt", lines(20, { 5: "edited" }));
      await write("new.txt", "untracked\n");
      const stagedFile = await change(await localChanges(), {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "new.txt" },
      });
      expect(git("status", "--porcelain=v1")).toBe(" M app.txt\nA  new.txt\n");
      expect(stagedFile.affectedPaths).toEqual(["new.txt"]);
      expect(stagedFile.localChanges.staged.fileStatuses).toEqual([
        { path: "new.txt", status: "added", staged: true },
      ]);
      expect(stagedFile.localChanges.staged.fileDiffs[0]?.diff).toContain("+untracked");
      expect(stagedFile.localChanges.unstaged.fileStatuses).toEqual([
        { path: "app.txt", status: "modified", staged: false },
      ]);
      expect(stagedFile.localChanges.unstaged.fileDiffs[0]?.diff).toContain("+edited");

      expect(
        await failure(
          change(stagedFile.localChanges, {
            action: "unstage",
            group: "staged",
            selection: { kind: "hunk", filePath: "new.txt", hunkIndex: 0 },
          }),
        ),
      ).toBe("New files change only as a whole file. Use the file action.");

      const { localChanges: changes } = await change(stagedFile.localChanges, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "all" },
      });
      expect(changes.unstaged.fileStatuses).toEqual([]);
      expect(changes.staged.fileStatuses.map((status) => status.path)).toEqual([
        "app.txt",
        "new.txt",
      ]);

      await change(changes, { action: "unstage", group: "staged", selection: { kind: "all" } });
      expect(git("status", "--porcelain=v1")).toBe(" M app.txt\n?? new.txt\n");
      expect(await read("app.txt")).toBe(lines(20, { 5: "edited" }));
      expect(await read("new.txt")).toBe("untracked\n");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "lists and changes files whose names Git quotes or that hold spaces",
    async () => {
      await copyBaseRepository();
      await write(accentedName, "new\n");
      await write("two words.txt", lines(20, { 2: "first", 18: "second" }));
      let changes = await localChanges();

      // Each file shows once, with its real name, its counts, and its diff.
      expect(
        changes.unstaged.fileDiffs.map((diff) => [diff.file, diff.additions, diff.deletions]),
      ).toEqual([
        [accentedName, 1, 1],
        ["two words.txt", 2, 2],
      ]);
      expect(changes.unstaged.fileDiffs.every((diff) => diff.diff.includes("@@"))).toBe(true);

      changes = (
        await change(changes, {
          action: "stage",
          group: "unstaged",
          selection: { kind: "file", filePath: accentedName },
        })
      ).localChanges;
      changes = (
        await change(changes, {
          action: "stage",
          group: "unstaged",
          selection: { kind: "hunk", filePath: "two words.txt", hunkIndex: 1 },
        })
      ).localChanges;
      expect(git("status", "--porcelain=v1", "-z")).toBe(`MM two words.txt\0M  ${accentedName}\0`);

      changes = (
        await change(changes, {
          action: "unstage",
          group: "staged",
          selection: { kind: "file", filePath: accentedName },
        })
      ).localChanges;
      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "file", filePath: accentedName },
      });
      expect(await read(accentedName)).toBe("old\n");
      expect(git("status", "--porcelain=v1", "-z")).toBe("MM two words.txt\0");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "keeps a staged rename together when the status rename setting is off",
    async () => {
      await copyBaseRepository();
      // Without forced detection, the status read lists the rename as an added and a deleted file.
      git("config", "status.renames", "false");
      git("mv", "app.txt", "moved.txt");
      await write("moved.txt", lines(20, { 18: "moved edit" }));
      git("add", "moved.txt");
      const changes = await localChanges();
      expect(changes.staged.fileStatuses).toEqual([
        { path: "moved.txt", status: "renamed", staged: true },
      ]);

      const discarded = await change(changes, {
        action: "discard",
        group: "staged",
        selection: { kind: "file", filePath: "moved.txt" },
      });

      expect(discarded.affectedPaths).toEqual(["moved.txt", "app.txt"]);
      expect(await read("app.txt")).toBe(lines(20));
      expect(git("status", "--porcelain=v1", "-z", "--untracked-files=all")).toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  /** A rename that Git reports in the working tree, because its destination is intent-to-add. */
  const intentToAddRename = async () => {
    await copyBaseRepository();
    await rm(path.join(repo, "app.txt"));
    await write("moved.txt", lines(20, { 18: "moved edit" }));
    git("add", "-N", "moved.txt");
  };

  test(
    "stages an intent-to-add rename together with its source",
    async () => {
      await intentToAddRename();
      const changes = await localChanges();
      expect(changes.unstaged.fileStatuses).toEqual([
        { path: "moved.txt", status: "renamed", staged: false },
      ]);

      const staged = await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "moved.txt" },
      });

      expect(staged.affectedPaths).toEqual(["moved.txt", "app.txt"]);
      expect(git("status", "--porcelain=v1", "-z")).toBe("R  moved.txt\0app.txt\0");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "discards untracked and intent-to-add files and restores the source of a rename",
    async () => {
      await intentToAddRename();
      await write("intent.txt", "intent\n");
      await write("new file[1].txt", "untracked\n");
      git("add", "-N", "intent.txt");
      let changes = await localChanges();
      for (const filePath of ["new file[1].txt", "intent.txt", "moved.txt"]) {
        const discarded = await change(changes, {
          action: "discard",
          group: "unstaged",
          selection: { kind: "file", filePath },
        });
        changes = discarded.localChanges;
      }

      expect(await read("app.txt")).toBe(lines(20));
      expect(git("status", "--porcelain=v1", "-z", "--untracked-files=all")).toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "unstages and discards staged copies without changing their staged source",
    async () => {
      await copyEmptyRepository();
      // With this setting, Git reports staged copies beside a staged edit of their source.
      git("config", "diff.renames", "copies");
      await write("source.txt", lines(20));
      git("add", "source.txt");
      git("commit", "-m", "source");
      const copy = lines(20, { 18: "copy edit" });
      await write("copy.txt", copy);
      await write("discard.txt", lines(20, { 19: "discard edit" }));
      await write("source.txt", lines(20, { 2: "source edit" }));
      git("add", "-A");
      const changes = await localChanges();
      expect(changes.staged.fileStatuses).toEqual([
        { path: "copy.txt", status: "copied", staged: true },
        { path: "discard.txt", status: "copied", staged: true },
        { path: "source.txt", status: "modified", staged: true },
      ]);
      // A write reads the copy alone, as a new file, so it has no chunk actions.
      expect(changes.staged.fileDiffs.find((diff) => diff.file === "copy.txt")?.type).toBe("added");

      const unstaged = await change(changes, {
        action: "unstage",
        group: "staged",
        selection: { kind: "file", filePath: "copy.txt" },
      });
      expect(unstaged.affectedPaths).toEqual(["copy.txt"]);
      const discarded = await change(unstaged.localChanges, {
        action: "discard",
        group: "staged",
        selection: { kind: "file", filePath: "discard.txt" },
      });
      expect(discarded.affectedPaths).toEqual(["discard.txt"]);
      expect(await read("copy.txt")).toBe(copy);
      expect(git("status", "--porcelain=v1", "-z")).toBe("M  source.txt\0?? copy.txt\0");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Linux keeps the bytes of a file name. macOS and Windows keep only Unicode names.
  test.skipIf(process.platform !== "linux")(
    "names the step to take for a file whose name is not UTF-8 text",
    async () => {
      await copyBaseRepository();
      await writeFile(Buffer.from(path.join(repo, "bad-\xff.txt"), "latin1"), "bad\n");

      expect(await failure(localChanges())).toContain(
        "whose name is not UTF-8 text. Rename the file to a UTF-8 name, then refresh.",
      );
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "rejects a staged discard that overlaps unstaged edits without changing content",
    async () => {
      await copyBaseRepository();
      await write("app.txt", lines(20, { 2: "staged" }));
      git("add", "app.txt");
      await write("app.txt", lines(20, { 2: "staged then edited" }));
      const changes = await localChanges();

      const message = await failure(
        change(changes, {
          action: "discard",
          group: "staged",
          selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
        }),
      );

      expect(message).toContain("overlaps unstaged edits");
      expect(git("diff", "--cached")).toContain("+staged");
      expect(await read("app.txt")).toBe(lines(20, { 2: "staged then edited" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "rejects a reviewed selection after the checkout moves",
    async () => {
      await copyBaseRepository();
      await write("app.txt", lines(20, { 2: "reviewed" }));
      const changes = await localChanges();
      git("commit", "--allow-empty", "-m", "moved");
      expect(
        await failure(
          change(changes, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "file", filePath: "app.txt" },
          }),
        ),
      ).toContain("branch or its latest commit changed");
      expect(git("diff", "--cached")).toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "stages and discards CRLF text with a valid replacement character",
    async () => {
      await copyEmptyRepository();
      const crlf = (replace: Record<number, string> = {}) =>
        `${Array.from({ length: 20 }, (_, index) => replace[index + 1] ?? `line ${index + 1}`).join("\r\n")}\r\n`;
      await write("crlf.txt", crlf());
      git("add", "crlf.txt");
      git("commit", "-m", "crlf");
      const first = "first \uFFFD";
      const second = "second \uFFFD";
      await write("crlf.txt", crlf({ 2: first, 18: second }));

      const { localChanges: staged } = await change(await localChanges(), {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "crlf.txt", hunkIndex: 1 },
      });
      expect(git("show", ":crlf.txt")).toBe(crlf({ 18: second }));
      expect(await read("crlf.txt")).toBe(crlf({ 2: first, 18: second }));

      await change(staged, {
        action: "discard",
        group: "staged",
        selection: { kind: "file", filePath: "crlf.txt" },
      });
      expect(git("diff", "--cached", "--name-only")).toBe("");
      expect(await read("crlf.txt")).toBe(crlf({ 2: first }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "reads and writes patches whatever diff prefix setting the repository has",
    async () => {
      await copyBaseRepository();
      // Without fixed prefixes, the parser lost the file sections and their content in the snapshot.
      git("config", "diff.noprefix", "true");
      await write("other.txt", "first\n");
      const reviewed = await localChanges();
      expect(reviewed.unstaged.fileDiffs.find((diff) => diff.file === "other.txt")?.diff).toContain(
        "+first",
      );
      await write("other.txt", "later\n");
      expect(
        await failure(
          change(reviewed, {
            action: "discard",
            group: "unstaged",
            selection: { kind: "file", filePath: "other.txt" },
          }),
        ),
      ).toBe(STALE_SELECTION_MESSAGE);
      expect(await read("other.txt")).toBe("later\n");

      // `git apply` reads the `a/` and `b/` prefixes of a chunk patch.
      git("config", "--unset", "diff.noprefix");
      git("config", "diff.mnemonicPrefix", "true");
      await write("app.txt", lines(20, { 2: "first chunk", 18: "second chunk" }));
      await change(await localChanges(), {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 1 },
      });
      expect(git("show", ":app.txt")).toBe(lines(20, { 18: "second chunk" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "refuses chunk and staged discard writes that would change non-UTF-8 bytes",
    async () => {
      await copyEmptyRepository();
      const latin1 = (accent: string) =>
        Buffer.from(
          `${Array.from({ length: 20 }, (_, index) => (index === 1 ? `caf${accent}` : `line ${index + 1}`)).join("\n")}\n`,
          "latin1",
        );
      await writeFile(path.join(repo, "latin.txt"), latin1("\xe9"));
      git("add", "latin.txt");
      git("commit", "-m", "latin");
      await writeFile(path.join(repo, "latin.txt"), latin1("\xe8"));
      let changes = await localChanges();

      expect(
        await failure(
          change(changes, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "hunk", filePath: "latin.txt", hunkIndex: 0 },
          }),
        ),
      ).toContain("not UTF-8 text");
      git("add", "latin.txt");
      changes = await localChanges();
      expect(
        await failure(
          change(changes, {
            action: "discard",
            group: "staged",
            selection: { kind: "file", filePath: "latin.txt" },
          }),
        ),
      ).toContain("Unstage the file");
      expect(await readFile(path.join(repo, "latin.txt"))).toEqual(latin1("\xe8"));
      expect(
        execFileSync(gitFixtureCommand, ["show", ":latin.txt"], { cwd: repo, env: gitFixtureEnv }),
      ).toEqual(latin1("\xe8"));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "stages and commits the first content of a branch without commits",
    async () => {
      await copyEmptyRepository();
      await write("first.txt", "first\n");
      await write("later.txt", "later\n");
      const changes = await localChanges();
      expect(changes.currentBranch).toEqual({ name: "main", detached: false });

      const { localChanges: staged } = await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "first.txt" },
      });
      expect(staged.staged.fileDiffs.map((diff) => diff.file)).toEqual(["first.txt"]);

      const result = await Effect.runPromise(
        service.commitStaged({
          repoPath: repo,
          message: "first commit",
          expectedBranch: staged.currentBranch,
          stagedSnapshot: staged.staged.snapshot,
        }),
      );

      expect(result.outcome).toBe("committed");
      expect(git("ls-files")).toBe("first.txt\n");
      expect(git("status", "--porcelain=v1")).toBe("?? later.txt\n");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "commits only the reviewed staged content after an added file is unstaged",
    async () => {
      await copyBaseRepository();
      await write("app.txt", lines(20, { 2: "reviewed" }));
      git("add", "app.txt");
      const reviewed = await localChanges();
      const commit = () =>
        Effect.runPromise(
          service.commitStaged({
            repoPath: repo,
            message: "reviewed only",
            expectedBranch: reviewed.currentBranch,
            stagedSnapshot: reviewed.staged.snapshot,
          }),
        );
      await write("other.txt", "staged later\n");
      git("add", "other.txt");
      expect(await failure(commit())).toContain("out of date");
      expect(git("log", "--format=%s")).toBe("base\n");

      git("restore", "--staged", "--", "other.txt");
      expect((await commit()).outcome).toBe("committed");
      expect(git("show", "--name-only", "--format=", "HEAD")).toBe("app.txt\n");
      expect(git("status", "--porcelain=v1")).toBe(" M other.txt\n");
      expect(await read("other.txt")).toBe("staged later\n");
      expect(await failure(commit())).toContain("branch or its latest commit changed");

      const after = await localChanges();
      const empty = await Effect.runPromise(
        service.commitStaged({
          repoPath: repo,
          message: "nothing",
          expectedBranch: after.currentBranch,
          stagedSnapshot: after.staged.snapshot,
        }),
      );
      expect(empty.outcome).toBe("no_changes");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "keeps conflicted paths out of both groups and blocks group actions",
    async () => {
      await copyBaseRepository();
      git("checkout", "-b", "other");
      await write("app.txt", lines(20, { 3: "other" }));
      git("commit", "-am", "other");
      git("checkout", "main");
      await write("app.txt", lines(20, { 3: "main" }));
      git("commit", "-am", "main");
      await write("other.txt", "edited\n");
      try {
        git("merge", "other");
      } catch {
        // The merge stops with a conflict.
      }
      const changes = await localChanges();

      expect(changes.conflicted.fileStatuses).toEqual([
        { path: "app.txt", status: "unmerged", staged: false },
      ]);
      expect(changes.conflicted.fileDiffs[0]?.diff).toContain("<<<<<<<");
      expect(changes.unstaged.fileDiffs.map((diff) => diff.file)).toEqual(["other.txt"]);
      expect(changes.staged.fileDiffs).toEqual([]);
      expect(
        await failure(
          change(changes, { action: "stage", group: "unstaged", selection: { kind: "all" } }),
        ),
      ).toContain("Resolve the conflicted files");
      expect(
        await failure(
          Effect.runPromise(
            service.commitAll({
              repoPath: repo,
              message: "would resolve the conflict",
              expectedBranch: changes.currentBranch,
            }),
          ),
        ),
      ).toBe("Resolve the conflicted files before you commit.");
      expect(git("status", "--porcelain=v1")).toContain("UU app.txt");
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
