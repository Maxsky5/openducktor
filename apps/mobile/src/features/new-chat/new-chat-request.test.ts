import { describe, expect, test } from "bun:test";
import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSessionCreateInput,
} from "@openducktor/contracts";
import { buildWorkspaceSessionCreateInput } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-create-input";
import { WORKTREE_NAME_RULE } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import {
  buildNewChatRequest,
  type NewChatForm,
  type NewChatModelStateInput,
  newChatFormEdited,
  newChatModelState,
} from "./new-chat-request";

/** The worktree of a request that creates a new worktree, or null for another location. */
const worktreeOf = (input: WorkspaceSessionCreateInput | null) =>
  input?.location === "local_worktree" ? input.worktree : null;

const SELECTION = { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt-5" };

const TARGET = { remote: "origin", branch: "main" };

// The shared form builds its request with the same values, as `useWorkspaceSessionCreate` does.
const form = (overrides: Partial<NewChatForm> = {}): NewChatForm => {
  const fields: Omit<NewChatForm, "input"> = {
    workspaceId: "workspace-1",
    name: "",
    roleId: "none",
    location: "local_repo_root",
    worktree: { mode: "from_name", name: "", branchName: null },
    targetBranch: TARGET,
    targetPending: false,
    selection: SELECTION,
    model: { kind: "ready" },
    rolesReady: true,
    branches: null,
    branchPrefix: "odt",
    hostError: null,
    ...overrides,
  };
  return {
    ...fields,
    input: buildWorkspaceSessionCreateInput({
      workspaceId: fields.workspaceId,
      name: fields.name,
      roleId: fields.roleId,
      location: fields.location,
      worktree: fields.worktree,
      existingWorktree: null,
      targetBranch: fields.targetBranch,
      selection: fields.selection,
      selectedModelAvailable: fields.model.kind === "ready",
      rolesReady: fields.rolesReady,
      availableBranches: fields.branches,
    }),
  };
};

describe("buildNewChatRequest", () => {
  test("creates a current checkout chat with its name, model, and no role", () => {
    const request = buildNewChatRequest(form({ name: "Fix login" }));
    expect(request.input).toEqual({
      workspaceId: "workspace-1",
      runtimeKind: "codex",
      selectedModel: SELECTION,
      customAgentRoleId: null,
      location: "local_repo_root",
      manualTitle: "Fix login",
      targetBranch: TARGET,
    });
    expect(request.blockedReason).toBeNull();
    expect(request.worktreeSummary).toEqual({ directory: null, branch: null });
  });

  test("waits for the target branch, then asks for one when the location has none", () => {
    const loading = buildNewChatRequest(form({ targetBranch: null, targetPending: true }));
    expect(loading.input).toBeNull();
    expect(loading.blockedReason).toBe("Loading the target branch.");
    const missing = buildNewChatRequest(form({ targetBranch: null }));
    expect(missing.input).toBeNull();
    expect(missing.blockedReason).toBe("Choose a target branch.");
  });

  test("sends the chosen Custom Agent Role", () => {
    expect(buildNewChatRequest(form({ roleId: "role-1" })).input?.customAgentRoleId).toBe("role-1");
  });

  test("names the model problem next to the model and waits for the catalog", () => {
    const noDefault = buildNewChatRequest(form({ selection: null, model: { kind: "no_default" } }));
    expect(noDefault.input).toBeNull();
    expect(noDefault.fieldErrors.model).toBe(
      "This repository has no Default Model. Choose a model, or set a Default Model in the repository settings on the host.",
    );
    expect(noDefault.blockedReason).toBe("Fix the fields above to create the chat.");

    const settingsFailed = buildNewChatRequest(
      form({ selection: null, model: { kind: "settings_failed", message: "Host timed out." } }),
    );
    expect(settingsFailed.input).toBeNull();
    expect(settingsFailed.fieldErrors.model).toBe(
      "The repository settings did not load, so the Default Model is unknown. Host timed out. Choose a model, or close and open New Chat again.",
    );

    const missing = buildNewChatRequest(
      form({ model: { kind: "not_in_catalog", modelLabel: "gpt-5", runtimeLabel: "Codex" } }),
    );
    expect(missing.input).toBeNull();
    expect(missing.fieldErrors.model).toBe(
      "gpt-5 is not in the Codex model catalog. Choose another model.",
    );

    const loading = buildNewChatRequest(form({ model: { kind: "loading" } }));
    expect(loading.input).toBeNull();
    expect(loading.fieldErrors.model).toBeNull();
    expect(loading.blockedReason).toBe("Loading the model catalog.");
  });

  test("waits for the custom roles", () => {
    const request = buildNewChatRequest(form({ rolesReady: false }));
    expect(request.input).toBeNull();
    expect(request.blockedReason).toBe("Loading the custom roles.");
  });

  test("rejects a name over the title limit", () => {
    const request = buildNewChatRequest(
      form({ name: "x".repeat(WORKSPACE_SESSION_MANUAL_TITLE_LIMIT + 1) }),
    );
    expect(request.input).toBeNull();
    expect(request.fieldErrors.name).toBe(
      `Use at most ${WORKSPACE_SESSION_MANUAL_TITLE_LIMIT} characters.`,
    );
  });

  test("creates a worktree on a new branch from a safe name and the branch prefix", () => {
    const empty = buildNewChatRequest(form({ location: "local_worktree" }));
    expect(empty.input).toBeNull();
    expect(empty.blockedReason).toBe("Enter a worktree name.");

    const invalid = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_name", name: "-x", branchName: null },
      }),
    );
    expect(invalid.fieldErrors.worktreeName).toBe(WORKTREE_NAME_RULE);
    expect(invalid.input).toBeNull();

    const valid = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_name", name: "login flow", branchName: null },
      }),
    );
    expect(valid.input?.location).toBe("local_worktree");
    expect(worktreeOf(valid.input)).toEqual({
      mode: "from_name",
      name: "login-flow",
      branchName: null,
    });
    expect(valid.worktreeSummary).toEqual({ directory: "login-flow", branch: "odt/login-flow" });

    const badBranch = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_name", name: "login", branchName: "bad..branch" },
      }),
    );
    expect(badBranch.fieldErrors.branch).toBe("Enter a valid Git branch name.");
    expect(badBranch.input).toBeNull();
  });

  test("uses an existing branch only when no other worktree has it", () => {
    const branches = [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "busy", isCurrent: false, isRemote: false, worktreePath: "/worktrees/busy" },
      { name: "origin/main", isCurrent: false, isRemote: true },
    ];
    const loading = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_branch", name: "main", branchName: "" },
      }),
    );
    expect(loading.blockedReason).toBe("Loading the branches.");

    const unchosen = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_branch", name: "main", branchName: "" },
        branches,
      }),
    );
    expect(unchosen.blockedReason).toBe("Choose a local branch.");

    const busy = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_branch", name: "busy", branchName: "busy" },
        branches,
      }),
    );
    expect(busy.input).toBeNull();
    expect(busy.fieldErrors.branch).toBe(
      "This branch is already checked out at /worktrees/busy. Choose another branch or use Current checkout.",
    );

    const main = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_branch", name: "main", branchName: "main" },
        branches,
      }),
    );
    expect(worktreeOf(main.input)).toEqual({
      mode: "from_branch",
      name: "main",
      branchName: "main",
    });
    expect(main.worktreeSummary).toEqual({ directory: "main", branch: "main" });
  });

  test("shows the worktree error that the host reported", () => {
    const request = buildNewChatRequest(
      form({
        location: "local_worktree",
        worktree: { mode: "from_name", name: "taken", branchName: null },
        hostError: { field: "worktree.name", message: "A worktree with this name exists." },
      }),
    );
    expect(request.fieldErrors.worktreeName).toBe("A worktree with this name exists.");
  });
});

describe("newChatFormEdited", () => {
  const untouched = {
    name: "  ",
    roleId: "none",
    location: "local_repo_root",
    modelChanged: false,
  } as const;

  test("leaves an untouched form without a question", () => {
    expect(newChatFormEdited(untouched)).toBe(false);
  });

  test("asks before it drops a name, a role, a worktree, or a chosen model", () => {
    expect(newChatFormEdited({ ...untouched, name: "Fix login" })).toBe(true);
    expect(newChatFormEdited({ ...untouched, roleId: "reviewer" })).toBe(true);
    expect(newChatFormEdited({ ...untouched, location: "local_worktree" })).toBe(true);
    expect(newChatFormEdited({ ...untouched, modelChanged: true })).toBe(true);
  });
});

describe("newChatModelState", () => {
  const CATALOG = { models: [], defaultModelsByProvider: {} };
  const READY_RESOURCE = {
    catalog: CATALOG,
    isLoading: false,
    error: null,
    unavailableReason: null,
  };
  const state = (overrides: Partial<NewChatModelStateInput> = {}) =>
    newChatModelState({
      selection: SELECTION,
      defaultSelection: SELECTION,
      repoSettings: { pending: false, error: null },
      runtimeKind: "codex",
      runtimeKinds: ["codex"],
      resource: READY_RESOURCE,
      selectedModelFound: true,
      ...overrides,
    });

  test("is ready when the catalog has the selected model", () => {
    expect(state()).toEqual({ kind: "ready" });
  });

  test("waits for the repository settings when no model is chosen", () => {
    expect(state({ selection: null, repoSettings: { pending: true, error: null } })).toEqual({
      kind: "loading",
    });
    expect(
      state({ selection: null, repoSettings: { pending: false, error: "Host timed out." } }),
    ).toEqual({ kind: "settings_failed", message: "Host timed out." });
    expect(state({ selection: null, defaultSelection: null })).toEqual({ kind: "no_default" });
  });

  test("waits for the catalog read", () => {
    expect(state({ resource: null })).toEqual({ kind: "loading" });
    expect(state({ resource: { ...READY_RESOURCE, catalog: null, isLoading: true } })).toEqual({
      kind: "loading",
    });
  });

  test("names a runtime that the host does not offer", () => {
    expect(state({ runtimeKinds: ["opencode"] })).toEqual({
      kind: "runtime_unavailable",
      runtimeLabel: "Codex",
      reason: null,
    });
  });

  test("shows why a blocked runtime has no catalog, not a missing model", () => {
    const reason = "Codex runtime is disabled. Enable it in Settings > Runtimes.";
    const blocked = state({
      resource: { catalog: null, isLoading: false, error: null, unavailableReason: reason },
      selectedModelFound: false,
    });
    expect(blocked).toEqual({ kind: "runtime_unavailable", runtimeLabel: "Codex", reason });
    expect(buildNewChatRequest(form({ model: blocked })).fieldErrors.model).toBe(
      `${reason} Or choose a model of another runtime.`,
    );
  });

  test("reports a failed catalog read and a model that the catalog lacks", () => {
    expect(
      state({
        resource: { ...READY_RESOURCE, catalog: null, error: "Catalog read failed." },
        selectedModelFound: false,
      }),
    ).toEqual({ kind: "catalog_failed", message: "Catalog read failed." });
    expect(state({ selectedModelFound: false })).toEqual({
      kind: "not_in_catalog",
      modelLabel: "gpt-5",
      runtimeLabel: "Codex",
    });
  });
});
