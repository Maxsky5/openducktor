import { describe, expect, test } from "bun:test";
import { REPOSITORY_PATH } from "./sample/workspace";
import { BRANCH_PREFIX, ISSUE_IMPORT, NAME, ORIGIN, WORKTREE } from "./scenes/new-session/sample";
import { importProduct } from "./test-support/product-source";

type WorktreeInput = { mode: "from_name"; name: string; branchName: null };

// SAFETY: issue-import-provider.ts exports this function, and a missing export fails the test.
const { issueImportActionLabel } = await importProduct<{
  issueImportActionLabel: (state: {
    kind: "ready";
    provider: { config: { id: string } };
  }) => string;
}>("packages/frontend-core/src/tasks/issue-import/issue-import-provider.ts");
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

describe("the new session copied from the app", () => {
  test("the menu names the issue import of a GitHub workspace", () => {
    expect(issueImportActionLabel({ kind: "ready", provider: { config: { id: "github" } } })).toBe(
      ISSUE_IMPORT,
    );
  });

  test("the session name fits the title limit of the app", () => {
    expect(NAME.length).toBeLessThanOrEqual(WORKSPACE_SESSION_MANUAL_TITLE_LIMIT);
  });

  test("the worktree name makes the directory and the branch of the app", () => {
    expect(BRANCH_PREFIX).toBe(DEFAULT_BRANCH_PREFIX);
    expect(rules.worktreeDirectoryName(WORKTREE.name)).toBe(WORKTREE.directory);
    const value: WorktreeInput = { mode: "from_name", name: WORKTREE.name, branchName: null };
    expect(rules.newWorktreeBranchState(value, BRANCH_PREFIX)).toEqual({
      branchError: false,
      defaultBranch: WORKTREE.branch ?? "",
    });
  });

  test("the startup progress names the repository and the scope", () => {
    const attempt = {
      origin: { repoPath: REPOSITORY_PATH, scope: { kind: "workspace" } },
    } as const;
    expect(startupOrigin(attempt)).toBe(ORIGIN);
  });
});
