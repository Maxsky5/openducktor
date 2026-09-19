import { expect, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionCreateResult,
  repoConfigSchema,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { act, type ComponentProps } from "react";
import { createQueryClient } from "@/lib/query-client";
import { gitQueryKeys } from "@/state/queries/git";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import {
  ChecksStateContext,
  RuntimeDefinitionsContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createRuntimeCatalogFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { WorkspaceSessionCreateDialog } from "./workspace-session-create-dialog";

function renderCreation(
  create: (input: WorkspaceSessionCreateInput) => Promise<WorkspaceSessionCreateResult>,
  onClose = () => {},
  onCreated: () => void = () => {
    throw new Error("Unexpected successful creation");
  },
  clientOverrides: Partial<HostClient> = {},
) {
  const snapshot = createSettingsSnapshotFixture();
  const catalog: AgentModelCatalog = {
    runtime: OPENCODE_RUNTIME_DESCRIPTOR,
    models: [
      {
        id: "provider/model",
        providerId: "provider",
        providerName: "Provider",
        modelId: "model",
        modelName: "Test model",
        variants: ["low", "high"],
      },
    ],
    defaultModelsByProvider: {},
    profiles: [{ name: "runtime-profile", mode: "primary", hidden: false }],
  };
  const workspaceState: ComponentProps<typeof WorkspaceStateContext>["value"] = {
    isSwitchingWorkspace: false,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    workspaces: [],
    closedWorkspaces: [],
    incompleteRemovals: [],
    activeWorkspace: null,
    branches: [],
    activeBranch: null,
    addWorkspace: async () => {},
    selectWorkspace: async () => {},
    closeWorkspace: async () => {},
    removeWorkspace: async () => {},
    reopenWorkspace: async () => {},
    resolveWorkspacePath: async () => {
      throw new Error("Unexpected path resolution");
    },
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("Unexpected settings read");
    },
    saveRepoSettings: async () => {
      throw new Error("Unexpected settings save");
    },
    loadSettingsSnapshot: async () => snapshot,
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    saveSettingsSnapshot: async () => {},
    saveAgentModelFavorites: async () => snapshot,
  };
  const definitions: ComponentProps<typeof RuntimeDefinitionsContext>["value"] = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => createRuntimeCatalogFixture({ models: catalog }),
    loadRepoRuntimeFileSearch: async () => [],
  };
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceGetSettingsSnapshot: async () => snapshot,
        workspaceGetRepoConfig: async () =>
          repoConfigSchema.parse({
            workspaceId: "a",
            workspaceName: "A",
            repoPath: "/repo",
            branchPrefix: "odt",
          }),
        gitGetBranches: async () => [
          { name: "main", isRemote: false, isCurrent: true, worktreePath: "/repo" },
          {
            name: "feature/occupied",
            isRemote: false,
            isCurrent: false,
            worktreePath: "/other checkout",
          },
          { name: "feature/existing", isRemote: false, isCurrent: false },
          { name: "origin/remote-only", isRemote: true, isCurrent: false },
        ],
        customAgentRoleList: async () => [
          { id: "alpha", name: "Alpha", systemPrompt: "Alpha prompt" },
          { id: "zeta", name: "Zeta", systemPrompt: "Zeta prompt" },
        ],
        workspaceSessionCreate: create,
        ...clientOverrides,
      },
    }),
  );
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceStateContext value={workspaceState}>
        <ChecksStateContext
          value={{
            runtimeCheck: null,
            taskStoreCheck: null,
            runtimeCheckFailureKind: null,
            taskStoreCheckFailureKind: null,
            isLoadingChecks: false,
            refreshChecks: async () => {},
          }}
        >
          <RuntimeDefinitionsContext value={definitions}>
            <WorkspaceSessionCreateDialog
              workspace={{ workspaceId: "A", workspaceName: "A", repoPath: "/repo" }}
              onClose={onClose}
              onCreated={onCreated}
            />
          </RuntimeDefinitionsContext>
        </ChecksStateContext>
      </WorkspaceStateContext>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

async function selectModel(view: ReturnType<typeof renderCreation>) {
  fireEvent.click(view.getByRole("button", { name: "Select model, Select a model" }));
  const choice = await view.findByRole(
    "button",
    { name: "Select Test model model" },
    { timeout: 800 },
  );
  fireEvent.click(choice);
  await waitFor(
    () =>
      expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(
        false,
      ),
    { timeout: 800 },
  );
}

test("matches the task modal width, separates footer actions and disables name autocomplete", () => {
  const view = renderCreation(async () => {
    throw new Error("Unexpected creation");
  });
  try {
    expect(view.getByRole("dialog").classList.contains("sm:max-w-2xl")).toBe(true);
    expect(view.getByLabelText("Name optional").getAttribute("autocomplete")).toBe("off");
    const cancel = view.getByRole("button", { name: "Cancel" });
    const create = view.getByRole("button", { name: "Create chat" });
    expect(cancel.parentElement).toBe(create.parentElement);
    expect(cancel.parentElement?.firstElementChild).toBe(cancel);
    expect(cancel.parentElement?.classList.contains("justify-between")).toBe(true);
    expect(cancel.parentElement?.classList.contains("sm:justify-between")).toBe(true);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("omits checkout help text for both work locations", () => {
  const view = renderCreation(async () => {
    throw new Error("Unexpected creation");
  });
  try {
    expect(view.queryByText("Changes apply directly to this workspace checkout.")).toBeNull();
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    expect(view.queryByText("Uncommitted changes stay in the current checkout.")).toBeNull();
    expect(view.getByLabelText("Worktree name")).not.toBeNull();
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("uses the task modal label-to-control gap for every form field", async () => {
  const view = renderCreation(async () => {
    throw new Error("Unexpected creation");
  });
  try {
    await selectModel(view);
    const fields = [
      view.getByLabelText("Name optional").parentElement,
      view.getByText("Runtime and model").parentElement,
      view.getByText("Effort", { selector: "label" }).parentElement,
      view.getByText("Runtime profile", { selector: "label" }).parentElement,
      view.getByText("Custom role", { exact: false, selector: "label" }).parentElement,
    ];
    for (const field of fields) {
      expect(field?.classList.contains("grid")).toBe(true);
      expect(field?.classList.contains("gap-1.5")).toBe(true);
      expect(field?.classList.contains("space-y-2")).toBe(false);
    }
    const roleSelect = view.getByRole("button", { name: "Custom role optional" });
    const manageRoles = view.getByRole("button", { name: "Manage roles" });
    expect(manageRoles.classList.contains("h-9")).toBe(true);
    expect(roleSelect.parentElement).toBe(manageRoles.parentElement);
    expect(roleSelect.parentElement?.classList.contains("grid-cols-[minmax(0,1fr)_auto]")).toBe(
      true,
    );
    expect(roleSelect.compareDocumentPosition(manageRoles) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("an ordinary creation failure retains inputs, re-enables the form and does not report success", async () => {
  let rejectCreation!: (cause: Error) => void;
  let created = 0;
  let closed = 0;
  const view = renderCreation(
    () =>
      new Promise<never>((_resolve, reject) => {
        rejectCreation = reject;
      }),
    () => {
      closed += 1;
    },
    () => {
      created += 1;
    },
  );
  try {
    await selectModel(view);
    const name = view.getByLabelText("Name optional");
    fireEvent.change(name, { target: { value: "Retained session" } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    });
    await act(async () => {
      rejectCreation(new Error("Runtime startup failed: executable missing"));
    });
    await view.findByRole("alert", {}, { timeout: 800 });
    expect(view.getByRole("alert").textContent).toBe("Runtime startup failed: executable missing");
    expect(view.getByDisplayValue("Retained session") !== null).toBe(true);
    expect(name.closest("fieldset")?.disabled).toBe(false);
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(false);
    expect(
      view
        .getByRole("button", { name: "Select model, OpenCode, Test model" })
        .getAttribute("aria-disabled"),
    ).toBe("false");
    expect(created).toBe(0);
    expect(closed).toBe(0);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("creation keeps Role, Runtime Profile, Effort and location separate and blocks duplicate pending input", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  let closed = 0;
  const view = renderCreation(
    async (input) => {
      requests.push(input);
      return new Promise<never>(() => {});
    },
    () => {
      closed += 1;
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("button", { name: "Custom role optional" }));
    expect(view.getAllByRole("option").map((entry) => entry.textContent?.trim())).toEqual([
      "No role",
      "Alpha",
      "Zeta",
    ]);
    fireEvent.click(view.getByRole("option", { name: "Alpha" }));
    fireEvent.click(view.getByRole("button", { name: "Runtime profile" }));
    fireEvent.click(view.getByRole("option", { name: "runtime-profile" }));
    fireEvent.click(view.getByRole("button", { name: "Effort" }));
    fireEvent.click(view.getByRole("option", { name: "high" }));
    fireEvent.change(view.getByLabelText("Name optional"), { target: { value: "My session" } });
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    });
    await waitFor(() => expect(requests.length).toBe(1), { timeout: 800 });
    expect(requests[0]).toEqual({
      workspaceId: "A",
      runtimeKind: "opencode",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "provider",
        modelId: "model",
        variant: "high",
        profileId: "runtime-profile",
      },
      customAgentRoleId: "alpha",
      location: "local_worktree",
      worktree: { mode: "from_name", name: "my-feature", branchName: null },
      manualTitle: "My session",
    });
    const name = view.getByLabelText("Name optional");
    const fieldset = name.closest("fieldset");
    expect(fieldset?.disabled).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Select model, OpenCode, Test model" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.submit(name.closest("form")!);
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(requests.length).toBe(1);
    expect(closed).toBe(0);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("shows the repository Default Model read failure, keeps creation usable and retries", async () => {
  let readAttempts = 0;
  const view = renderCreation(
    async () => {
      throw new Error("Unexpected creation");
    },
    () => {},
    () => {
      throw new Error("Unexpected successful creation");
    },
    {
      workspaceGetRepoConfig: async () => {
        readAttempts += 1;
        if (readAttempts === 1) throw new Error("Settings file is unreadable.");
        return repoConfigSchema.parse({
          workspaceId: "a",
          workspaceName: "A",
          repoPath: "/repo",
          branchPrefix: "odt",
        });
      },
    },
  );
  try {
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("The repository Default Model could not load.");
    expect(alert.textContent).toContain("Settings file is unreadable.");
    expect(readAttempts).toBe(1);
    await selectModel(view);
    fireEvent.click(view.getByRole("button", { name: "Retry default model" }));
    await waitFor(() => expect(view.queryByRole("alert") === null).toBe(true), { timeout: 800 });
    expect(readAttempts).toBe(2);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("creates a worktree chat with one request and no confirmation step", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  let created = 0;
  const view = renderCreation(
    async (input) => {
      requests.push(input);
      return {
        session: {
          id: "created-chat",
          runtimeKind: input.runtimeKind,
          externalSessionId: null,
          executionTarget: {
            kind: "local_worktree",
            workingDirectory: "/worktrees/my-feature",
            branchName: "odt/my-feature",
            worktreeState: "present",
          },
          selectedModel: input.selectedModel,
          roleSnapshot: null,
          generatedTitle: null,
          manualTitle: null,
          createdAt: 1000,
          updatedAt: 1000,
          archivedAt: null,
        },
      };
    },
    () => {},
    () => {
      created += 1;
    },
  );
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(created).toBe(1), { timeout: 800 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("confirmUncommittedChanges");
    expect(requests[0]?.worktree).toEqual({
      mode: "from_name",
      name: "my-feature",
      branchName: null,
    });
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByRole("button", { name: "Create without uncommitted changes" })).toBeNull();
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
  // CI runs this render-heavy flow beside the host suite on 3-4 vCPUs.
}, 2_500);

test("requires a safe worktree name and sends an optional custom branch from Advanced", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    const create = view.getByRole("button", { name: "Create chat" });
    expect(create.hasAttribute("disabled")).toBe(true);
    expect(view.queryByLabelText("Branch name optional")).toBeNull();
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "../escape" } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "review-ui" } });
    await view.findByText("odt/review-ui", {}, { timeout: 800 });
    fireEvent.click(view.getByRole("button", { name: "Advanced" }));
    const branch = view.getByLabelText("Branch name optional");
    expect(branch.getAttribute("placeholder")).toBe("odt/review-ui");
    fireEvent.change(branch, { target: { value: "bad branch" } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(branch, { target: { value: "feature/custom-ui" } });
    fireEvent.click(create);
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.worktree).toEqual({
      mode: "from_name",
      name: "review-ui",
      branchName: "feature/custom-ui",
    });
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
  // CI runs this render-heavy flow beside the host suite on 3-4 vCPUs.
}, 2_500);

test("Existing branch accepts slash-separated worktree names and submits a safe directory name", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    const tabList = view.getByRole("tablist", { name: "Worktree creation mode" });
    expect(tabList.classList.contains("bg-muted")).toBe(true);
    expect(tabList.classList.contains("border-b")).toBe(false);
    expect(view.getByRole("tab", { name: "New branch" }).className).toContain(
      "data-[state=active]:bg-selected-control",
    );
    expect(view.getByRole("tab", { name: "New branch" })).not.toBeNull();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Existing branch" }), {
      button: 0,
      ctrlKey: false,
    });
    const selector = await view.findByRole("button", { name: "Existing branch" }, { timeout: 800 });
    await waitFor(() => expect(selector.hasAttribute("disabled")).toBe(false), { timeout: 800 });
    fireEvent.click(selector);
    expect(view.queryByRole("option", { name: /origin\/remote-only/ })).toBeNull();
    for (const name of [/main/, /feature\/occupied/]) {
      const option = view.getByRole("option", { name });
      expect(option.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(option);
      expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(true);
    }
    fireEvent.click(view.getByRole("option", { name: /feature\/existing/ }));
    expect(view.getByDisplayValue("feature-existing")).not.toBeNull();
    expect(view.queryByRole("button", { name: "Advanced" })).toBeNull();
    fireEvent.change(view.getByLabelText("Worktree name"), {
      target: { value: "feat/add-facebook-login" },
    });
    expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(false);
    expect(view.getByText("feat-add-facebook-login")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.worktree).toEqual({
      mode: "from_branch",
      name: "feat-add-facebook-login",
      branchName: "feature/existing",
    });
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
  // CI runs this render-heavy flow beside the host suite on 3-4 vCPUs.
}, 2_500);

test("blocks submission when refreshed data shows the selected branch is now checked out", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Unexpected creation");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.mouseDown(view.getByRole("tab", { name: "Existing branch" }), {
      button: 0,
      ctrlKey: false,
    });
    const selector = await view.findByRole("button", { name: "Existing branch" });
    await waitFor(() => expect(selector.hasAttribute("disabled")).toBe(false));
    fireEvent.click(selector);
    fireEvent.click(view.getByRole("option", { name: /feature\/existing/ }));
    const create = view.getByRole("button", { name: "Create chat" });
    expect(create.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      view.queryClient.setQueryData(gitQueryKeys.branches("/repo"), [
        {
          name: "feature/existing",
          isCurrent: false,
          isRemote: false,
          worktreePath: "/another checkout",
        },
      ]);
    });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(true));
    expect(view.getByRole("alert").textContent).toContain(
      "already checked out at /another checkout",
    );
    const form = create.closest("form");
    if (!form) throw new Error("Creation form is missing");
    fireEvent.submit(form);
    expect(requests).toEqual([]);
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(["worktree.name", "worktree.branchName"] as const)(
  "shows host validation next to %s and clears it after a worktree edit",
  async (field) => {
    const message =
      field === "worktree.name"
        ? "Worktree directory already exists. Choose another name."
        : "Branch already exists. Choose another name or use Existing branch.";
    const requests: WorkspaceSessionCreateInput[] = [];
    const view = renderCreation(async (input) => {
      requests.push(input);
      throw new HostInvokeError(message, { kind: "workspace_session_validation", field });
    });
    try {
      await selectModel(view);
      fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
      const name = view.getByLabelText("Worktree name");
      fireEvent.change(name, { target: { value: "collision" } });
      fireEvent.click(view.getByRole("button", { name: "Create chat" }));
      const alert = await view.findByRole("alert");
      expect(alert.textContent).toBe(message);
      expect(alert.id).toBe(
        field === "worktree.name"
          ? "workspace-session-worktree-name-error"
          : "workspace-session-branch-error",
      );
      if (field === "worktree.name") expect(name.getAttribute("aria-invalid")).toBe("true");
      fireEvent.change(name, { target: { value: "another-name" } });
      expect(view.queryByRole("alert")).toBeNull();
      expect(view.getByRole("button", { name: "Create chat" }).hasAttribute("disabled")).toBe(
        false,
      );
      expect(requests).toHaveLength(1);
    } finally {
      view.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("returning to Current checkout omits all worktree options", async () => {
  const requests: WorkspaceSessionCreateInput[] = [];
  const view = renderCreation(async (input) => {
    requests.push(input);
    throw new Error("Keep form open");
  });
  try {
    await selectModel(view);
    fireEvent.click(view.getByRole("radio", { name: /New worktree/ }));
    fireEvent.change(view.getByLabelText("Worktree name"), { target: { value: "my-feature" } });
    fireEvent.click(view.getByRole("radio", { name: /Current checkout/ }));
    fireEvent.click(view.getByRole("button", { name: "Create chat" }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]?.location).toBe("local_repo_root");
    expect(requests[0]?.worktree).toBeUndefined();
  } finally {
    view.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});
