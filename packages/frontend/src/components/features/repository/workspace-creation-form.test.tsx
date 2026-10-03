import { beforeAll, afterAll } from "bun:test";
import {
  installLocalOnlyProviderSetup,
  localOnlyWorkspaceDetails,
} from "@/test-utils/workspace-provider-setup-fixture";
let releaseProviderFixture: (() => void) | undefined;
beforeAll(() => {
  releaseProviderFixture = installLocalOnlyProviderSetup();
});
afterAll(() => releaseProviderFixture?.());
import { afterEach, describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, type WorkspaceRecord } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { hostClient } from "@/lib/host-client";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type {
  WorkspaceStateContextValue,
  WorkspaceSelectionOperationsInput,
} from "@/types/state-slices";
import {
  WorkspaceCreationBackAction,
  WorkspaceCreationFields,
  WorkspaceCreationSubmitAction,
} from "./workspace-creation-form";
import { useWorkspaceCreation } from "./use-workspace-creation";
import type { WorkspaceCreationModelSurface } from "./use-workspace-creation-models";

const views = new Set<ReturnType<typeof render>>();
afterEach(() => {
  for (const view of views) view.unmount();
  views.clear();
});

const record = (input: WorkspaceSelectionOperationsInput): WorkspaceRecord => ({
  workspaceId: input.workspaceId,
  workspaceName: input.workspaceName,
  repoPath: input.repoPath,
  abbreviation: input.abbreviation ?? null,
  tileColor: input.tileColor ?? null,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
});

const catalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/o3",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "o3",
      modelName: "o3",
      variants: ["low", "high"],
    },
  ],
  defaultModelsByProvider: { openai: "o3" },
  profiles: [],
};

const surface: WorkspaceCreationModelSurface = {
  availableRuntimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
  catalogResources: [
    {
      runtimeKind: "codex",
      catalog,
      isFetching: false,
      isEnabled: true,
      error: null,
      retry: async () => {},
    },
  ],
  favoriteState: {
    favorites: [],
    isLoading: false,
    readError: null,
    isMutationPending: false,
    mutationError: null,
    canMutate: false,
    toggleFavorite: () => {},
    retryRead: () => {},
    retryMutation: () => {},
  },
  isLoadingRuntimeDefinitions: false,
  isLoadingCatalog: false,
  errors: [],
  getCatalogForRuntime: () => catalog,
  isCatalogLoadingForRuntime: () => false,
  retry: async () => {},
};

function CreationHarness({
  commit,
  onSuccess = () => {},
  modelSurface = surface,
}: {
  commit: WorkspaceStateContextValue["commitWorkspaceProviderSetup"];
  onSuccess?: () => void;
  modelSurface?: WorkspaceCreationModelSurface;
}): ReactElement {
  const creation = useWorkspaceCreation({
    workspaces: [],
    commitWorkspaceProviderSetup: commit,
    onSuccess,
  });
  return (
    <>
      <button type="button" onClick={() => void creation.confirmRepo("/repo")}>
        Choose repo
      </button>
      <button type="button" onClick={() => void creation.confirmRepo("/other")}>
        Choose other
      </button>
      <button
        type="button"
        onClick={() =>
          creation.updateModelDraft((current) => ({
            ...current,
            defaultModel: {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: "o3",
              variant: "low",
              profileId: "",
            },
          }))
        }
      >
        Choose model
      </button>
      <p data-testid="created-id">{creation.createdWorkspaceId ?? ""}</p>
      <WorkspaceCreationFields controller={creation} modelSurface={modelSurface} />
      <WorkspaceCreationBackAction controller={creation} />
      <WorkspaceCreationSubmitAction controller={creation} modelSurface={modelSurface} />
    </>
  );
}
const renderHarness = (props: Parameters<typeof CreationHarness>[0]) => {
  const view = render(
    <QueryProvider useIsolatedClient>
      <CreationHarness {...props} />
    </QueryProvider>,
  );
  views.add(view);
  return view;
};
const outcome = (
  input: Parameters<WorkspaceStateContextValue["commitWorkspaceProviderSetup"]>[0],
) => ({
  workspace: record(localOnlyWorkspaceDetails(input)),
  registrationSaved: true,
  settingsSaved: true,
  credentialsSaved: true,
  phase: "complete" as const,
  error: null,
});
const chooseRepo = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
  await screen.findByRole("button", { name: "Skip Git provider setup" });
};
const skipProvider = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Skip Git provider setup" }));
  await screen.findByLabelText("Workspace ID");
};
const advanceToModels = async () => {
  await chooseRepo();
  await skipProvider();
  fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
  await screen.findByRole("button", { name: "Open repository" });
};

describe("workspace creation", () => {
  test("keeps cleanup failure visible before reopening a closed workspace", async () => {
    const closed = {
      ...record({ workspaceId: "closed", workspaceName: "Closed", repoPath: "/closed" }),
      isActive: false,
    };
    const reopen = mock(async () => {});
    const success = mock(() => {});
    let allowChange = false;
    const h = createHookHarness(
      () =>
        useWorkspaceCreation({
          workspaces: [],
          commitWorkspaceProviderSetup: mock(async (input) => outcome(input)),
          resolveRepoPath: async (path) =>
            path === "/closed"
              ? { kind: "closed", workspace: closed }
              : { kind: "new", repoPath: path },
          onReopenClosedWorkspace: reopen,
          onSuccess: success,
          runWorkspaceChange: async (change) => {
            if (!allowChange) return false;
            await change();
            return true;
          },
        }),
      {},
      { wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider> },
    );
    await h.mount();
    const originalDiscard = hostClient.workspaceProviderSetupDiscard;
    let failCleanup = true;
    let ownedId: string | undefined;
    hostClient.workspaceProviderSetupDiscard = async (ref) => {
      if (ref.setupId === ownedId && failCleanup) throw new Error("Cleanup unavailable");
      return originalDiscard(ref);
    };
    try {
      await h.run(async (state) => {
        await state.confirmRepo("/new-reopen-test");
      });
      ownedId = h.getLatest().provider.session?.setupId;
      await h.run((state) => state.back());
      await h.run(async (state) => {
        await state.confirmRepo("/closed").catch(() => {});
      });
      expect(reopen).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
      expect(h.getLatest().provider.error).toContain("Cleanup unavailable");
      expect(h.getLatest().provider.session?.setupId).toBe(ownedId);
      failCleanup = false;
      await h.run(async (state) => {
        await state.confirmRepo("/closed");
      });
      expect(reopen).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
      expect(h.getLatest().repoPath).toBe("");
      expect(h.getLatest().provider.session).toBeNull();
      allowChange = true;
      await h.run(async (state) => {
        await state.confirmRepo("/closed");
      });
      expect(reopen).toHaveBeenCalledTimes(1);
      expect(success).toHaveBeenCalledTimes(1);
      expect(h.getLatest().provider.session).toBeNull();
    } finally {
      hostClient.workspaceProviderSetupDiscard = originalDiscard;
      await h.unmount();
    }
  });
  test("clears the abandoned path and starts a new setup after returning from the chooser", async () => {
    const h = createHookHarness(
      () =>
        useWorkspaceCreation({
          workspaces: [],
          commitWorkspaceProviderSetup: mock(async (input) => outcome(input)),
        }),
      {},
      { wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider> },
    );
    await h.mount();
    try {
      await h.run(async (state) => {
        await state.confirmRepo("/abandoned-test");
      });
      const oldId = h.getLatest().provider.session?.setupId;
      await h.run(async (state) => {
        expect(await state.abandon()).toBe(true);
      });
      expect(h.getLatest().repoPath).toBe("");
      expect(h.getLatest().stage).toBe("repository");
      await h.run((state) => {
        state.openPicker();
      });
      await h.run((state) => {
        state.closePicker();
        state.reviewRepo();
      });
      expect(h.getLatest().stage).toBe("repository");
      await h.run(async (state) => {
        await state.confirmRepo("/abandoned-test");
      });
      expect(h.getLatest().provider.session?.setupId).not.toBe(oldId);
      await h.run(async (state) => {
        await state.skipProvider();
      });
      expect(h.getLatest().stage).toBe("information");
    } finally {
      await h.unmount();
    }
  });
  test("keeps provider setup optional and retains details across navigation", async () => {
    const commit = mock(async (input) => outcome(input));
    renderHarness({ commit });
    await chooseRepo();
    expect(screen.getByLabelText<HTMLInputElement>("Selected repository path").value).toBe("/repo");
    await skipProvider();
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
    expect(screen.getAllByText("Effort")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText<HTMLInputElement>("Workspace name").value).toBe("Renamed");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await skipProvider();
    expect(screen.getByLabelText<HTMLInputElement>("Workspace ID").value).toBe("renamed");
    expect(commit).not.toHaveBeenCalled();
  });
  test("submits workspace details and current models only on the final action", async () => {
    const commit = mock(async (input) => outcome(input));
    const onSuccess = mock(() => {});
    renderHarness({ commit, onSuccess });
    await advanceToModels();
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "repo",
      workspaceName: "repo",
      agentDefaults: {},
      defaultModel: { runtimeKind: "codex", providerId: "openai", modelId: "o3", variant: "low" },
    });
  });
  test("retains a partial workspace and retries the same setup", async () => {
    let calls = 0;
    const commit = mock(async (input) => ({
      ...outcome(input),
      phase: ++calls === 1 ? ("credentials" as const) : ("complete" as const),
      error: calls === 1 ? "Workspace saved. Credential transfer failed. Retry." : null,
    }));
    const onSuccess = mock(() => {});
    renderHarness({ commit, onSuccess });
    await advanceToModels();
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await screen.findByText(/Credential transfer failed/);
    expect(screen.getByTestId("created-id").textContent).toBe("repo");
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(commit.mock.calls[1]?.[0].setupId).toBe(commit.mock.calls[0]?.[0].setupId);
  });
  test("blocks blank names and unavailable selected models before saving", async () => {
    const commit = mock(async (input) => outcome(input));
    renderHarness({
      commit,
      modelSurface: { ...surface, catalogResources: [], getCatalogForRuntime: () => null },
    });
    await chooseRepo();
    await skipProvider();
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toContain("Workspace name cannot be blank");
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await screen.findByText(/Default Model is unavailable/);
    expect(commit).not.toHaveBeenCalled();
  });
});
