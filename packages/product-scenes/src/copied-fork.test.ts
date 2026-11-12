import { describe, expect, test } from "bun:test";
import { FORK_TEXT } from "./replicas/studio/ForkDialog";
import { REPOSITORY_PATH } from "./sample/workspace";
import { BRANCH_PREFIX, FORK_TITLE, ORIGIN, SOURCE, TITLE, WORKTREE } from "./scenes/fork/sample";
import { importProduct } from "./test-support/product-source";

type ForkRecord = {
  executionTarget: { kind: "local_worktree"; workingDirectory: string; branchName: string };
};
type WorktreeInput = { mode: "from_name"; name: string; branchName: null };

// SAFETY: workspace-session-fork-form.ts exports these values, and a missing export fails the test.
const form = await importProduct<{
  FORK_CHAT_TEXT: Record<string, string>;
  forkSourceFolder: (record: ForkRecord) => {
    name: string;
    directory: string;
    branchName: string | null;
  };
  initialForkWorktree: (record: ForkRecord) => WorktreeInput;
}>("packages/frontend-core/src/workspace-sessions/fork/workspace-session-fork-form.ts");
// SAFETY: workspace-session-worktree-rules.ts exports these functions, and a missing export fails
// the test.
const rules = await importProduct<{
  worktreeDirectoryName: (name: string) => string | null;
  newWorktreeBranchState: (
    value: WorktreeInput,
    branchPrefix: string,
  ) => { branchError: boolean; defaultBranch: string };
}>("packages/frontend-core/src/workspace-sessions/create/workspace-session-worktree-rules.ts");
// SAFETY: the contracts export these values, and a missing export fails the test.
const { DEFAULT_BRANCH_PREFIX, WORKSPACE_SESSION_MANUAL_TITLE_LIMIT } = await importProduct<{
  DEFAULT_BRANCH_PREFIX: string;
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT: number;
}>("packages/contracts/src/index.ts");
// SAFETY: startup-summary.ts exports this function, and a missing export fails the test.
const { startupOrigin } = await importProduct<{
  startupOrigin: (attempt: {
    origin: { repoPath: string; scope: { kind: "workspace" } };
  }) => string;
}>("packages/frontend/src/features/session-startup/startup-summary.ts");

const record: ForkRecord = {
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: SOURCE.directory,
    branchName: SOURCE.branch,
  },
};

describe("the fork copied from the app", () => {
  test("the dialog uses the words of the fork form", () => {
    for (const [key, text] of Object.entries(FORK_TEXT))
      expect(form.FORK_CHAT_TEXT[key]).toBe(text);
  });

  test("the source folder shows the folder and the branch of the session", () => {
    expect(form.forkSourceFolder(record)).toEqual({
      name: SOURCE.name,
      directory: SOURCE.directory,
      branchName: SOURCE.branch,
    });
  });

  test("the form suggests the worktree name, its directory, and its branch", () => {
    const suggested = form.initialForkWorktree(record);
    expect(suggested).toEqual({ mode: "from_name", name: WORKTREE.name, branchName: null });
    expect(BRANCH_PREFIX).toBe(DEFAULT_BRANCH_PREFIX);
    expect(rules.worktreeDirectoryName(WORKTREE.name)).toBe(WORKTREE.directory);
    expect(rules.newWorktreeBranchState(suggested, BRANCH_PREFIX)).toEqual({
      branchError: false,
      defaultBranch: WORKTREE.branch,
    });
  });

  test("the fork title adds the suffix of the host and fits the title limit", () => {
    expect(FORK_TITLE).toBe(`${TITLE} (fork)`);
    expect(FORK_TITLE.length).toBeLessThanOrEqual(WORKSPACE_SESSION_MANUAL_TITLE_LIMIT);
  });

  test("the startup progress names the repository and the scope", () => {
    const attempt = {
      origin: { repoPath: REPOSITORY_PATH, scope: { kind: "workspace" } },
    } as const;
    expect(startupOrigin(attempt)).toBe(ORIGIN);
  });
});
