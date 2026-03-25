import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  resolveInitialModalSelection,
  resolveSelectionForAgentChange,
  resolveSelectionForModelChange,
  resolveSelectionForRuntimeChange,
  resolveSelectionForVariantChange,
} from "./session-start-modal-selection";

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
      contextWindow: 200_000,
      outputLimit: 8_192,
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
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [
    {
      name: "spec-agent",
      mode: "primary",
      hidden: false,
    },
    {
      name: "build-agent",
      mode: "primary",
      hidden: false,
    },
  ],
};

const REPO_SETTINGS: RepoSettingsInput = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: null,
    build: {
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    },
    qa: null,
  },
};

describe("session-start-modal-selection", () => {
  test("resolveInitialModalSelection prefers a valid requested selection", () => {
    expect(
      resolveInitialModalSelection({
        catalog: CATALOG,
        repoSettings: REPO_SETTINGS,
        role: "spec",
        runtimeKind: "opencode",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "default",
          profileId: "build-agent",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });
  });

  test("resolveInitialModalSelection falls back to normalized role defaults", () => {
    expect(
      resolveInitialModalSelection({
        catalog: CATALOG,
        repoSettings: {
          ...REPO_SETTINGS,
          agentDefaults: {
            ...REPO_SETTINGS.agentDefaults,
            spec: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "legacy",
              profileId: "spec-agent",
            },
          },
        },
        role: "spec",
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("resolveSelectionForRuntimeChange keeps draft shape for missing role", () => {
    expect(
      resolveSelectionForRuntimeChange({
        activeRole: null,
        currentSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
        intentSelectedModel: null,
        repoSettings: REPO_SETTINGS,
        runtimeKind: "alternate-runtime",
      }),
    ).toEqual({
      runtimeKind: "alternate-runtime",
      providerId: "openai",
      modelId: "gpt-5",
    });
  });

  test("resolveSelectionForAgentChange derives a base selection when no draft exists", () => {
    expect(
      resolveSelectionForAgentChange({
        activeRole: "spec",
        catalog: CATALOG,
        currentSelection: null,
        intentSelectedModel: null,
        profileId: "build-agent",
        repoSettings: REPO_SETTINGS,
        runtimeKind: "opencode",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    });
  });

  test("resolveSelectionForModelChange preserves the current profile", () => {
    expect(
      resolveSelectionForModelChange({
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

  test("resolveSelectionForVariantChange is a no-op without a selection", () => {
    expect(
      resolveSelectionForVariantChange({
        currentSelection: null,
        variant: "high",
      }),
    ).toBeNull();
  });
});
