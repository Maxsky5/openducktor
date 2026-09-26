import { afterEach, describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, type WorkspaceRecord } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type {
  WorkspaceModelDefaultsDraft,
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
  addWorkspace,
  saveWorkspaceModelDefaults = async () => {},
  onSuccess = () => {},
  modelSurface = surface,
}: {
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<WorkspaceRecord>;
  saveWorkspaceModelDefaults?: (
    workspaceId: string,
    draft: WorkspaceModelDefaultsDraft,
  ) => Promise<void>;
  onSuccess?: () => void;
  modelSurface?: WorkspaceCreationModelSurface;
}): ReactElement {
  const creation = useWorkspaceCreation({
    workspaces: [],
    addWorkspace,
    saveWorkspaceModelDefaults,
    onSuccess,
  });
  return (
    <QueryProvider useIsolatedClient>
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
    </QueryProvider>
  );
}

const renderHarness = (props: Parameters<typeof CreationHarness>[0]) => {
  const view = render(<CreationHarness {...props} />);
  views.add(view);
  return view;
};

const advanceToModels = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
  await screen.findByLabelText("Workspace ID");
  fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
  await screen.findByRole("button", { name: "Open repository" });
};

describe("workspace creation stages", () => {
  test("keeps identity changes while moving back and forward without creating a workspace", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    renderHarness({ addWorkspace });
    fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
    await screen.findByLabelText("Workspace ID");
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText<HTMLInputElement>("Workspace name").value).toBe("Renamed");
    expect(screen.getByLabelText<HTMLInputElement>("Workspace ID").value).toBe("renamed");
    expect(addWorkspace).not.toHaveBeenCalled();
  });

  test("blocks blank names on the information stage", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    renderHarness({ addWorkspace });
    fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
    await screen.findByLabelText("Workspace name");
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toContain("Workspace name cannot be blank.");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Continue to models" }).disabled,
    ).toBe(true);
    expect(addWorkspace).not.toHaveBeenCalled();
  });

  test("creates only on the final action and saves a selected model before success", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    const saveWorkspaceModelDefaults = mock(async () => {});
    const onSuccess = mock(() => {});
    renderHarness({ addWorkspace, saveWorkspaceModelDefaults, onSuccess });
    await advanceToModels();
    expect(addWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(addWorkspace).toHaveBeenCalledTimes(1);
    expect(saveWorkspaceModelDefaults).toHaveBeenCalledWith("repo", {
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "o3",
        variant: "low",
        profileId: "",
      },
      agentDefaults: {},
    });
  });

  test("keeps a created workspace and retries only the failed model save", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    let saves = 0;
    const saveWorkspaceModelDefaults = mock(async () => {
      saves += 1;
      if (saves === 1) throw new Error("Model save failed");
    });
    const onSuccess = mock(() => {});
    renderHarness({ addWorkspace, saveWorkspaceModelDefaults, onSuccess });
    await advanceToModels();
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    expect(await screen.findByText("Model save failed")).toBeTruthy();
    expect(screen.getByTestId("created-id").textContent).toBe("repo");
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(addWorkspace).toHaveBeenCalledTimes(1);
    expect(saveWorkspaceModelDefaults).toHaveBeenCalledTimes(2);
  });

  test("resets identity and models when the repository changes", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    const saveWorkspaceModelDefaults = mock(async () => {});
    renderHarness({ addWorkspace, saveWorkspaceModelDefaults });
    await advanceToModels();
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose other" }));
    expect(await screen.findByLabelText<HTMLInputElement>("Workspace ID")).toHaveProperty(
      "value",
      "other",
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to models" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() =>
      expect(addWorkspace).toHaveBeenCalledWith({
        workspaceId: "other",
        workspaceName: "other",
        repoPath: "/other",
      }),
    );
    expect(saveWorkspaceModelDefaults).not.toHaveBeenCalled();
  });

  test("rejects a selected model when its runtime catalog is unavailable", async () => {
    const addWorkspace = mock(async (input: WorkspaceSelectionOperationsInput) => record(input));
    const unavailableSurface: WorkspaceCreationModelSurface = {
      ...surface,
      catalogResources: [
        { ...surface.catalogResources[0]!, isEnabled: false, error: "Runtime failed" },
      ],
      getCatalogForRuntime: () => null,
      errors: ["Runtime failed"],
    };
    renderHarness({ addWorkspace, modelSurface: unavailableSurface });
    await advanceToModels();
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    expect(await screen.findByText(/Default Model is unavailable/)).toBeTruthy();
    expect(addWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
    await waitFor(() => expect(addWorkspace).toHaveBeenCalledTimes(1));
  });
});
