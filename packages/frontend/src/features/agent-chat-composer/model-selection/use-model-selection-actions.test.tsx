import { describe, expect, mock, test } from "bun:test";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { toast } from "sonner";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useModelSelectionActions } from "./use-model-selection-actions";

type HookArgs = Parameters<typeof useModelSelectionActions>[0];

const loadedClaudeSession: AgentSessionIdentity = {
  externalSessionId: "claude-session-1",
  runtimeKind: "claude",
  workingDirectory: "/repo",
};

const claudeSelection: AgentModelSelection = {
  runtimeKind: "claude",
  providerId: "claude",
  modelId: "claude-opus-4-6",
  variant: "high",
  profileId: "orchestrator",
};

const claudeCatalog: AgentModelCatalog = {
  models: [
    {
      id: "claude/claude-opus-4-6",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-opus-4-6",
      modelName: "Claude Opus 4.6",
      variants: ["low", "medium", "high", "xhigh", "max"],
      liveSessionUpdates: {
        profile: false,
        variants: ["low", "medium", "high", "xhigh"],
      },
    },
  ],
  defaultModelsByProvider: {
    claude: "claude-opus-4-6",
  },
};

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  loadedSessionIdentity: loadedClaudeSession,
  updateAgentSessionModel: mock(async () => {}),
  applyDraftSelection: mock(() => {}),
  selectedModelSelection: claudeSelection,
  selectionCatalog: claudeCatalog,
  selectedRuntimeKind: "claude",
  ...overrides,
});

const createHarness = (initialProps: HookArgs) =>
  createHookHarness(useModelSelectionActions, initialProps);

describe("useModelSelectionActions", () => {
  test("blocks live profile changes when model metadata disallows them", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const harness = createHarness(createBaseProps({ updateAgentSessionModel }));

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectAgentProfile("planner");
    });

    expect(updateAgentSessionModel).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("blocks live variant changes when model metadata disallows them", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const harness = createHarness(createBaseProps({ updateAgentSessionModel }));

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectVariant("max");
    });

    expect(updateAgentSessionModel).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("allows supported live Claude effort changes", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const harness = createHarness(createBaseProps({ updateAgentSessionModel }));

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectVariant("xhigh");
    });

    expect(updateAgentSessionModel).toHaveBeenCalledWith(loadedClaudeSession, {
      ...claudeSelection,
      variant: "xhigh",
    });
    await harness.unmount();
  });

  test("uses the loaded session runtime for active-session model changes", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const harness = createHarness(
      createBaseProps({
        selectedModelSelection: null,
        selectedRuntimeKind: "opencode",
        updateAgentSessionModel,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectModel("claude/claude-opus-4-6");
    });

    expect(updateAgentSessionModel).toHaveBeenCalledWith(loadedClaudeSession, {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-opus-4-6",
      variant: "low",
    });
    await harness.unmount();
  });

  test("surfaces live model update failures", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;
    const updateAgentSessionModel = mock(async () => {
      throw new Error("live update failed");
    });
    const harness = createHarness(createBaseProps({ updateAgentSessionModel }));

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleSelectVariant("xhigh");
      });
      await harness.waitFor(() => toastError.mock.calls.length === 1);

      expect(toastError).toHaveBeenCalledWith("Failed to update model", {
        description: "live update failed",
      });
    } finally {
      toast.error = originalToastError;
      await harness.unmount();
    }
  });
});
