import { describe, expect, test } from "bun:test";
import { createDemoRepository, fileDiff } from "./demo-repository";

const text = (value: string) => ({ kind: "text" as const, text: value });

describe("demo repository", () => {
  test("prints a unified diff with removed lines before added lines", () => {
    const diff = fileDiff("src/a.ts", text("one\ntwo\nthree\n"), text("one\n2\nthree\n"));
    expect(diff).toMatchObject({ type: "modified", additions: 1, deletions: 1 });
    expect(diff.diff).toContain("@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n");
  });

  test("keeps committed and uncommitted changes apart, and merges a branch into the target", () => {
    const repository = createDemoRepository({
      repoPath: "/repo",
      targetBranch: "main",
      files: new Map([["README.md", text("# Notes\n")]]),
    });
    const checkout = repository.addWorktree({ workingDirectory: "/worktrees/a", branch: "odt/a" });
    repository.commit(checkout, new Map([["src/new.ts", text("export {};\n")]]), "Add new");
    checkout.uncommitted.set("README.md", text("# Notes\n\nDraft\n"));
    // Branch changes show the commits and the working files, as the host diffs the working tree.
    expect(repository.branchDiffs(checkout).map((diff) => [diff.file, diff.type])).toEqual([
      ["README.md", "modified"],
      ["src/new.ts", "added"],
    ]);
    expect(
      repository.localChanges(checkout, 0).unstaged.fileDiffs.map((diff) => diff.file),
    ).toEqual(["README.md"]);
    expect(
      repository.worktreeStatus(checkout, "refs/remotes/origin/main", 0).targetAheadBehind,
    ).toEqual({
      ahead: 1,
      behind: 0,
    });
    repository.mergeInto(checkout, "refs/heads/main");
    const root = repository.checkout("/repo");
    expect(repository.readFile(root, "src/new.ts")).toEqual(text("export {};\n"));
    // The squash commit is new on the target, so the branch still shows its own commits.
    expect(repository.branchDiffs(checkout).map((diff) => diff.file)).toEqual([
      "README.md",
      "src/new.ts",
    ]);
  });

  test("compares a branch with the merge base of the selected target branch", () => {
    const repository = createDemoRepository({
      repoPath: "/repo",
      targetBranch: "main",
      files: new Map([
        ["README.md", text("# Notes\n")],
        ["src/old.ts", text("export const old = 1;\n")],
      ]),
    });
    const source = repository.addWorktree({ workingDirectory: "/worktrees/a", branch: "odt/a" });
    repository.commit(source, new Map([["README.md", text("# Notes\n\nTags\n")]]), "Tags");
    const fork = repository.addWorktree({
      workingDirectory: "/worktrees/b",
      branch: "odt/b",
      from: source,
    });
    const changed = (ref: string) =>
      repository.worktreeStatus(fork, ref, 0).fileDiffs.map((diff) => [diff.file, diff.type]);

    expect(changed("refs/heads/odt/a")).toEqual([]);
    expect(repository.worktreeStatus(fork, "odt/a", 0).targetAheadBehind).toEqual({
      ahead: 0,
      behind: 0,
    });
    expect(changed("origin/main")).toEqual([["README.md", "modified"]]);

    repository.commit(fork, new Map([["src/old.ts", null]]), "Remove old");
    expect(changed("refs/heads/odt/a")).toEqual([["src/old.ts", "deleted"]]);
    const tree = repository.fileTree(fork, "odt/a");
    expect(
      tree.kind === "snapshot" ? tree.entries.map((entry) => [entry.path, entry.gitStatus]) : [],
    ).toEqual([["README.md", null]]);
    expect(() => changed("refs/heads/missing")).toThrow("has no branch missing");
  });

  test("merges a branch into the branch of another checkout", () => {
    const repository = createDemoRepository({
      repoPath: "/repo",
      targetBranch: "main",
      files: new Map([["README.md", text("# Notes\n")]]),
    });
    const into = repository.addWorktree({ workingDirectory: "/worktrees/a", branch: "odt/a" });
    const task = repository.addWorktree({
      workingDirectory: "/worktrees/b",
      branch: "odt/b",
      from: into,
    });
    repository.commit(task, new Map([["src/b.ts", text("export {};\n")]]), "Add b");

    repository.commit(into, new Map([["README.md", text("# Notes\n\nA\n")]]), "Edit a");
    const source = { revision: task.revision, readme: repository.readFile(task, "README.md") };

    repository.mergeInto(task, "odt/a");

    expect(repository.readFile(into, "src/b.ts")).toEqual(text("export {};\n"));
    expect(repository.readFile(into, "README.md")).toEqual(text("# Notes\n\nA\n"));
    expect(repository.readFile(repository.checkout("/repo"), "src/b.ts")).toBeNull();
    expect({ revision: task.revision, readme: repository.readFile(task, "README.md") }).toEqual(
      source,
    );
    expect(into.revision).not.toBe(task.revision);
  });

  test("keeps other worktrees on their base when a branch merges into the target", () => {
    const repository = createDemoRepository({
      repoPath: "/repo",
      targetBranch: "main",
      files: new Map([["README.md", text("# Notes\n")]]),
    });
    const merged = repository.addWorktree({ workingDirectory: "/worktrees/a", branch: "odt/a" });
    const other = repository.addWorktree({ workingDirectory: "/worktrees/b", branch: "odt/b" });
    repository.commit(merged, new Map([["src/a.ts", text("export {};\n")]]), "Add a");

    repository.mergeInto(merged, "main");

    expect(repository.readFile(other, "src/a.ts")).toBeNull();
    expect(repository.worktreeStatus(other, "main", 0).targetAheadBehind).toEqual({
      ahead: 0,
      behind: 1,
    });
  });

  test("resets a branch to its selected base", () => {
    const repository = createDemoRepository({
      repoPath: "/repo",
      targetBranch: "main",
      files: new Map([["README.md", text("# Notes\n")]]),
    });
    const base = repository.addWorktree({ workingDirectory: "/worktrees/a", branch: "odt/a" });
    repository.commit(base, new Map([["src/a.ts", text("export {};\n")]]), "Add a");
    const task = repository.addWorktree({
      workingDirectory: "/worktrees/b",
      branch: "odt/b",
      base: "odt/a",
    });
    repository.commit(task, new Map([["src/b.ts", text("export {};\n")]]), "Add b");

    repository.resetBranch(task, "odt/a");

    expect(repository.readFile(task, "src/a.ts")).toEqual(text("export {};\n"));
    expect(repository.readFile(task, "src/b.ts")).toBeNull();
    expect(repository.worktreeStatus(task, "odt/a", 0).targetAheadBehind).toEqual({
      ahead: 0,
      behind: 0,
    });
  });

  test("refuses a second worktree on a branch, and squashes only changed paths", () => {
    const repository = createDemoRepository({
      repoPath: "/repo",
      targetBranch: "main",
      files: new Map([["README.md", text("# Notes\n")]]),
    });
    const task = repository.addWorktree({ workingDirectory: "/worktrees/a", branch: "odt/a" });
    expect(() =>
      repository.addWorktree({ workingDirectory: "/worktrees/b", branch: "odt/a" }),
    ).toThrow("A worktree already uses the branch odt/a");
    expect(() =>
      repository.addWorktree({ workingDirectory: "/worktrees/c", branch: "main" }),
    ).toThrow("A worktree already uses the branch main");

    repository.commit(task, new Map([["README.md", text("# Draft\n")]]), "Draft");
    repository.commit(task, new Map([["README.md", text("# Notes\n")]]), "Revert");
    repository.commit(task, new Map([["src/a.ts", text("export {};\n")]]), "Add a");
    const root = repository.checkout("/repo");
    repository.commit(root, new Map([["README.md", text("# Notes\n\nMain\n")]]), "Edit main");

    repository.mergeInto(task, "main");

    expect(repository.readFile(root, "README.md")).toEqual(text("# Notes\n\nMain\n"));
    expect(repository.readFile(root, "src/a.ts")).toEqual(text("export {};\n"));
  });
});
