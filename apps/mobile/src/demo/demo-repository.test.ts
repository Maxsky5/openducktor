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
    expect(repository.branchDiffs(checkout).map((diff) => [diff.file, diff.type])).toEqual([
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
    repository.mergeIntoTarget(checkout);
    const root = repository.checkout("/repo");
    expect(repository.readFile(root, "src/new.ts")).toEqual(text("export {};\n"));
    expect(repository.branchDiffs(checkout)).toEqual([]);
  });
});
