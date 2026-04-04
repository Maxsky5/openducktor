import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const OPENCODE_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
} satisfies RuntimeDescriptor;

const CODEX_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "codex",
  label: "Codex",
  description: "Codex runtime",
} satisfies RuntimeDescriptor;

const selectedRepoConfig: RepoConfig = {
  defaultRuntimeKind: "codex",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {
    spec: undefined,
    planner: undefined,
    build: undefined,
    qa: undefined,
  },
};

describe("RepositoryAgentsSection", () => {
  let RepositoryAgentsSection: typeof import("./settings-repository-agents-section").RepositoryAgentsSection;

  beforeAll(async () => {
    mock.module("@/components/features/agents", () => ({
      AgentRuntimeCombobox: (props: Record<string, unknown>) =>
        createElement("agent-runtime-combobox", props),
      toModelGroupsByProvider: () => [],
      toModelOptions: () => [{ value: "anthropic/claude-opus", label: "Claude Opus" }],
      toPrimaryAgentOptions: () => [{ value: "planner-agent", label: "Planner Agent" }],
    }));
    mock.module("@/components/ui/combobox", () => ({
      Combobox: (props: Record<string, unknown>) => createElement("mock-combobox", props),
    }));

    ({ RepositoryAgentsSection } = await import("./settings-repository-agents-section"));
  });

  afterAll(async () => {
    await restoreMockedModules([
      ["@/components/features/agents", () => import("@/components/features/agents")],
      ["@/components/ui/combobox", () => import("@/components/ui/combobox")],
    ]);
  });

  test("uses the inherited repo default runtime catalog for roles without explicit overrides", () => {
    const catalog: AgentModelCatalog = {
      models: [
        {
          id: "anthropic/claude-opus",
          providerId: "anthropic",
          providerName: "Anthropic",
          modelId: "claude-opus",
          modelName: "Claude Opus",
          variants: ["extended"],
        },
      ],
      defaultModelsByProvider: { anthropic: "claude-opus" },
      profiles: [{ name: "planner-agent", mode: "primary" }],
    };
    const getCatalogForRuntime = mock((_runtimeKind: string): AgentModelCatalog => catalog);
    const getCatalogErrorForRuntime = mock(() => null);
    const isCatalogLoadingForRuntime = mock(() => false);

    const rendered = render(
      createElement(RepositoryAgentsSection, {
        selectedRepoConfig,
        runtimeDefinitions: [OPENCODE_DESCRIPTOR, CODEX_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        isLoadingCatalog: false,
        isLoadingSettings: false,
        isSaving: false,
        runtimeDefinitionsError: null,
        getCatalogForRuntime,
        getCatalogErrorForRuntime,
        isCatalogLoadingForRuntime,
        onUpdateSelectedRepoConfig: () => {},
        onUpdateSelectedRepoAgentDefault: () => {},
        onClearSelectedRepoAgentDefault: () => {},
      }),
    );

    try {
      expect(getCatalogForRuntime).toHaveBeenCalledTimes(4);
      for (const [runtimeKind] of getCatalogForRuntime.mock.calls as Array<[string]>) {
        expect(runtimeKind).toBe("codex");
      }
      expect(getCatalogErrorForRuntime).toHaveBeenCalledTimes(4);
      expect(isCatalogLoadingForRuntime).toHaveBeenCalledTimes(4);
    } finally {
      rendered.unmount();
    }
  });
});
