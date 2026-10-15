import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitChangeSelectionRequest, GitLocalChanges } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createDefaultGitRunner } from "../../infrastructure/git/git-command-runner";
import { STALE_SELECTION_MESSAGE } from "../../infrastructure/git/git-local-changes";
import { createGitService } from "./git-service";

// These tests start real Git processes, because index and patch behavior belongs to Git.
// Real Git processes start slowly on Windows runners, so each test gets more time.
const GIT_TEST_TIMEOUT_MS = 30_000;
const service = createGitService(
  createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") }),
);

let repo = "";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const write = (file: string, content: string) => writeFile(path.join(repo, file), content);
const read = (file: string) => readFile(path.join(repo, file), "utf8");
const lines = (count: number, replace: Record<number, string> = {}) =>
  `${Array.from({ length: count }, (_, index) => replace[index + 1] ?? `line ${index + 1}`).join("\n")}\n`;

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

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "git-local-changes-"));
  git("init", "--initial-branch=main");
  git("config", "user.name", "Local Changes Test");
  git("config", "user.email", "local@example.invalid");
  git("config", "commit.gpgsign", "false");
  // Windows runners convert line endings by default, and these tests compare exact bytes.
  git("config", "core.autocrlf", "false");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const commitBase = async () => {
  await write("app.txt", lines(20));
  await write("other.txt", "other\n");
  git("add", ".");
  git("commit", "-m", "base");
};

describe("local changes", () => {
  test(
    "separates staged and unstaged content of the same file",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "staged two" }));
      git("add", "app.txt");
      await write("app.txt", lines(20, { 2: "staged two", 18: "unstaged eighteen" }));
      await write("new.txt", "untracked\n");

      const changes = await localChanges();

      expect(changes.staged.fileStatuses).toEqual([
        { path: "app.txt", status: "modified", staged: true },
      ]);
      expect(changes.unstaged.fileStatuses).toEqual([
        { path: "app.txt", status: "modified", staged: false },
        { path: "new.txt", status: "untracked", staged: false },
      ]);
      const stagedApp = changes.staged.fileDiffs.find((diff) => diff.file === "app.txt");
      const unstagedApp = changes.unstaged.fileDiffs.find((diff) => diff.file === "app.txt");
      expect(stagedApp?.diff).toContain("+staged two");
      expect(stagedApp?.diff).not.toContain("unstaged eighteen");
      expect(unstagedApp?.diff).toContain("+unstaged eighteen");
      expect(unstagedApp?.diff).not.toContain("+staged two");
      expect(changes.unstaged.fileDiffs.map((diff) => diff.file)).toEqual(["app.txt", "new.txt"]);
      expect(changes.staged.snapshot.hashVersion).toBe(2);
      expect(changes.snapshot.diffScope).toBe("uncommitted");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "returns the changes after a write, and their snapshots check the next change",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "changed app" }));
      await write("other.txt", "changed other\n");

      const staged = await change(await localChanges(), {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "app.txt" },
      });
      const read = await localChanges();
      const withoutTime = (changes: GitLocalChanges) => ({
        ...changes,
        snapshot: { ...changes.snapshot, observedAtMs: 0 },
      });
      expect(staged.affectedPaths).toEqual(["app.txt"]);
      expect(withoutTime(staged.localChanges)).toEqual(withoutTime(read));
      expect(staged.localChanges.staged.fileStatuses.map((status) => status.path)).toEqual([
        "app.txt",
      ]);

      // The returned snapshots match Git, so the next change needs no read of its own.
      await change(staged.localChanges, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "all" },
      });
      expect(git("diff", "--name-only")).toBe("");
      expect(git("diff", "--cached", "--name-only")).toBe("app.txt\nother.txt\n");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "stages and unstages one chunk and keeps the other chunk",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "first chunk", 18: "second chunk" }));
      let changes = await localChanges();

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 1 },
      });
      expect(git("diff", "--cached")).toContain("+second chunk");
      expect(git("diff", "--cached")).not.toContain("+first chunk");
      expect(git("diff")).toContain("+first chunk");

      changes = await localChanges();
      await change(changes, {
        action: "unstage",
        group: "staged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
      });
      expect(git("diff", "--cached")).toBe("");
      expect(await read("app.txt")).toBe(lines(20, { 2: "first chunk", 18: "second chunk" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Windows has no executable bit, so Git sees no file mode change there.
  test.skipIf(process.platform === "win32")(
    "chunk actions change text only, and file actions change the file mode",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "first chunk", 18: "second chunk" }));
      await chmod(path.join(repo, "app.txt"), 0o755);
      const indexMode = () => git("ls-files", "--stage", "--", "app.txt").split(" ")[0];
      let changes = await localChanges();

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 1 },
      });
      expect(git("diff", "--cached")).toContain("+second chunk");
      expect(git("diff", "--cached")).not.toContain("+first chunk");
      expect(indexMode()).toBe("100644");
      expect(git("diff", "--summary")).toContain("mode change 100644 => 100755 app.txt");

      changes = await localChanges();
      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
      });
      expect(await read("app.txt")).toBe(lines(20, { 18: "second chunk" }));
      expect((await stat(path.join(repo, "app.txt"))).mode & 0o777).toBe(0o755);

      changes = await localChanges();
      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "app.txt" },
      });
      expect(indexMode()).toBe("100755");

      changes = await localChanges();
      await change(changes, {
        action: "unstage",
        group: "staged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
      });
      expect(git("diff", "--cached")).not.toContain("second chunk");
      expect(indexMode()).toBe("100755");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "shows and changes the raw chunks when a text conversion driver hides some",
    async () => {
      await commitBase();
      // This driver hides the first line, so a converted diff would show only the second chunk.
      await write(".gitattributes", "app.txt diff=hidefirst\n");
      git("config", "diff.hidefirst.textconv", "sed -e 1d");
      git("add", ".gitattributes");
      git("commit", "-m", "attributes");
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
      await commitBase();
      await write("app.txt", lines(20, { 2: "reviewed edit" }));
      const changes = await localChanges();
      const live = createDefaultGitRunner(() => process.env, { command: "git" });
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
    "refuses to discard a submodule change in both groups and keeps its checkout",
    async () => {
      await commitBase();
      const sub = path.join(repo, "sub");
      await mkdir(sub);
      const subGit = (...args: string[]) =>
        execFileSync("git", args, {
          cwd: sub,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      subGit("init", "--initial-branch=main");
      subGit("config", "user.name", "Submodule Test");
      subGit("config", "user.email", "submodule@example.invalid");
      subGit("config", "commit.gpgsign", "false");
      subGit("commit", "--allow-empty", "-m", "one");
      // A repository inside the working tree becomes a submodule entry with mode 160000.
      git("add", "sub");
      git("commit", "-m", "add submodule");
      subGit("commit", "--allow-empty", "-m", "two");
      const checkout = subGit("rev-parse", "HEAD");
      let changes = await localChanges();
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
      expect(
        await failure(
          change(changes, {
            action: "discard",
            group: "unstaged",
            selection: { kind: "hunk", filePath: "sub", hunkIndex: 0 },
          }),
        ),
      ).toContain("Submodule changes have no text chunks.");

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "sub" },
      });
      changes = await localChanges();
      expect(changes.staged.fileDiffs.find((diff) => diff.file === "sub")?.type).toBe("submodule");
      expect(
        await failure(
          change(changes, {
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
    "refuses to stage or discard edits that stay inside a submodule, also in Stage all",
    async () => {
      await commitBase();
      const sub = path.join(repo, "sub");
      await mkdir(sub);
      const subGit = (...args: string[]) =>
        execFileSync("git", args, {
          cwd: sub,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      subGit("init", "--initial-branch=main");
      subGit("config", "user.name", "Submodule Test");
      subGit("config", "user.email", "submodule@example.invalid");
      subGit("config", "commit.gpgsign", "false");
      subGit("config", "core.autocrlf", "false");
      await writeFile(path.join(sub, "inside.txt"), "one\n");
      subGit("add", "inside.txt");
      subGit("commit", "-m", "one");
      git("add", "sub");
      git("commit", "-m", "add submodule");
      // The submodule stays on its recorded commit, so Git shows only a `-dirty` line.
      await writeFile(path.join(sub, "inside.txt"), "two\n");
      await write("other.txt", "changed other\n");
      const changes = await localChanges();
      const diff = changes.unstaged.fileDiffs.find((entry) => entry.file === "sub");
      expect(diff?.type).toBe("submodule");
      expect(diff?.diff).toContain("-dirty");

      expect(
        await failure(
          change(changes, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "file", filePath: "sub" },
          }),
        ),
      ).toContain("sub has edits only inside the submodule. Commit them in the submodule");
      expect(
        await failure(
          change(changes, {
            action: "discard",
            group: "unstaged",
            selection: { kind: "file", filePath: "sub" },
          }),
        ),
      ).toContain("sub has edits inside the submodule. Discard them inside the submodule");
      expect(
        await failure(
          change(changes, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "hunk", filePath: "sub", hunkIndex: 0 },
          }),
        ),
      ).toContain("Submodule changes have no text chunks.");
      // Stage all stops first, so it does not stage only part of the group.
      expect(
        await failure(
          change(changes, { action: "stage", group: "unstaged", selection: { kind: "all" } }),
        ),
      ).toContain("sub has edits only inside the submodule. Commit them in the submodule");
      expect(await readFile(path.join(sub, "inside.txt"), "utf8")).toBe("two\n");
      expect(git("status", "--porcelain=v1", "-z")).toBe(" M other.txt\0 M sub\0");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "stages a whole file and unstages it without losing working edits",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 5: "edited" }));
      await write("new.txt", "untracked\n");
      let changes = await localChanges();

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "new.txt" },
      });
      expect(git("status", "--porcelain=v1")).toContain("A  new.txt");

      changes = await localChanges();
      await change(changes, { action: "stage", group: "unstaged", selection: { kind: "all" } });
      changes = await localChanges();
      expect(changes.unstaged.fileStatuses).toEqual([]);
      expect(changes.staged.fileStatuses.map((status) => status.path)).toEqual([
        "app.txt",
        "new.txt",
      ]);

      await change(changes, { action: "unstage", group: "staged", selection: { kind: "all" } });
      expect(git("status", "--porcelain=v1")).toBe(" M app.txt\n?? new.txt\n");
      expect(await read("app.txt")).toBe(lines(20, { 5: "edited" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "discards an unstaged chunk and keeps the staged content",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "staged" }));
      git("add", "app.txt");
      await write("app.txt", lines(20, { 2: "staged", 18: "drop me" }));
      const changes = await localChanges();

      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 0 },
      });

      expect(await read("app.txt")).toBe(lines(20, { 2: "staged" }));
      expect(git("diff", "--cached")).toContain("+staged");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "lists and changes files whose names Git quotes or that hold spaces",
    async () => {
      await commitBase();
      const accented = "\u00e9.txt";
      await write(accented, "old\n");
      await write("two words.txt", lines(20));
      git("add", ".");
      git("commit", "-m", "names");
      await write(accented, "new\n");
      await write("two words.txt", lines(20, { 2: "first", 18: "second" }));
      let changes = await localChanges();

      // Each file shows once, with its real name, its counts, and its diff.
      expect(
        changes.unstaged.fileDiffs.map((diff) => [diff.file, diff.additions, diff.deletions]),
      ).toEqual([
        [accented, 1, 1],
        ["two words.txt", 2, 2],
      ]);
      expect(changes.unstaged.fileDiffs.every((diff) => diff.diff.includes("@@"))).toBe(true);

      changes = (
        await change(changes, {
          action: "stage",
          group: "unstaged",
          selection: { kind: "file", filePath: accented },
        })
      ).localChanges;
      changes = (
        await change(changes, {
          action: "stage",
          group: "unstaged",
          selection: { kind: "hunk", filePath: "two words.txt", hunkIndex: 1 },
        })
      ).localChanges;
      expect(git("status", "--porcelain=v1", "-z")).toBe(`MM two words.txt\0M  ${accented}\0`);

      changes = (
        await change(changes, {
          action: "unstage",
          group: "staged",
          selection: { kind: "file", filePath: accented },
        })
      ).localChanges;
      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "file", filePath: accented },
      });
      expect(await read(accented)).toBe("old\n");
      expect(git("status", "--porcelain=v1", "-z")).toBe("MM two words.txt\0");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "keeps a staged rename together when the status rename setting is off",
    async () => {
      // Without forced detection, the status read lists the rename as an added and a deleted file.
      git("config", "status.renames", "false");
      await commitBase();
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
    await commitBase();
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
    "discards intent-to-add files and restores the source of an intent-to-add rename",
    async () => {
      await intentToAddRename();
      await write("intent.txt", "intent\n");
      git("add", "-N", "intent.txt");
      let changes = await localChanges();

      changes = (
        await change(changes, {
          action: "discard",
          group: "unstaged",
          selection: { kind: "file", filePath: "intent.txt" },
        })
      ).localChanges;
      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "file", filePath: "moved.txt" },
      });

      expect(await read("app.txt")).toBe(lines(20));
      expect(git("status", "--porcelain=v1", "-z", "--untracked-files=all")).toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "changes only the copy of a staged copy and keeps the staged edit of its source",
    async () => {
      // With this setting, Git reports a staged copy beside a staged edit of its source.
      git("config", "diff.renames", "copies");
      await write("source.txt", lines(20));
      git("add", "source.txt");
      git("commit", "-m", "source");
      await write("copy.txt", lines(20, { 18: "copy edit" }));
      await write("source.txt", lines(20, { 2: "source edit" }));
      git("add", "-A");
      let changes = await localChanges();
      expect(changes.staged.fileStatuses).toEqual([
        { path: "copy.txt", status: "copied", staged: true },
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
      expect(git("status", "--porcelain=v1", "-z")).toBe("M  source.txt\0?? copy.txt\0");

      git("add", "copy.txt");
      changes = await localChanges();
      await change(changes, {
        action: "discard",
        group: "staged",
        selection: { kind: "file", filePath: "copy.txt" },
      });
      expect(git("status", "--porcelain=v1", "-z")).toBe("M  source.txt\0");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "deletes a discarded untracked file",
    async () => {
      await commitBase();
      await write("new file[1].txt", "untracked\n");
      const changes = await localChanges();

      await change(changes, {
        action: "discard",
        group: "unstaged",
        selection: { kind: "file", filePath: "new file[1].txt" },
      });

      expect(git("status", "--porcelain=v1")).toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "discards a staged edit and keeps an unrelated unstaged edit",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "staged" }));
      git("add", "app.txt");
      await write("app.txt", lines(20, { 2: "staged", 18: "keep me" }));
      const changes = await localChanges();

      await change(changes, {
        action: "discard",
        group: "staged",
        selection: { kind: "file", filePath: "app.txt" },
      });

      expect(git("diff", "--cached")).toBe("");
      expect(await read("app.txt")).toBe(lines(20, { 18: "keep me" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "rejects a staged discard that overlaps unstaged edits without changing content",
    async () => {
      await commitBase();
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
    "rejects a stale selection and a moved checkout",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "first" }));
      const changes = await localChanges();
      await write("app.txt", lines(20, { 2: "second" }));

      expect(
        await failure(
          change(changes, {
            action: "stage",
            group: "unstaged",
            selection: { kind: "file", filePath: "app.txt" },
          }),
        ),
      ).toContain("out of date");

      const fresh = await localChanges();
      git("commit", "--allow-empty", "-m", "moved");
      expect(
        await failure(
          change(fresh, {
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
    "keeps carriage returns when it stages one chunk of a CRLF file",
    async () => {
      const crlf = (replace: Record<number, string> = {}) =>
        `${Array.from({ length: 20 }, (_, index) => replace[index + 1] ?? `line ${index + 1}`).join("\r\n")}\r\n`;
      await write("crlf.txt", crlf());
      git("add", "crlf.txt");
      git("commit", "-m", "crlf");
      await write("crlf.txt", crlf({ 2: "first", 18: "second" }));
      const changes = await localChanges();

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "hunk", filePath: "crlf.txt", hunkIndex: 1 },
      });

      expect(git("show", ":crlf.txt")).toBe(crlf({ 18: "second" }));
      expect(await read("crlf.txt")).toBe(crlf({ 2: "first", 18: "second" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "changes chunks of a UTF-8 file that holds the replacement character",
    async () => {
      // U+FFFD is valid text. Only bytes that are not UTF-8 stop a chunk write.
      await commitBase();
      await write("app.txt", lines(20, { 2: "first \uFFFD", 18: "second \uFFFD" }));
      let changes = await localChanges();

      changes = (
        await change(changes, {
          action: "stage",
          group: "unstaged",
          selection: { kind: "hunk", filePath: "app.txt", hunkIndex: 1 },
        })
      ).localChanges;
      expect(git("show", ":app.txt")).toBe(lines(20, { 18: "second \uFFFD" }));

      await change(changes, {
        action: "discard",
        group: "staged",
        selection: { kind: "file", filePath: "app.txt" },
      });
      expect(git("diff", "--cached", "--name-only")).toBe("");
      expect(await read("app.txt")).toBe(lines(20, { 2: "first \uFFFD" }));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "refuses chunk and staged discard writes that would change non-UTF-8 bytes",
    async () => {
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
      expect(execFileSync("git", ["show", ":latin.txt"], { cwd: repo })).toEqual(latin1("\xe8"));
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "explains why a new file has no chunk actions",
    async () => {
      await commitBase();
      await write("new.txt", "a\nb\n");
      git("add", "new.txt");
      const changes = await localChanges();

      expect(
        await failure(
          change(changes, {
            action: "unstage",
            group: "staged",
            selection: { kind: "hunk", filePath: "new.txt", hunkIndex: 0 },
          }),
        ),
      ).toBe("New files change only as a whole file. Use the file action.");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "stages and commits the first content of a branch without commits",
    async () => {
      await write("first.txt", "first\n");
      await write("later.txt", "later\n");
      const changes = await localChanges();
      expect(changes.currentBranch).toEqual({ name: "main", detached: false });

      await change(changes, {
        action: "stage",
        group: "unstaged",
        selection: { kind: "file", filePath: "first.txt" },
      });
      const staged = await localChanges();
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
    "refuses a staged commit when other content was staged after review",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "reviewed" }));
      git("add", "app.txt");
      const reviewed = await localChanges();
      await write("other.txt", "staged later\n");
      git("add", "other.txt");

      const message = await failure(
        Effect.runPromise(
          service.commitStaged({
            repoPath: repo,
            message: "reviewed only",
            expectedBranch: reviewed.currentBranch,
            stagedSnapshot: reviewed.staged.snapshot,
          }),
        ),
      );

      expect(message).toContain("out of date");
      expect(git("log", "--format=%s")).toBe("base\n");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  test(
    "commits staged content only and reports no staged changes",
    async () => {
      await commitBase();
      await write("app.txt", lines(20, { 2: "staged" }));
      git("add", "app.txt");
      await write("other.txt", "unstaged\n");
      const changes = await localChanges();
      const commit = () =>
        Effect.runPromise(
          service.commitStaged({
            repoPath: repo,
            message: "staged only",
            expectedBranch: changes.currentBranch,
            stagedSnapshot: changes.staged.snapshot,
          }),
        );

      expect((await commit()).outcome).toBe("committed");
      expect(git("show", "--name-only", "--format=", "HEAD")).toBe("app.txt\n");
      expect(git("status", "--porcelain=v1")).toBe(" M other.txt\n");
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
      await commitBase();
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
