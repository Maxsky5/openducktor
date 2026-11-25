import { renderWithWorkflow as render } from "@/test-utils/render-with-workflow";
import { describe, expect, spyOn, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, screen, within } from "@testing-library/react";
import { act, useReducer } from "react";
import { toast } from "sonner";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import { REPOSITORY_SPEED_RESET_NOTICE } from "./repository-agent-selection";
import { RepositoryDefaultModelBlock } from "./repository-default-model";

enableReactActEnvironment();

const repoConfig: SettingsRepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { beforeWorktreeRemoval: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  promptAppends: {},
  agentDefaults: {},
};

const codexCatalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "codex-model-o3",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "o3",
      modelName: "o3",
      variants: ["low", "high"],
      speedLevels: [{ id: "fast", label: "Fast" }],
    },
  ],
  defaultModelsByProvider: { openai: "o3" },
  profiles: [],
};

const opencodeCatalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["low", "high"],
    },
  ],
  defaultModelsByProvider: { anthropic: "claude-sonnet" },
  profiles: [{ id: "build", label: "Builder", mode: "primary" }],
};

const favoriteState = {
  favorites: [],
  isLoading: false,
  unavailableReason: null,
  readError: null,
  isMutationPending: false,
  mutationError: null,
  canMutate: true,
  toggleFavorite: () => {},
  retryRead: () => {},
  retryMutation: () => {},
};

const renderBlock = ({
  descriptor,
  catalog,
  defaultModel,
  onUpdateField = () => {},
}: {
  descriptor: RuntimeDescriptor;
  catalog: AgentModelCatalog;
  defaultModel: SettingsRepoConfig["defaultModel"];
  onUpdateField?: (field: string, value: string) => void;
}) =>
  render(
    <RepositoryDefaultModelBlock
      selectedRepoConfig={{ ...repoConfig, defaultModel }}
      availableRuntimeDefinitions={[descriptor]}
      catalogResources={[
        {
          runtimeKind: descriptor.kind,
          catalog,
          isLoading: false,
          unavailableReason: null,
          isEnabled: true,
          error: null,
          retry: async () => {},
        },
      ]}
      favoriteState={favoriteState}
      loadingState={{ isLoadingSettings: false, isSaving: false }}
      getCatalogForRuntime={() => catalog}
      isCatalogLoadingForRuntime={() => false}
      onUpdateSelectedRepoConfig={() => {}}
      onUpdateSelectedRepoDefaultModel={onUpdateField}
      onClearSelectedRepoDefaultModel={() => {}}
    />,
  );

describe("RepositoryDefaultModelBlock", () => {
  test("explains runtime-managed effort inside the unified picker when unsupported", async () => {
    const descriptor: RuntimeDescriptor = {
      ...CODEX_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...CODEX_RUNTIME_DESCRIPTOR.capabilities,
        optionalSurfaces: {
          ...CODEX_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
          supportsVariants: false,
        },
      },
    };
    renderBlock({
      descriptor,
      catalog: codexCatalog,
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "o3",
        variant: "",
        profileId: "",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, o3/ }));
    });
    expect(screen.getByText("Effort is managed by the runtime.")).toBeTruthy();
  });

  test("hides agent profiles and shows speed slider for Codex defaults", async () => {
    const updated: Array<[string, string]> = [];
    renderBlock({
      descriptor: CODEX_RUNTIME_DESCRIPTOR,
      catalog: codexCatalog,
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "o3",
        variant: "low",
        profileId: "",
        speed: "fast",
      },
      onUpdateField: (field, value) => updated.push([field, value]),
    });

    const trigger = screen.getByRole("button", {
      name: /Select model, Codex, o3, Effort low, Speed Fast/,
    });
    expect(trigger.textContent).toContain("Fast");
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(screen.queryByRole("region", { name: "Agent profile" })).toBeNull();
    const speedSlider = screen.getByRole("slider", { name: "Speed" });
    await act(async () => {
      fireEvent.keyDown(speedSlider, { key: "ArrowLeft" });
    });
    expect(updated).toEqual([["speed", ""]]);
  });

  test("shows OpenCode agent profiles inside the unified picker without speed", async () => {
    const updated: Array<[string, string]> = [];
    renderBlock({
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        variant: "high",
        profileId: "",
      },
      onUpdateField: (field, value) => updated.push([field, value]),
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Select model, OpenCode, Claude Sonnet/ }),
      );
    });
    expect(screen.queryByRole("slider", { name: "Speed" })).toBeNull();
    const profileSection = screen.getByRole("region", { name: "Agent profile" });
    await act(async () => {
      fireEvent.click(within(profileSection).getByRole("button", { name: "Profile" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Builder" }));
    });
    expect(updated).toEqual([["profileId", "build"]]);
  });

  test("prompts to select a model first when no default model is configured", async () => {
    renderBlock({
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "",
        modelId: "",
        variant: "",
        profileId: "",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });
    expect(screen.getByText("Select a model first to configure options.")).toBeTruthy();
  });

  test("emits the speed reset notice when switching default model through a reducer-backed updater", async () => {
    const infoSpy = spyOn(toast, "info").mockImplementation(() => "");
    const speedCodexCatalog: AgentModelCatalog = {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5-fast",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5-fast",
          modelName: "GPT-5 Fast",
          variants: ["high"],
          speedLevels: [{ id: "priority", label: "Fast" }],
        },
        {
          id: "openai/gpt-5-plain",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5-plain",
          modelName: "GPT-5 Plain",
          variants: ["high"],
          speedLevels: [],
        },
      ],
      defaultModelsByProvider: {},
    };

    function ReducerBackedDefaultModel() {
      const [draft, dispatch] = useReducer(
        (
          state: WorkspaceModelDefaultsDraft,
          updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
        ) => updater(state),
        {
          defaultModel: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5-fast",
            variant: "high",
            profileId: "",
            speed: "priority",
          },
          agentDefaults: {},
        },
      );
      return (
        <RepositoryDefaultModelBlock
          selectedRepoConfig={draft}
          availableRuntimeDefinitions={[CODEX_RUNTIME_DESCRIPTOR]}
          catalogResources={[
            {
              runtimeKind: "codex",
              catalog: speedCodexCatalog,
              isLoading: false,
              unavailableReason: null,
              isEnabled: true,
              error: null,
              retry: async () => {},
            },
          ]}
          favoriteState={{
            favorites: [],
            isLoading: false,
            readError: null,
            isMutationPending: false,
            mutationError: null,
            canMutate: true,
            toggleFavorite: () => {},
            retryRead: () => {},
            retryMutation: () => {},
          }}
          loadingState={{ isLoadingSettings: false, isSaving: false }}
          getCatalogForRuntime={() => speedCodexCatalog}
          isCatalogLoadingForRuntime={() => false}
          onUpdateSelectedRepoConfig={(updater) => dispatch(updater)}
          onUpdateSelectedRepoDefaultModel={() => {}}
          onClearSelectedRepoDefaultModel={() => {}}
        />
      );
    }

    try {
      render(<ReducerBackedDefaultModel />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, GPT-5 Fast/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select GPT-5 Plain model" }));
      });

      expect(infoSpy).toHaveBeenCalledWith(REPOSITORY_SPEED_RESET_NOTICE);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
