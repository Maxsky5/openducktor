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
  test.each(["partial result", "rejection", "complete result"] as const)(
    "discards an unmounted setup after the commit returns a %s",
    async (failure) => {
      const pending = Promise.withResolvers<void>();
      let ownedId: string | undefined;
      const commit = mock(async (input) => {
        ownedId = input.setupId;
        const result = outcome(input);
        await pending.promise;
        if (failure === "rejection") throw new Error("Commit failed");
        if (failure === "complete result") return result;
        return { ...result, phase: "credentials" as const, error: "Credential transfer failed" };
      });
      const success = mock(() => {});
      const h = createHookHarness(
        () =>
          useWorkspaceCreation({
            workspaces: [],
            commitWorkspaceProviderSetup: commit,
            onSuccess: success,
          }),
        {},
        { wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider> },
      );
      const discard = hostClient.workspaceProviderSetupDiscard;
      const cleanup = mock(discard);
      hostClient.workspaceProviderSetupDiscard = (ref) =>
        ref.setupId === ownedId ? cleanup(ref) : discard(ref);
      let submission: Promise<void> | undefined;
      await h.mount();
      try {
        await h.run(async (state) => {
          await state.confirmRepo(`/unmounted-commit-${failure.replaceAll(" ", "-")}`);
        });
        await h.run(async (state) => {
          await state.skipProvider();
        });
        await h.run((state) => state.next());
        await h.run((state) => {
          submission = state.submit();
        });
        await h.waitFor(() => commit.mock.calls.length === 1);
        await h.unmount();
        expect(cleanup).not.toHaveBeenCalled();
        pending.resolve();
        await submission;
        await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1), { timeout: 200 });
        expect(success).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
        await submission;
        await h.unmount();
        hostClient.workspaceProviderSetupDiscard = discard;
      }
    },
  );
  test("checks a detected provider before Continue and checks again after edits", async () => {
    const detect = hostClient.workspaceProviderSetupDetect;
    const status = hostClient.workspaceProviderSetupStatus;
    const reads = mock(async () => ({
      health: {
        providerId: "github" as const,
        enabled: true,
        available: true,
        executablePath: "/bin/gh",
        version: null,
        account: null,
        authenticated: true,
        repositoryMappingValid: true,
      },
      connection: null,
    }));
    let ownedId: string | undefined;
    hostClient.workspaceProviderSetupDetect = async (ref) =>
      ref.setupId === ownedId
        ? {
            outcome: "detected",
            candidates: [
              {
                remoteNames: ["origin"],
                config: {
                  id: "github",
                  enabled: true,
                  autoDetected: true,
                  repository: { host: "github.com", owner: "owner", name: "repo" },
                },
              },
            ],
          }
        : detect(ref);
    hostClient.workspaceProviderSetupStatus = async (ref) => {
      if (ref.setupId !== ownedId) return status(ref);
      return reads();
    };
    const h = createHookHarness(
      () =>
        useWorkspaceCreation({
          workspaces: [],
          commitWorkspaceProviderSetup: mock(async (input) => outcome(input)),
        }),
      {},
      { wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider> },
    );
    // Capture only this setup so other parallel tests keep their own host fake.
    const begin = hostClient.workspaceProviderSetupBegin;
    hostClient.workspaceProviderSetupBegin = async (input) => {
      const ref = await begin(input);
      if (input.repoPath === "/early-provider-check") ownedId = ref.setupId;
      return ref;
    };
    await h.mount();
    try {
      await h.run(async (state) => {
        await state.confirmRepo("/early-provider-check");
      });
      await h.waitFor((state) => !state.provider.detecting && state.provider.pending === null);
      expect(reads).toHaveBeenCalledTimes(1);
      await h.waitFor((state) => state.provider.status?.health?.available === true);
      expect(h.getLatest().stage).toBe("provider");
      await h.run(async (state) => {
        await state.continueProvider();
      });
      expect(h.getLatest().stage).toBe("information");
      expect(reads).toHaveBeenCalledTimes(1);
      await h.run((state) => {
        state.back();
      });
      await h.run((state) => {
        state.provider.update((draft) => ({
          ...draft,
          github: { ...draft.github, owner: "edited" },
        }));
      });
      await h.waitFor((state) => state.provider.pending === null);
      expect(h.getLatest().provider.status).toBeNull();
      reads.mockImplementationOnce(async () => {
        throw new Error("Repository access failed");
      });
      await h.run(async (state) => {
        await state.continueProvider();
      });
      expect(reads).toHaveBeenCalledTimes(2);
      expect(h.getLatest().stage).toBe("provider");
      expect(h.getLatest().provider.error).toContain("Repository access failed");
      await h.run(async (state) => {
        await state.continueProvider();
      });
      expect(reads).toHaveBeenCalledTimes(3);
      expect(h.getLatest().stage).toBe("information");
    } finally {
      await h.unmount();
      hostClient.workspaceProviderSetupBegin = begin;
      hostClient.workspaceProviderSetupDetect = detect;
      hostClient.workspaceProviderSetupStatus = status;
    }
  });
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
    expect(screen.getByLabelText("Selected repository path").textContent).toBe("/repo");
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
  test("keeps provider selection on its step until Continue", async () => {
    const commit = mock(async (input) => outcome(input));
    renderHarness({ commit });
    await chooseRepo();
    fireEvent.click(screen.getByRole("radio", { name: "GitHub" }));
    await screen.findByRole("switch", { name: "Enable GitHub" });
    fireEvent.click(screen.getByRole("radio", { name: "No provider" }));
    expect(screen.getByRole("radio", { name: "No provider" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("Workspace name")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Continue to workspace information" })
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to workspace information" }));
    await screen.findByLabelText("Workspace name");
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
  test.each(["commit reply", "acknowledgement", "acknowledgement reply"] as const)(
    "finishes creation after a lost %s without losing setup ownership",
    async (failure) => {
      let ownedId: string | undefined;
      let failCommit = failure === "commit reply";
      let failAcknowledgement = failure !== "commit reply";
      const commit = mock(async (input) => {
        const result = outcome(input);
        if (failCommit) {
          failCommit = false;
          throw new Error("Commit reply lost");
        }
        return result;
      });
      const success = mock(() => {});
      const h = createHookHarness(
        () =>
          useWorkspaceCreation({
            workspaces: [],
            commitWorkspaceProviderSetup: commit,
            onSuccess: success,
          }),
        {},
        { wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider> },
      );
      const discard = hostClient.workspaceProviderSetupDiscard;
      const acknowledge = mock(async (ref) => {
        if (failAcknowledgement) {
          failAcknowledgement = false;
          if (failure === "acknowledgement reply") await discard(ref);
          throw new Error("Acknowledgement unavailable");
        }
        return discard(ref);
      });
      hostClient.workspaceProviderSetupDiscard = (ref) =>
        ref.setupId === ownedId ? acknowledge(ref) : discard(ref);
      await h.mount();
      try {
        await h.run(async (state) => {
          await state.confirmRepo(`/completion-${failure.replaceAll(" ", "-")}`);
        });
        ownedId = h.getLatest().provider.session?.setupId;
        await h.run(async (state) => {
          await state.skipProvider();
        });
        await h.run((state) => state.next());
        await h.run(async (state) => {
          await state.submit();
        });
        expect(success).not.toHaveBeenCalled();
        expect(h.getLatest().provider.session?.setupId).toBe(ownedId);
        expect(h.getLatest().error).toContain(
          failure === "commit reply" ? "Commit reply lost" : "Acknowledgement unavailable",
        );
        if (failure !== "commit reply") {
          expect(h.getLatest().createdWorkspaceId).toBeTruthy();
          await h.run((state) => state.back());
          expect(h.getLatest().stage).toBe("models");
        }
        await h.run(async (state) => {
          await state.submit();
        });
        expect(success).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledTimes(failure === "commit reply" ? 2 : 1);
        expect(acknowledge).toHaveBeenCalledTimes(failure === "commit reply" ? 1 : 2);
        expect(h.getLatest().provider.session).toBeNull();
        expect(h.getLatest().error).toBeNull();
      } finally {
        await h.unmount();
        hostClient.workspaceProviderSetupDiscard = discard;
      }
    },
  );
  test("waits for acknowledgement before opening and retries a failed open without committing again", async () => {
    let ownedId: string | undefined;
    const commit = mock(async (input) => {
      ownedId = input.setupId;
      return outcome(input);
    });
    const onSuccess = mock((): void => {
      throw new Error("Opening unavailable");
    });
    const discard = hostClient.workspaceProviderSetupDiscard;
    const acknowledgement = Promise.withResolvers<void>();
    hostClient.workspaceProviderSetupDiscard = async (ref) => {
      if (ref.setupId === ownedId) await acknowledgement.promise;
      await discard(ref);
    };
    try {
      renderHarness({ commit, onSuccess });
      await advanceToModels();
      fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
      await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
      expect(onSuccess).not.toHaveBeenCalled();
      acknowledgement.resolve();
      await screen.findByText(/Opening unavailable/);
      onSuccess.mockImplementation(() => {});
      fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
      expect(commit).toHaveBeenCalledTimes(1);
    } finally {
      acknowledgement.resolve();
      hostClient.workspaceProviderSetupDiscard = discard;
    }
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
