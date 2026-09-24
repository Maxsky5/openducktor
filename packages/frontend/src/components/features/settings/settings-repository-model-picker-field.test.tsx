import { expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { RepositoryModelPickerField } from "./settings-repository-model-picker-field";

enableReactActEnvironment();

const catalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT Five",
      variants: [],
    },
  ],
  defaultModelsByProvider: {},
};

const favoriteState: ModelPickerFavoriteState = {
  favorites: [],
  isLoading: false,
  readError: null,
  isMutationPending: false,
  mutationError: null,
  canMutate: true,
  toggleFavorite: () => {},
  retryRead: () => {},
  retryMutation: () => {},
};

const resource = (
  overrides: Partial<RuntimeModelCatalogQueryResource> = {},
): RuntimeModelCatalogQueryResource => ({
  runtimeKind: "opencode",
  catalog,
  isFetching: false,
  isEnabled: true,
  error: null,
  retry: async () => {},
  ...overrides,
});

test("selects a cached settings model while the catalog refreshes", async () => {
  const onSelect = mock(() => {});
  render(
    <RepositoryModelPickerField
      runtimeDefinitions={[OPENCODE_RUNTIME_DESCRIPTOR]}
      catalogResources={[resource({ isFetching: true })]}
      value={null}
      favoriteState={favoriteState}
      isReadOnly={false}
      isLoadingCatalog={false}
      onSelect={onSelect}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
  });
  expect(screen.getByText("Refreshing OpenCode models...")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Select GPT Five model" }));
  });

  expect(onSelect).toHaveBeenCalledWith(
    { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    catalog,
  );
});

test("does not show retained settings models after a catalog failure", async () => {
  const onSelect = mock(() => {});
  render(
    <RepositoryModelPickerField
      runtimeDefinitions={[OPENCODE_RUNTIME_DESCRIPTOR]}
      catalogResources={[resource({ error: "Catalog refresh failed" })]}
      value={null}
      favoriteState={favoriteState}
      isReadOnly={false}
      isLoadingCatalog={false}
      onSelect={onSelect}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
  });

  expect(screen.getByRole("alert").textContent).toContain("Catalog refresh failed");
  expect(screen.queryByRole("button", { name: "Select GPT Five model" })).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});
