import { execFileSync } from "node:child_process";

// Git hooks and `git rebase --exec` set variables such as GIT_DIR. They would send fixture
// commands, and the Git adapter under test, to the outer repository.
const repositoryLocalVariables = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((name) => name.length > 0);

export const gitFixtureEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !repositoryLocalVariables.includes(name)),
);

const runGit = (cwd: string, args: string[]): void => {
  execFileSync("git", args, { cwd, env: gitFixtureEnv, stdio: ["ignore", "pipe", "pipe"] });
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
