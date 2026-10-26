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

  test("ignores the existing worktree choice for the current checkout", () => {
    expect(base({ location: "local_repo_root" })).toMatchObject({ location: "local_repo_root" });
    expect(base({ location: "local_repo_root" })).not.toHaveProperty("existingWorktree");
  });
});
