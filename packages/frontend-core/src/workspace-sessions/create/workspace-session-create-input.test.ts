import { describe, expect, test } from "bun:test";
import { buildWorkspaceSessionCreateInput } from "./workspace-session-create-input";

const base = (overrides: Partial<Parameters<typeof buildWorkspaceSessionCreateInput>[0]>) =>
  buildWorkspaceSessionCreateInput({
    workspaceId: "A",
    name: "",
    roleId: "none",
    location: "existing_worktree",
    worktree: { mode: "from_name", name: "left-over", branchName: null },
    existingWorktree: "/worktrees/one",
    targetBranch: { branch: "main" },
    selection: { runtimeKind: "codex", providerId: "codex", modelId: "model" },
    selectedModelAvailable: true,
    rolesReady: true,
    availableBranches: [],
    hasNamingModel: false,
    ...overrides,
  });

describe("buildWorkspaceSessionCreateInput", () => {
  test("sends only the existing worktree destination", () => {
    expect(base({})).toEqual({
      workspaceId: "A",
      runtimeKind: "codex",
      selectedModel: { runtimeKind: "codex", providerId: "codex", modelId: "model" },
      customAgentRoleId: null,
      manualTitle: "",
      targetBranch: { branch: "main" },
      location: "existing_worktree",
      existingWorktree: { workingDirectory: "/worktrees/one" },
    });
  });

  test("blocks an existing worktree with no checked selection", () => {
    expect(base({ existingWorktree: null })).toBeNull();
  });

  test("sends a blank new branch worktree name only when the workspace has a naming model", () => {
    const blank = {
      location: "local_worktree" as const,
      worktree: { mode: "from_name" as const, name: "  ", branchName: null },
    };
    expect(base(blank)).toBeNull();
    expect(base({ ...blank, hasNamingModel: true })).toMatchObject({
      location: "local_worktree",
      worktree: { mode: "from_name", name: "", branchName: null },
    });
    expect(
      base({
        ...blank,
        hasNamingModel: true,
        worktree: { mode: "from_branch", name: "", branchName: "main" },
        availableBranches: [{ name: "main", isCurrent: true, isRemote: false }],
      }),
    ).toBeNull();
  });

  test("ignores the existing worktree choice for the current checkout", () => {
    expect(base({ location: "local_repo_root" })).toMatchObject({ location: "local_repo_root" });
    expect(base({ location: "local_repo_root" })).not.toHaveProperty("existingWorktree");
  });
});
