import { describe, expect, test } from "bun:test";
import { UPSTREAM_TARGET_BRANCH } from "@openducktor/contracts";
import { DEFAULT_WORKSPACE_SESSION_DRAFT_OPTIONS } from "../../drafts/new-workspace-session-draft-store";
import { validateWorkspaceSessionDraft } from "./workspace-session-draft-validation";

const baseInput = () => ({
  workspaceId: "ws-1",
  repoPath: "/repo",
  isConnected: true,
  options: { ...DEFAULT_WORKSPACE_SESSION_DRAFT_OPTIONS },
  composer: { segments: [{ id: "t1", kind: "text" as const, text: "Hello" }], attachments: [] },
  repoConfig: {
    isPending: false,
    isError: false,
    errorMessage: null,
    data: { defaultTargetBranch: { remote: "origin", branch: "main" } },
  },
  roles: {
    isPending: false,
    isError: false,
    errorMessage: null,
    data: [{ id: "role-1", name: "Reviewer", systemPrompt: "Review code" }],
  },
  branches: {
    isPending: false,
    isError: false,
    errorMessage: null,
    data: [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "busy", isCurrent: false, isRemote: false, worktreePath: "/wt/busy" },
    ],
  },
  worktrees: {
    isPending: false,
    isError: false,
    errorMessage: null,
    data: { worktrees: [{ workingDirectory: "/wt/one", branchName: "feat/one" }] },
  },
  effectiveSelection: { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt-5" },
  selectedModelAvailable: true,
  runtimeSelectionError: null,
  hostValidationError: null,
});

describe("validateWorkspaceSessionDraft", () => {
  test("builds a valid launch request for current checkout and blank new-worktree", () => {
    const rootValidation = validateWorkspaceSessionDraft(baseInput());
    expect(rootValidation.canSubmit).toBe(true);
    expect(
      rootValidation.buildLaunchRequest({
        draftId: "draft-1",
        parts: [{ kind: "text", text: "Hello" }],
      }),
    ).toMatchObject({
      workspaceId: "ws-1",
      draftId: "draft-1",
      location: "local_repo_root",
      targetBranch: { remote: "origin", branch: "main" },
    });

    const wtInput = baseInput();
    wtInput.options.location = "local_worktree";
    const wtValidation = validateWorkspaceSessionDraft(wtInput);
    expect(wtValidation.canSubmit).toBe(true);
    expect(
      wtValidation.buildLaunchRequest({
        draftId: "draft-1",
        parts: [{ kind: "text", text: "Hello" }],
      }),
    ).toMatchObject({
      location: "local_worktree",
      worktree: { mode: "from_name", name: "", branchName: null },
    });
  });

  test("flags stale restored role, unavailable model, removed worktree, and offline state", () => {
    const deletedRole = baseInput();
    deletedRole.options.customAgentRoleId = "missing-role";
    expect(validateWorkspaceSessionDraft(deletedRole).fieldErrors.role).toContain(
      "no longer exists",
    );

    const missingModel = baseInput();
    missingModel.selectedModelAvailable = false;
    expect(validateWorkspaceSessionDraft(missingModel).fieldErrors.runtime).toContain(
      "no longer available",
    );

    const removedWorktree = baseInput();
    removedWorktree.options.location = "existing_worktree";
    removedWorktree.options.existingWorktreeDirectory = "/wt/removed";
    expect(validateWorkspaceSessionDraft(removedWorktree).fieldErrors.existingWorktree).toContain(
      "no longer registered",
    );

    const offline = baseInput();
    offline.isConnected = false;
    expect(validateWorkspaceSessionDraft(offline).canSubmit).toBe(false);
    expect(validateWorkspaceSessionDraft(offline).fieldErrors.connection).not.toBeNull();
  });

  test("requires explicit target branch when leaving current checkout and repo default is Tracked upstream", () => {
    const input = baseInput();
    input.repoConfig.data = { defaultTargetBranch: { remote: "", branch: UPSTREAM_TARGET_BRANCH } };
    input.options.location = "local_worktree";
    const validation = validateWorkspaceSessionDraft(input);
    expect(validation.effectiveTargetBranch).toBeNull();
    expect(validation.fieldErrors.targetBranch).toContain("Select a target branch");
    expect(validation.canSubmit).toBe(false);
  });

  test("treats loading model catalogs as pending instead of a missing-model runtime error", () => {
    const input = {
      ...baseInput(),
      selectedModelAvailable: false,
      isModelCatalogLoading: true,
    };
    const validation = validateWorkspaceSessionDraft(input);
    expect(validation.fieldErrors.runtime).toBeNull();
    expect(validation.sendBlockedReason).toBe("Loading models...");
    expect(validation.canSubmit).toBe(false);
  });
});
