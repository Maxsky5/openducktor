import { Effect } from "effect";
import {
  createGitCliAdapter as createEffectGitCliAdapter,
  type GitCommandRunner,
} from "./git-cli-adapter";

const createGitCliAdapter = (...args: Parameters<typeof createEffectGitCliAdapter>) =>
  createEffectGitCliAdapter(...args);
const createRunner =
  (outputs: Record<string, string>): GitCommandRunner =>
  (_workingDirectory, args) =>
    Effect.succeed({
      ok: true,
      stdout: outputs[args.join(" ")] ?? "",
      stderr: "",
    });
describe("createGitCliAdapter", () => {
  test("lists branches with current local branches first and skips remote HEAD refs", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "for-each-ref --format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname) refs/heads refs/remotes":
          [
            "0|origin/HEAD|refs/remotes/origin/HEAD",
            "0|origin/main|refs/remotes/origin/main",
            "0|feature/b|refs/heads/feature/b",
            "1|feature/a|refs/heads/feature/a",
          ].join("\n"),
      }),
    });
    await expect(Effect.runPromise(git.listBranches("/repo"))).resolves.toEqual([
      { name: "feature/a", isCurrent: true, isRemote: false },
      { name: "feature/b", isCurrent: false, isRemote: false },
      { name: "origin/main", isCurrent: false, isRemote: true },
    ]);
  });
  test("returns current branch and revision", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "branch --show-current": "main\n",
        "rev-parse HEAD": "abc123\n",
      }),
    });
    await expect(Effect.runPromise(git.getCurrentBranch("/repo"))).resolves.toEqual({
      name: "main",
      detached: false,
      revision: "abc123",
    });
  });
  test("lists remotes with resolved URLs", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        remote: "origin\nbackup\n",
        "remote get-url origin": "git@github.com:openai/openducktor.git\n",
        "remote get-url backup": "https://github.com/openai/openducktor.git\n",
      }),
    });
    await expect(Effect.runPromise(git.listRemotes("/repo"))).resolves.toEqual([
      { name: "origin", url: "git@github.com:openai/openducktor.git" },
      { name: "backup", url: "https://github.com/openai/openducktor.git" },
    ]);
  });
  test("parses porcelain status rows", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "status --porcelain=v1 -z --untracked-files=all": [
          " M src/unstaged.ts",
          "A  src/staged.ts",
          "?? src/new.ts",
          "!! dist/ignored.js",
          "UU src/conflict.ts",
          "AA src/add-add-conflict.ts",
        ].join("\n"),
      }),
    });
    await expect(Effect.runPromise(git.getStatus("/repo"))).resolves.toEqual([
      { path: "src/unstaged.ts", status: "modified", staged: false },
      { path: "src/staged.ts", status: "added", staged: true },
      { path: "src/new.ts", status: "untracked", staged: false },
      { path: "dist/ignored.js", status: "ignored", staged: false },
      { path: "src/conflict.ts", status: "unmerged", staged: true },
      { path: "src/add-add-conflict.ts", status: "unmerged", staged: true },
    ]);
  });
  test("uses the destination path for NUL-delimited rename status rows", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "status --porcelain=v1 -z --untracked-files=all":
          "R  src/new name.ts\0src/old name.ts\0 M src/other.ts\0",
      }),
    });

    await expect(Effect.runPromise(git.getStatus("/repo"))).resolves.toEqual([
      { path: "src/new name.ts", status: "renamed", staged: true },
      { path: "src/other.ts", status: "modified", staged: false },
    ]);
  });
  test("consumes original paths for unstaged NUL-delimited rename rows", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "status --porcelain=v1 -z --untracked-files=all":
          " R src/new.ts\0src/old.ts\0 M src/other.ts\0",
      }),
    });

    await expect(Effect.runPromise(git.getStatus("/repo"))).resolves.toEqual([
      { path: "src/new.ts", status: "renamed", staged: false },
      { path: "src/other.ts", status: "modified", staged: false },
    ]);
  });
  test("lists changed destination paths without loading patch content", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "diff --name-status -z --end-of-options origin/main":
          "M\0src/modified.ts\0R084\0src/old.ts\0src/new.ts\0",
      }),
    });

    await expect(Effect.runPromise(git.listChangedFiles("/repo", "origin/main"))).resolves.toEqual([
      { path: "src/modified.ts", status: "modified" },
      { path: "src/new.ts", status: "renamed" },
    ]);
  });
  test("returns sorted file diffs with additions and deletions", async () => {
    const fullDiff = [
      "diff --git a/src/b.ts b/src/b.ts",
      "index 123..456 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1,2 @@",
      " old",
      "+new",
      "+line",
      "diff --git a/src/a.ts b/src/a.ts",
      "new file mode 100644",
      "index 000..789",
      "--- /dev/null",
      "+++ b/src/a.ts",
      "@@ -0,0 +1 @@",
      "+first",
      "",
    ].join("\n");
    const git = createGitCliAdapter({
      runner: createRunner({
        "diff --numstat --end-of-options HEAD": "2\t0\tsrc/b.ts\n1\t0\tsrc/a.ts\n",
        "diff --end-of-options HEAD": fullDiff,
        "status --porcelain=v1 -z --untracked-files=all": "",
      }),
    });
    await expect(Effect.runPromise(git.getDiff("/repo"))).resolves.toEqual([
      {
        file: "src/a.ts",
        type: "added",
        additions: 1,
        deletions: 0,
        diff: expect.stringContaining("new file mode"),
      },
      {
        file: "src/b.ts",
        type: "modified",
        additions: 2,
        deletions: 0,
        diff: expect.stringContaining("@@ -1 +1,2 @@"),
      },
    ]);
  });
  test("builds target-scoped worktree status from the branch diff base", async () => {
    const fullDiff = [
      "diff --git a/src/main.ts b/src/main.ts",
      "index 123..456 100644",
      "--- a/src/main.ts",
      "+++ b/src/main.ts",
      "@@ -1 +1,2 @@",
      " old",
      "+new",
      "+line",
      "",
    ].join("\n");
    const git = createGitCliAdapter({
      runner: createRunner({
        "branch --show-current": "feature/electron\n",
        "rev-parse HEAD": "abc123\n",
        "for-each-ref --format=%(refname) refs/remotes": "",
        "status --porcelain=v1 -z --untracked-files=all": " M src/main.ts\n",
        "merge-base --end-of-options origin/main HEAD": "base123\n",
        "diff --numstat --end-of-options base123": "2\t0\tsrc/main.ts\n",
        "diff --end-of-options base123": fullDiff,
        "rev-list --count --left-right --end-of-options origin/main...HEAD": "1 2\n",
      }),
    });
    await expect(
      Effect.runPromise(git.getWorktreeStatusData("/repo", "origin/main", "target")),
    ).resolves.toEqual(
      expect.objectContaining({
        currentBranch: { name: "feature/electron", detached: false, revision: "abc123" },
        fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
        fileDiffs: [
          {
            file: "src/main.ts",
            type: "modified",
            additions: 2,
            deletions: 0,
            diff: expect.stringContaining("@@ -1 +1,2 @@"),
          },
        ],
        targetAheadBehind: { ahead: 2, behind: 1 },
        upstreamAheadBehind: { outcome: "untracked", ahead: 2 },
      }),
    );
  });
  test("returns commit counts ahead and behind a target branch", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "rev-list --count --left-right --end-of-options origin/main...HEAD": "2\t3\n",
      }),
    });
    await expect(
      Effect.runPromise(git.commitsAheadBehind("/repo", "origin/main")),
    ).resolves.toEqual({
      ahead: 3,
      behind: 2,
    });
  });
  test("checks branch ancestry with merge-base", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        const isMerged =
          command === "merge-base --is-ancestor --end-of-options feature/merged main";
        return Effect.succeed({
          ok: isMerged,
          stdout: "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(git.isAncestor("/repo", "feature/merged", "main")),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(git.isAncestor("/repo", "feature/unmerged", "main")),
    ).resolves.toBe(false);
    expect(calls).toEqual([
      "merge-base --is-ancestor --end-of-options feature/merged main",
      "merge-base --is-ancestor --end-of-options feature/unmerged main",
    ]);
  });
  test("suggests the oldest branch commit message for squash merges", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "rev-list --reverse --end-of-options origin/main..feature/electron": "abc123\ndef456\n",
        "show -s --format=%B abc123": "Ship Electron host\n\nDetails\n",
      }),
    });
    await expect(
      Effect.runPromise(
        git.suggestedSquashCommitMessage("/repo", "feature/electron", "origin/main"),
      ),
    ).resolves.toBe("Ship Electron host\n\nDetails");
  });
  test("switches to an existing branch and returns the new current branch", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "switch --end-of-options feature/electron": "",
              "branch --show-current": "feature/electron\n",
              "rev-parse HEAD": "def456\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(git.switchBranch("/repo", " feature/electron ", false)),
    ).resolves.toEqual({
      name: "feature/electron",
      detached: false,
      revision: "def456",
    });
    expect(calls).toEqual([
      "switch --end-of-options feature/electron",
      "branch --show-current",
      "rev-parse HEAD",
    ]);
  });
  test("creates and switches to a new branch", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "switch -c feature/new": "",
              "branch --show-current": "feature/new\n",
              "rev-parse HEAD": "abc123\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(git.switchBranch("/repo", "feature/new", true)),
    ).resolves.toEqual({
      name: "feature/new",
      detached: false,
      revision: "abc123",
    });
    expect(calls).toEqual(["switch -c feature/new", "branch --show-current", "rev-parse HEAD"]);
  });
  test("creates worktrees for new and existing branches", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        calls.push(args.join(" "));
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    await expect(
      Effect.runPromise(git.createWorktree("/repo", "/worktrees/new", " feature/new ", true)),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        git.createWorktree("/repo", "/worktrees/existing", "feature/existing", false),
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      "worktree add -b feature/new --end-of-options /worktrees/new",
      "worktree add --end-of-options /worktrees/existing feature/existing",
    ]);
  });
  test("removes worktrees and deletes local branches with end-of-options", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        calls.push(args.join(" "));
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    await expect(
      Effect.runPromise(git.removeWorktree("/repo", "/worktrees/task", true)),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(git.deleteLocalBranch("/repo", "feature/task", true)),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      "worktree remove --force --end-of-options /worktrees/task",
      "branch -D --end-of-options feature/task",
    ]);
  });
  test("resets a tracked file selection with git restore", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    await expect(
      Effect.runPromise(
        git.resetWorktreeSelection(
          "/repo",
          [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 1,
              deletions: 1,
              diff: "@@ -1 +1 @@\n-old\n+new\n",
            },
          ],
          { kind: "file", filePath: " src/main.ts " },
        ),
      ),
    ).resolves.toEqual({ affectedPaths: ["src/main.ts"] });
    expect(calls).toEqual([
      "ls-files --error-unmatch -- src/main.ts",
      "restore --source=HEAD --staged --worktree -- src/main.ts",
    ]);
  });
  test("resets an untracked file selection with git clean", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        if (command === "ls-files --error-unmatch -- src/new.ts") {
          return Effect.succeed({
            ok: false,
            stdout: "",
            stderr: "error: pathspec 'src/new.ts' did not match any file(s) known to git\n",
          });
        }
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    await expect(
      Effect.runPromise(
        git.resetWorktreeSelection(
          "/repo",
          [
            {
              file: "src/new.ts",
              type: "added",
              additions: 1,
              deletions: 0,
              diff: "@@ -0,0 +1 @@\n+new\n",
            },
          ],
          { kind: "file", filePath: "src/new.ts" },
        ),
      ),
    ).resolves.toEqual({ affectedPaths: ["src/new.ts"] });
    expect(calls).toEqual(["ls-files --error-unmatch -- src/new.ts", "clean -f -- src/new.ts"]);
  });
  test("resets a hunk selection with reverse patch application", async () => {
    const calls: Array<{
      command: string;
      stdin?: string;
    }> = [];
    const diff = [
      "diff --git a/src/main.ts b/src/main.ts",
      "index 123..456 100644",
      "--- a/src/main.ts",
      "+++ b/src/main.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args, options) => {
        const command = args.join(" ");
        calls.push({ command, ...(options?.stdin === undefined ? {} : { stdin: options.stdin }) });
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "diff --cached -- src/main.ts": "",
              "diff -- src/main.ts": diff,
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(
        git.resetWorktreeSelection(
          "/repo",
          [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 1,
              deletions: 1,
              diff,
            },
          ],
          { kind: "hunk", filePath: "src/main.ts", hunkIndex: 0 },
        ),
      ),
    ).resolves.toEqual({ affectedPaths: ["src/main.ts"] });
    expect(calls.map((call) => call.command)).toEqual([
      "apply --reverse --check -",
      "diff --cached -- src/main.ts",
      "diff -- src/main.ts",
      "apply --reverse -",
    ]);
    expect(calls[0]?.stdin).toContain("@@ -1 +1 @@");
    expect(calls[3]?.stdin).toContain("@@ -1 +1 @@");
  });
  test("fetches the current branch upstream remote and compare target remote once each", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "branch --show-current": "feature/electron\n",
              "rev-parse HEAD": "abc123\n",
              remote: "origin\nbackup\n",
              "config --get branch.feature/electron.remote": "origin\n",
              "config --get branch.feature/electron.merge": "refs/heads/feature/electron\n",
              "fetch --prune -- origin": "",
              "fetch --prune -- backup": "Fetched backup\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(Effect.runPromise(git.fetchRemote("/repo", "backup/main"))).resolves.toEqual({
      outcome: "fetched",
      output: "Fetched origin\nFetched backup",
    });
    expect(calls).toContain("fetch --prune -- origin");
    expect(calls).toContain("fetch --prune -- backup");
  });
  test("skips fetch when no applicable remote can be resolved", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "branch --show-current": "feature/local\n",
        "rev-parse HEAD": "abc123\n",
        remote: "",
        "config --get branch.feature/local.remote": "",
        "for-each-ref --format=%(refname) refs/remotes": "",
      }),
    });
    await expect(Effect.runPromise(git.fetchRemote("/repo", "main"))).resolves.toEqual({
      outcome: "skipped_no_remote",
      output:
        "Skipped git fetch because no applicable remote is configured for this repo or branch.",
    });
  });
  test("pulls upstream commits with a fast-forward merge after fetching the configured upstream", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "branch --show-current": "feature/electron\n",
              "rev-parse HEAD":
                calls.filter((call) => call === "rev-parse HEAD").length <= 2
                  ? "before\n"
                  : "after\n",
              "config --get branch.feature/electron.remote": "origin\n",
              "config --get branch.feature/electron.merge": "refs/heads/feature/electron\n",
              "status --porcelain=v1 -z --untracked-files=all": "",
              "fetch --prune -- origin +refs/heads/feature/electron:refs/remotes/origin/feature/electron":
                "Fetched origin\n",
              "rev-list --count --left-right --end-of-options refs/remotes/origin/feature/electron...HEAD":
                "2 0\n",
              "merge --ff-only refs/remotes/origin/feature/electron": "Fast-forward\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(Effect.runPromise(git.pullBranch("/repo"))).resolves.toEqual({
      outcome: "pulled",
      output: "Fast-forward",
    });
    expect(calls).toContain(
      "fetch --prune -- origin +refs/heads/feature/electron:refs/remotes/origin/feature/electron",
    );
    expect(calls).toContain("merge --ff-only refs/remotes/origin/feature/electron");
  });
  test("reports pull conflicts from a failed rebase", async () => {
    let rebaseFailed = false;
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        if (command === "rebase --no-fork-point refs/remotes/origin/main") {
          rebaseFailed = true;
          return Effect.succeed({
            ok: false,
            stdout: "",
            stderr: "CONFLICT (content): Merge conflict in src/main.ts\n",
          });
        }
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "branch --show-current": "feature/electron\n",
              "rev-parse HEAD": "before\n",
              "config --get branch.feature/electron.remote": "origin\n",
              "config --get branch.feature/electron.merge": "refs/heads/main\n",
              "status --porcelain=v1 -z --untracked-files=all": rebaseFailed
                ? "UU src/main.ts\n"
                : "",
              "fetch --prune -- origin +refs/heads/main:refs/remotes/origin/main":
                "Fetched origin\n",
              "rev-list --count --left-right --end-of-options refs/remotes/origin/main...HEAD":
                "1 2\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(Effect.runPromise(git.pullBranch("/repo"))).resolves.toEqual({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    });
  });
  test("commits all staged and unstaged changes", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "add -A": "",
              "diff --cached --name-only": "src/main.ts\n",
              "commit -m Ship Electron host": "[feature abc123] Ship Electron host\n",
              "rev-parse HEAD": "abc123\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(git.commitAll("/repo", "  Ship Electron host  ")),
    ).resolves.toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
    expect(calls).toEqual([
      "add -A",
      "diff --cached --name-only",
      "commit -m Ship Electron host",
      "rev-parse HEAD",
    ]);
  });
  test("returns no_changes when commit all has nothing staged after add", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "add -A": "",
        "diff --cached --name-only": "\n",
      }),
    });
    await expect(Effect.runPromise(git.commitAll("/repo", "No changes"))).resolves.toEqual({
      outcome: "no_changes",
      output: "No staged changes to commit",
    });
  });
  test("pushes a branch and syncs the remote tracking ref", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "push --porcelain -u --force-with-lease -- origin feature/electron":
                "To github.com:openai/openducktor.git\n",
              "rev-parse refs/heads/feature/electron": "abc123\n",
              "update-ref refs/remotes/origin/feature/electron abc123": "",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(
        git.pushBranch("/repo", " feature/electron ", {
          remote: " origin ",
          setUpstream: true,
          forceWithLease: true,
        }),
      ),
    ).resolves.toEqual({
      outcome: "pushed",
      remote: "origin",
      branch: "feature/electron",
      output: "To github.com:openai/openducktor.git",
    });
    expect(calls).toEqual([
      "push --porcelain -u --force-with-lease -- origin feature/electron",
      "rev-parse refs/heads/feature/electron",
      "update-ref refs/remotes/origin/feature/electron abc123",
    ]);
  });
  test("returns a typed non-fast-forward push rejection", async () => {
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        if (args.join(" ") === "push --porcelain -- origin feature/electron") {
          return Effect.succeed({
            ok: false,
            stdout: "",
            stderr: "! [rejected] feature/electron -> feature/electron (non-fast-forward)\n",
          });
        }
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      },
    });
    await expect(Effect.runPromise(git.pushBranch("/repo", "feature/electron"))).resolves.toEqual({
      outcome: "rejected_non_fast_forward",
      remote: "origin",
      branch: "feature/electron",
      output: "! [rejected] feature/electron -> feature/electron (non-fast-forward)",
    });
  });
  test("rebases a clean branch onto a target branch", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        if (command === "merge-base --is-ancestor origin/main HEAD") {
          return Effect.succeed({ ok: false, stdout: "", stderr: "" });
        }
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "branch --show-current": "feature/electron\n",
              "rev-parse HEAD": "abc123\n",
              "status --porcelain=v1 -z --untracked-files=all": "",
              "merge-base --is-ancestor origin/main HEAD": "",
              "rebase --end-of-options origin/main": "Successfully rebased\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(Effect.runPromise(git.rebaseBranch("/repo", " origin/main "))).resolves.toEqual({
      outcome: "rebased",
      output: "Successfully rebased",
    });
    expect(calls).toEqual([
      "branch --show-current",
      "rev-parse HEAD",
      "status --porcelain=v1 -z --untracked-files=all",
      "merge-base --is-ancestor origin/main HEAD",
      "rebase --end-of-options origin/main",
    ]);
  });
  test("returns up_to_date when the branch already contains target history", async () => {
    const git = createGitCliAdapter({
      runner: createRunner({
        "branch --show-current": "feature/electron\n",
        "rev-parse HEAD": "abc123\n",
        "status --porcelain=v1 -z --untracked-files=all": "",
        "merge-base --is-ancestor origin/main HEAD": "",
      }),
    });
    await expect(Effect.runPromise(git.rebaseBranch("/repo", "origin/main"))).resolves.toEqual({
      outcome: "up_to_date",
      output: "Branch already contains target history",
    });
  });
  test("mergeBranch checks out a local target for remote target refs and merges", async () => {
    const calls: string[] = [];
    let revParseCount = 0;
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        if (command === "rev-parse HEAD") {
          revParseCount += 1;
          return Effect.succeed({
            ok: true,
            stdout: revParseCount === 3 ? "after\n" : "before\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "for-each-ref --format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname) refs/heads refs/remotes":
                "1|main|refs/heads/main\n0|origin/main|refs/remotes/origin/main\n0|odt/task-1|refs/heads/odt/task-1\n",
              "status --porcelain=v1 -z --untracked-files=all": "",
              "switch --end-of-options main": "",
              "branch --show-current": "main\n",
              "merge --no-ff --end-of-options odt/task-1": "Merge made by recursive.\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(
        git.mergeBranch("/repo", {
          sourceBranch: "odt/task-1",
          targetBranch: "origin/main",
          method: "merge_commit",
        }),
      ),
    ).resolves.toEqual({
      outcome: "merged",
      output: "Merge made by recursive.",
    });
    expect(calls).toEqual([
      "for-each-ref --format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname) refs/heads refs/remotes",
      "status --porcelain=v1 -z --untracked-files=all",
      "switch --end-of-options main",
      "branch --show-current",
      "rev-parse HEAD",
      "rev-parse HEAD",
      "merge --no-ff --end-of-options odt/task-1",
      "rev-parse HEAD",
    ]);
  });
  test("mergeBranch returns conflicts from merge status entries", async () => {
    let mergeFailed = false;
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        if (command === "merge --squash --end-of-options odt/task-1") {
          mergeFailed = true;
          return Effect.succeed({
            ok: false,
            stdout: "",
            stderr: "CONFLICT (content): Merge conflict in src/main.ts\n",
          });
        }
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "for-each-ref --format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname) refs/heads refs/remotes":
                "1|main|refs/heads/main\n0|odt/task-1|refs/heads/odt/task-1\n",
              "status --porcelain=v1 -z --untracked-files=all": mergeFailed
                ? "UU src/main.ts\n"
                : "",
              "switch --end-of-options main": "",
              "branch --show-current": "main\n",
              "rev-parse HEAD": "before\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(
      Effect.runPromise(
        git.mergeBranch("/repo", {
          sourceBranch: "odt/task-1",
          targetBranch: "main",
          method: "squash",
          squashCommitMessage: "Task 1",
        }),
      ),
    ).resolves.toEqual({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    });
  });
  test("returns rebase conflicts from unmerged status entries", async () => {
    let rebaseFailed = false;
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        if (command === "merge-base --is-ancestor origin/main HEAD") {
          return Effect.succeed({ ok: false, stdout: "", stderr: "" });
        }
        if (command === "rebase --end-of-options origin/main") {
          rebaseFailed = true;
          return Effect.succeed({
            ok: false,
            stdout: "",
            stderr: "CONFLICT (content): Merge conflict in src/main.ts\n",
          });
        }
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "branch --show-current": "feature/electron\n",
              "rev-parse HEAD": "abc123\n",
              "status --porcelain=v1 -z --untracked-files=all": rebaseFailed
                ? "AA src/main.ts\n"
                : "",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(Effect.runPromise(git.rebaseBranch("/repo", "origin/main"))).resolves.toEqual({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    });
  });
  test("aborts rebase and conflict operations with the operation-specific git command", async () => {
    const calls: string[] = [];
    const git = createGitCliAdapter({
      runner: (_workingDirectory, args) => {
        const command = args.join(" ");
        calls.push(command);
        return Effect.succeed({
          ok: true,
          stdout:
            {
              "rebase --abort": "rebase aborted\n",
              "merge --abort": "merge aborted\n",
              "reset --hard HEAD": "HEAD is now at abc123 feature\n",
            }[command] ?? "",
          stderr: "",
        });
      },
    });
    await expect(Effect.runPromise(git.rebaseAbort("/repo"))).resolves.toEqual({
      outcome: "aborted",
      output: "rebase aborted",
    });
    await expect(
      Effect.runPromise(git.abortConflict("/repo", "direct_merge_merge_commit")),
    ).resolves.toEqual({
      output: "merge aborted",
    });
    await expect(
      Effect.runPromise(git.abortConflict("/repo", "direct_merge_squash")),
    ).resolves.toEqual({
      output: "HEAD is now at abc123 feature",
    });
    await expect(Effect.runPromise(git.abortConflict("/repo", "pull_rebase"))).resolves.toEqual({
      output: "rebase aborted",
    });
    expect(calls).toEqual([
      "rebase --abort",
      "merge --abort",
      "reset --hard HEAD",
      "rebase --abort",
    ]);
  });
});
