import { renderWithWorkflow as render } from "@/test-utils/render-with-workflow";
import { expect, spyOn, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, screen, within } from "@testing-library/react";
import { act, useReducer } from "react";
import { toast } from "sonner";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import { REPOSITORY_SPEED_RESET_NOTICE } from "./repository-agent-selection";
import { RepositoryModelDefaultsFields } from "./repository-model-defaults-fields";

enableReactActEnvironment();

const codexCatalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "codex-model",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "codex-model",
      modelName: "Codex model",
      variants: ["low", "high"],
    },
  ],
  defaultModelsByProvider: {},
};

const renderNamingFields = ({
  presentation,
  selectedRepoConfig = { agentDefaults: {} },
  onUpdateSelectedRepoConfig = () => {},
}: {
  presentation: "settings" | "creation";
  selectedRepoConfig?: WorkspaceModelDefaultsDraft;
  onUpdateSelectedRepoConfig?: (
    updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
  ) => void;
}) =>
  render(
    <RepositoryModelDefaultsFields
      presentation={presentation}
      selectedRepoConfig={selectedRepoConfig}
      availableRuntimeDefinitions={[CODEX_RUNTIME_DESCRIPTOR]}
      catalogResources={[
        {
          runtimeKind: "codex",
          catalog: codexCatalog,
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
      loadingState={{
        isLoadingRuntimeDefinitions: false,
        isLoadingCatalog: false,
        isLoadingSettings: false,
        isSaving: false,
      }}
      runtimeDefinitionsError={null}
      modelWarnings={[]}
      getCatalogForRuntime={() => codexCatalog}
      isCatalogLoadingForRuntime={() => false}
      onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      onUpdateSelectedRepoAgentDefault={() => {}}
      onClearSelectedRepoAgentDefault={() => {}}
      onUpdateSelectedRepoDefaultModel={() => {}}
      onClearSelectedRepoDefaultModel={() => {}}
      {...(presentation === "settings" && {
        showNamingModel: true,
      })}
    />,
  );

const namingCard = (): HTMLElement => {
  // The heading sits in the title group, inside the header row of the card.
  const card = screen.getByRole("heading", { name: "Naming model" }).parentElement?.parentElement
    ?.parentElement;
  if (!card) throw new Error("Naming model card is missing");
  return card;
};

test("settings show a naming model with no agent profile or speed, and creation hides it", async () => {
  const creation = renderNamingFields({ presentation: "creation" });
  expect(screen.queryByRole("heading", { name: "Naming model" })).toBeNull();
  creation.unmount();

  renderNamingFields({
    presentation: "settings",
    selectedRepoConfig: {
      agentDefaults: {},
      namingModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "codex-model",
        variant: "low",
      },
    },
  });
  const card = namingCard();
  expect(
    within(card).getByText(
      "Writes short session titles and branch names. When empty, task branches use the task title, and new chat worktrees need a name.",
    ),
  ).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Clear" }).hasAttribute("disabled")).toBe(false);
  await act(async () => {
    fireEvent.click(within(card).getByRole("button", { name: /Select model, Codex, Codex model/ }));
  });
  expect(screen.getByRole("slider", { name: "Effort" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Agent profile" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Speed" })).toBeNull();
});

test("the naming model picker saves a runtime and model without a profile", async () => {
  let draft: WorkspaceModelDefaultsDraft = { agentDefaults: {} };
  renderNamingFields({
    presentation: "settings",
    onUpdateSelectedRepoConfig: (updater) => {
      draft = updater(draft);
    },
  });
  await act(async () => {
    fireEvent.click(
      within(namingCard()).getByRole("button", { name: "Select model, Select a model" }),
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Select Codex model model" }));
  });

  expect(draft.namingModel).toEqual({
    runtimeKind: "codex",
    providerId: "openai",
    modelId: "codex-model",
    variant: "low",
  });
  expect(draft.namingModel).not.toHaveProperty("profileId");
});

test("clearing the naming model removes it from the draft", async () => {
  let draft: WorkspaceModelDefaultsDraft = {
    agentDefaults: {},
    namingModel: { runtimeKind: "codex", providerId: "openai", modelId: "codex-model" },
  };
  renderNamingFields({
    presentation: "settings",
    selectedRepoConfig: draft,
    onUpdateSelectedRepoConfig: (updater) => {
      draft = updater(draft);
    },
  });
  await act(async () => {
    fireEvent.click(within(namingCard()).getByRole("button", { name: "Clear" }));
  });

  expect(draft.namingModel).toBeUndefined();
});

test("role model pickers show only runtimes that support that role", async () => {
  const workspaceOnlyOpenCode: RuntimeDescriptor = {
    ...OPENCODE_RUNTIME_DESCRIPTOR,
    capabilities: {
      ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["workspace"],
      },
    },
  };
  const catalogs: AgentModelCatalog[] = [
    {
      runtime: workspaceOnlyOpenCode,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "OpenCode model",
          variants: [],
        },
      ],
      defaultModelsByProvider: {},
    },
    {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "codex-model",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "codex-model",
          modelName: "Codex model",
          variants: [],
        },
      ],
      defaultModelsByProvider: {},
    },
  ];
  render(
    <RepositoryModelDefaultsFields
      selectedRepoConfig={{ agentDefaults: {} }}
      availableRuntimeDefinitions={[workspaceOnlyOpenCode, CODEX_RUNTIME_DESCRIPTOR]}
      catalogResources={catalogs.map((catalog) => ({
        runtimeKind: catalog.runtime!.kind,
        catalog,
        isLoading: false,
        unavailableReason: null,
        isEnabled: true,
        error: null,
        retry: async () => {},
      }))}
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
      loadingState={{
        isLoadingRuntimeDefinitions: false,
        isLoadingCatalog: false,
        isLoadingSettings: false,
        isSaving: false,
      }}
      runtimeDefinitionsError={null}
      modelWarnings={[]}
      getCatalogForRuntime={(kind) =>
        catalogs.find((catalog) => catalog.runtime?.kind === kind) ?? null
      }
      isCatalogLoadingForRuntime={() => false}
      onUpdateSelectedRepoConfig={() => {}}
      onUpdateSelectedRepoAgentDefault={() => {}}
      onClearSelectedRepoAgentDefault={() => {}}
      onUpdateSelectedRepoDefaultModel={() => {}}
      onClearSelectedRepoDefaultModel={() => {}}
    />,
  );

  const qaCard = screen.getByText("QA").parentElement?.parentElement;
  if (!qaCard) throw new Error("QA card is missing");
  await act(async () => {
    fireEvent.click(within(qaCard).getByRole("button", { name: "Select model, Select a model" }));
  });

  expect(screen.getByRole("button", { name: "Select Codex model model" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select OpenCode model model" })).toBeNull();
});

test("emits the speed reset notice when switching a role default through a reducer-backed updater", async () => {
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

  function ReducerBackedRoleDefaults() {
    const [draft, dispatch] = useReducer(
      (
        state: WorkspaceModelDefaultsDraft,
        updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
      ) => updater(state),
      {
        agentDefaults: {
          spec: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5-fast",
            variant: "high",
            profileId: "",
            speed: "priority",
          },
        },
      },
    );
    return (
      <RepositoryModelDefaultsFields
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
        loadingState={{
          isLoadingRuntimeDefinitions: false,
          isLoadingCatalog: false,
          isLoadingSettings: false,
          isSaving: false,
        }}
        runtimeDefinitionsError={null}
        modelWarnings={[]}
        getCatalogForRuntime={() => speedCodexCatalog}
        isCatalogLoadingForRuntime={() => false}
        onUpdateSelectedRepoConfig={(updater) => dispatch(updater)}
        onUpdateSelectedRepoAgentDefault={() => {}}
        onClearSelectedRepoAgentDefault={() => {}}
        onUpdateSelectedRepoDefaultModel={() => {}}
        onClearSelectedRepoDefaultModel={() => {}}
      />
    );
  }

  try {
    render(<ReducerBackedRoleDefaults />);
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
