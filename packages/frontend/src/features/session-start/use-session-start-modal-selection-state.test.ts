import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useState } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useSessionStartModalSelectionState } from "./use-session-start-modal-selection-state";

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

type FixtureProps = {
  defaultSelection: AgentModelSelection | null;
  isSelectionActive: boolean;
  selectedRuntimeKind: RuntimeKind | null;
};

const useSelectionStateFixture = ({
  defaultSelection,
  isSelectionActive,
  selectedRuntimeKind,
}: FixtureProps) => {
  const [selection, setSelection] = useState<AgentModelSelection | null>(null);
  return useSessionStartModalSelectionState({
    catalog: CATALOG,
    defaultSelection,
    intentSelectedModel: null,
    isSelectionActive,
    selection,
    selectedRuntimeKind,
    selectedStartMode: "fresh",
    setSelection,
  });
};

const createHarness = (defaultSelection: AgentModelSelection | null) =>
  createHookHarness(useSelectionStateFixture, {
    defaultSelection,
    isSelectionActive: true,
    selectedRuntimeKind: "opencode",
  });

describe("useSessionStartModalSelectionState", () => {
  test("opens with the workflow default when the catalog contains it", async () => {
    const harness = createHarness({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    try {
      await harness.mount();

      expect(harness.getLatest().resolvedSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("opens with no selection when the catalog lacks the workflow default", async () => {
    const harness = createHarness({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "retired-model",
    });

    try {
      await harness.mount();

      expect(harness.getLatest().resolvedSelection).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("uses an explicit user pick after the catalog rejects the workflow default", async () => {
    const harness = createHarness({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "retired-model",
    });

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleSelectPair(
          { runtimeKind: "opencode", providerId: "anthropic", modelId: "claude-sonnet" },
          CATALOG,
        );
      });

      expect(harness.getLatest().resolvedSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        variant: "default",
        profileId: "spec-agent",
      });
    } finally {
      await harness.unmount();
    }
  });
});
