import { renderWithWorkflow as render } from "@/test-utils/render-with-workflow";
import { expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, screen, within } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
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

test("settings show a naming model with no agent profile, and creation hides it", () => {
  const creation = renderNamingFields({ presentation: "creation" });
  expect(screen.queryByRole("heading", { name: "Naming model" })).toBeNull();
  creation.unmount();

  renderNamingFields({ presentation: "settings" });
  const card = namingCard();
  expect(
    within(card).getByText(
      "Writes short session titles and branch names. Leave empty to keep the current names.",
    ),
  ).toBeTruthy();
  expect(within(card).queryByText("Agent profile")).toBeNull();
  expect(within(card).getByText("Effort")).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Clear" }).hasAttribute("disabled")).toBe(true);
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
