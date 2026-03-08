import { describe, expect, test } from "bun:test";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "./agents-page-git-panel";

describe("agents-page-git-panel", () => {
  test("uses workspace activeBranch in repository mode", () => {
    expect(
      resolveAgentStudioGitPanelBranch({
        contextMode: "repository",
        workspaceActiveBranch: {
          name: "feature/sidebar-source",
          detached: false,
        },
        diffBranch: "feature/stale-diff-source",
      }),
    ).toBe("feature/sidebar-source");
  });

  test("keeps detached head semantics in repository mode", () => {
    expect(
      resolveAgentStudioGitPanelBranch({
        contextMode: "repository",
        workspaceActiveBranch: {
          name: "main",
          detached: true,
        },
        diffBranch: "main",
      }),
    ).toBeNull();
  });

  test("falls back to diff branch when workspace branch is unavailable", () => {
    expect(
      resolveAgentStudioGitPanelBranch({
        contextMode: "repository",
        workspaceActiveBranch: null,
        diffBranch: "feature/from-diff",
      }),
    ).toBe("feature/from-diff");
  });

  test("preserves worktree-mode branch sourcing", () => {
    expect(
      resolveAgentStudioGitPanelBranch({
        contextMode: "worktree",
        workspaceActiveBranch: {
          name: "main",
          detached: false,
        },
        diffBranch: "feature/worktree-branch",
      }),
    ).toBe("feature/worktree-branch");
  });

  test("builds a stable identity key for repository branches", () => {
    expect(
      buildAgentStudioGitPanelBranchIdentityKey({
        name: "feature/sidebar-source",
        detached: false,
      }),
    ).toBe("branch:feature/sidebar-source");
    expect(
      buildAgentStudioGitPanelBranchIdentityKey({
        name: "main",
        detached: true,
        revision: "abc123",
      }),
    ).toBe("detached:abc123");
    expect(buildAgentStudioGitPanelBranchIdentityKey(null)).toBe("unknown");
  });
});
