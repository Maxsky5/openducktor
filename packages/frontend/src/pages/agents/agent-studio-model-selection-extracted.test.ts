import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentSlashCommand } from "@openducktor/core";
import { resolveModelSelectionOptions } from "./agent-studio-model-selection-options";
import {
  resolveRuntimePromptInputSupport,
  resolveSelectionForNewSession,
} from "./agent-studio-model-selection-resolution";
import { mergeSlashCommands } from "./use-agent-studio-slash-commands";

const selectedSessionModel: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "high",
  profileId: "build-agent",
};

const catalogWithProfile: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["default", "high"],
    },
  ],
  defaultModelsByProvider: {},
  profiles: [{ name: "build-agent", mode: "primary", hidden: false, color: "#f59e0b" }],
};

describe("Agent Studio model selection extracted helpers", () => {
  test("gives reusable prompt slash commands precedence case-insensitively", () => {
    const runtimeCommands: AgentSlashCommand[] = [
      { id: "runtime-review", trigger: "Review", title: "Runtime review", hints: [] },
      { id: "runtime-compact", trigger: "compact", title: "Runtime compact", hints: [] },
    ];
    const reusableCommands: AgentSlashCommand[] = [
      { id: "prompt-review", trigger: "review", title: "Prompt review", hints: [] },
    ];

    expect(
      mergeSlashCommands(runtimeCommands, reusableCommands).map((command) => command.id),
    ).toEqual(["runtime-compact", "prompt-review"]);
  });

  test("keeps current-session options when catalog metadata is unavailable", () => {
    const options = resolveModelSelectionOptions({
      selectionCatalog: { ...catalogWithProfile, models: [], profiles: [] },
      selectedModelSelection: selectedSessionModel,
    });

    expect(options.agentOptions).toEqual([
      expect.objectContaining({
        value: "build-agent",
        label: "build-agent",
        description: "Current session agent",
      }),
    ]);
    expect(options.modelOptions).toEqual([
      {
        value: "anthropic/claude-sonnet",
        label: "claude-sonnet",
        description: "anthropic (current session model)",
      },
    ]);
    expect(options.variantOptions).toEqual([{ value: "high", label: "high" }]);
  });

  test("derives catalog-backed colors and runtime prompt capabilities", () => {
    expect(
      resolveModelSelectionOptions({
        selectionCatalog: catalogWithProfile,
        selectedModelSelection: selectedSessionModel,
      }).activeSessionAgentColors,
    ).toEqual({ "build-agent": "#f59e0b" });

    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        readyActiveSessionRuntimeKind: null,
        composerRuntimeKind: "opencode",
      }),
    ).toEqual({ runtimeSupportsSlashCommands: true, supportsFileSearch: true });
  });

  test("resolves new-session selection in draft, default, then catalog order", () => {
    expect(
      resolveSelectionForNewSession({
        draftSelection: null,
        roleDefaultSelectionForComposer: selectedSessionModel,
        selectionCatalog: catalogWithProfile,
        fallbackCatalogSelection: null,
      }),
    ).toBe(selectedSessionModel);
  });
});
