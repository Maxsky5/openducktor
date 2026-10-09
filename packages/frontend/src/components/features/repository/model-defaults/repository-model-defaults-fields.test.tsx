import { expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { RepositoryModelDefaultsFields } from "./repository-model-defaults-fields";

enableReactActEnvironment();

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
        isFetching: false,
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
