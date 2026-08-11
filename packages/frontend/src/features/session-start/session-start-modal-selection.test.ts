import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  resolveInitialModelSelection,
  resolveModelSelectionForModelChange,
  resolveModelSelectionForRuntimeChange,
  resolveModelSelectionForVariantChange,
} from "@/features/agent-chat-composer/model-selection/model-selection-state";
import type { RepoSettingsInput } from "@/types/state-slices";
import { roleDefaultSelectionFor } from "./session-start-selection";

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
    },
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["default"],
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [
    { name: "spec-agent", mode: "primary", hidden: false },
    { name: "build-agent", mode: "primary", hidden: false },
  ],
};

const REPO_SETTINGS: RepoSettingsInput = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: null,
    build: null,
    qa: null,
  },
};

describe("session-start-modal-selection", () => {
  test("passes a workflow role default into the generic initial selection", () => {
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: roleDefaultSelectionFor(REPO_SETTINGS, "spec"),
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });
  });

  test("falls back from a missing requested model to the validated workflow default", () => {
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: roleDefaultSelectionFor(REPO_SETTINGS, "spec"),
        runtimeKind: "opencode",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "missing",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });
  });

  test("uses the workflow default after a runtime change", () => {
    expect(
      resolveModelSelectionForRuntimeChange({
        currentSelection: null,
        defaultSelection: roleDefaultSelectionFor(REPO_SETTINGS, "spec"),
        selectedModel: null,
        runtimeKind: "opencode",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });
  });

  test("changes model and keeps the selected runtime profile", () => {
    expect(
      resolveModelSelectionForModelChange({
        catalog: CATALOG,
        currentSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "spec-agent",
        },
        modelKey: "anthropic/claude-sonnet",
        runtimeKind: "opencode",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("does not create a variant-only selection", () => {
    expect(
      resolveModelSelectionForVariantChange({
        catalog: CATALOG,
        currentSelection: null,
        variant: "high",
      }),
    ).toBeNull();
  });
});
