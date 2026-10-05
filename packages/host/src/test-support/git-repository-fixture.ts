import { execFileSync } from "node:child_process";

const runGit = (cwd: string, args: string[]): void => {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
};

export const initGitRepository = (path: string): void => {
  runGit(path, ["init", "-q"]);
  runGit(path, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
};

export const addGitWorktree = (repoPath: string, worktreePath: string, branch: string): void => {
  runGit(repoPath, ["worktree", "add", "-q", "-b", branch, worktreePath]);
};
