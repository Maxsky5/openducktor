import { describe, expect, mock, spyOn, test } from "bun:test";
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
      speedLevels: [{ id: "fast", label: "Fast" }],
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

const multiModelCatalog: AgentModelCatalog = {
  ...claudeCatalog,
  models: [
    { ...claudeCatalog.models[0]! },
    {
      ...claudeCatalog.models[0]!,
      id: "claude/claude-sonnet-4-6",
      modelId: "claude-sonnet-4-6",
      variants: ["medium", "high"],
      liveSessionUpdates: { profile: false, variants: ["medium", "high"] },
      speedLevels: [{ id: "fast", label: "Fast" }],
    },
  ],
};

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

  test("does not clear a loaded session when no profile selection can be resolved", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const harness = createHarness(
      createBaseProps({
        selectedModelSelection: null,
        selectionCatalog: null,
        updateAgentSessionModel,
      }),
    );

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
      state.handleSelectModelPair(
        {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "claude-opus-4-6",
        },
        claudeCatalog,
      );
    });

    expect(updateAgentSessionModel).toHaveBeenCalledWith(loadedClaudeSession, {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-opus-4-6",
      variant: "low",
    });
    await harness.unmount();
  });

  test("chooses a supported variant when changing a live session model", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const selectionCatalog: AgentModelCatalog = {
      ...claudeCatalog,
      models: [
        ...claudeCatalog.models,
        {
          id: "claude/claude-sonnet-4-6",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-sonnet-4-6",
          modelName: "Claude Sonnet 4.6",
          variants: ["max", "high"],
          liveSessionUpdates: {
            profile: false,
            variants: ["high"],
          },
        },
      ],
    };
    const harness = createHarness(
      createBaseProps({
        selectionCatalog,
        updateAgentSessionModel,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectModelPair(
        {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "claude-sonnet-4-6",
        },
        selectionCatalog,
      );
    });

    expect(updateAgentSessionModel).toHaveBeenCalledWith(loadedClaudeSession, {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      variant: "high",
      profileId: "orchestrator",
    });
    await harness.unmount();
  });

  test("blocks foreign runtime pairs for a loaded session", async () => {
    const updateAgentSessionModel = mock(async () => {});
    const harness = createHarness(createBaseProps({ updateAgentSessionModel }));

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectModelPair(
        { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
        {
          models: [
            {
              id: "openai/gpt-5",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "gpt-5",
              modelName: "GPT-5",
              variants: ["medium"],
            },
          ],
          defaultModelsByProvider: { openai: "gpt-5" },
        },
      );
    });

    expect(updateAgentSessionModel).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("applies an exact cross-runtime pair to a new-session draft", async () => {
    const applyDraftSelection = mock(() => {});
    const harness = createHarness(
      createBaseProps({
        loadedSessionIdentity: null,
        applyDraftSelection,
      }),
    );

    await harness.mount();
    await harness.run((state) => {
      state.handleSelectModelPair(
        { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
        {
          models: [
            {
              id: "openai/gpt-5",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "gpt-5",
              modelName: "GPT-5",
              variants: ["medium"],
            },
          ],
          defaultModelsByProvider: { openai: "gpt-5" },
        },
      );
    });

    expect(applyDraftSelection).toHaveBeenCalledWith({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "medium",
    });
    await harness.unmount();
  });

  test.each([
    { live: true, speed: "fast", expected: { ...claudeSelection, speed: "fast" } },
    { live: false, speed: "standard", expected: claudeSelection },
  ])("applies speed $speed to the selected model with live=$live", async (change) => {
    const updateAgentSessionModel = mock(async () => {});
    const applyDraftSelection = mock(() => {});
    const harness = createHarness(
      createBaseProps({
        loadedSessionIdentity: change.live ? loadedClaudeSession : null,
        selectedModelSelection: { ...claudeSelection, speed: "fast" },
        updateAgentSessionModel,
        applyDraftSelection,
      }),
    );

    await harness.mount();
    await harness.run((state) => state.handleSelectSpeed(change.speed));

    if (change.live)
      expect(updateAgentSessionModel).toHaveBeenCalledWith(loadedClaudeSession, change.expected);
    else expect(applyDraftSelection).toHaveBeenCalledWith(change.expected);
    await harness.unmount();
  });

  test("resets speed and notifies when the next model does not support it", async () => {
    const originalToastInfo = toast.info;
    const toastInfo = mock(() => "");
    toast.info = toastInfo;
    const updateAgentSessionModel = mock(async () => {});
    const selectionCatalog: AgentModelCatalog = {
      ...claudeCatalog,
      models: [
        { ...claudeCatalog.models[0]!, speedLevels: [{ id: "fast", label: "Fast" }] },
        { ...claudeCatalog.models[0]!, id: "claude/sonnet", modelId: "sonnet", speedLevels: [] },
      ],
    };
    const harness = createHarness(
      createBaseProps({
        selectedModelSelection: { ...claudeSelection, speed: "fast" },
        selectionCatalog,
        updateAgentSessionModel,
      }),
    );

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleSelectModelPair(
          { runtimeKind: "claude", providerId: "claude", modelId: "sonnet" },
          selectionCatalog,
        );
      });

      expect(updateAgentSessionModel).toHaveBeenCalledWith(
        loadedClaudeSession,
        expect.not.objectContaining({ speed: expect.anything() }),
      );
      expect(toastInfo).toHaveBeenCalledTimes(1);
    } finally {
      toast.info = originalToastInfo;
      await harness.unmount();
    }
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

  test.each([
    { setting: "effort", speedFirst: true },
    { setting: "effort", speedFirst: false },
    { setting: "model", speedFirst: true },
    { setting: "model", speedFirst: false },
  ])(
    "preserves overlapping speed and $setting changes with speedFirst=$speedFirst",
    async (change) => {
      const firstUpdate = Promise.withResolvers<void>();
      const updateAgentSessionModel = mock(async () => {
        if (updateAgentSessionModel.mock.calls.length === 1) await firstUpdate.promise;
      });
      const harness = createHarness(
        createBaseProps({ selectionCatalog: multiModelCatalog, updateAgentSessionModel }),
      );
      let speedChange = Promise.resolve();
      const changeSetting = (state: ReturnType<typeof useModelSelectionActions>) => {
        if (change.setting === "effort") state.handleSelectVariant("xhigh");
        else
          state.handleSelectModelPair(
            { runtimeKind: "claude", providerId: "claude", modelId: "claude-sonnet-4-6" },
            multiModelCatalog,
          );
      };

      try {
        await harness.mount();
        await harness.run((state) => {
          if (change.speedFirst) speedChange = state.handleSelectSpeed("fast");
          else changeSetting(state);
        });
        await harness.run((state) => {
          if (change.speedFirst) changeSetting(state);
          else speedChange = state.handleSelectSpeed("fast");
        });

        expect(updateAgentSessionModel).toHaveBeenCalledTimes(1);
        firstUpdate.resolve();
        await speedChange;
        await harness.waitFor(() => updateAgentSessionModel.mock.calls.length === 2);
        expect(updateAgentSessionModel).toHaveBeenLastCalledWith(loadedClaudeSession, {
          ...claudeSelection,
          ...(change.setting === "effort"
            ? { variant: "xhigh" }
            : { modelId: "claude-sonnet-4-6", variant: "medium" }),
          speed: "fast",
        });
      } finally {
        firstUpdate.resolve();
        await speedChange;
        await harness.unmount();
      }
    },
  );

  test.each([true, false])(
    "continues from the accepted selection after failure with speedFirst=%s",
    async (speedFirst) => {
      const firstUpdate = Promise.withResolvers<void>();
      const failure = new Error("setting update failed");
      const toastError = spyOn(toast, "error").mockImplementation(() => "");
      const updateAgentSessionModel = mock(async () => {
        if (updateAgentSessionModel.mock.calls.length === 1) await firstUpdate.promise;
      });
      const harness = createHarness(createBaseProps({ updateAgentSessionModel }));
      let speedResult: Promise<void | unknown> = Promise.resolve();

      try {
        await harness.mount();
        await harness.run((state) => {
          if (speedFirst)
            speedResult = state.handleSelectSpeed("fast").catch((cause: unknown) => cause);
          else state.handleSelectVariant("xhigh");
        });
        await harness.run((state) => {
          if (speedFirst) state.handleSelectVariant("xhigh");
          else speedResult = state.handleSelectSpeed("fast").catch((cause: unknown) => cause);
        });

        expect(updateAgentSessionModel).toHaveBeenCalledTimes(1);
        firstUpdate.reject(failure);
        const result = await speedResult;
        await harness.waitFor(() => updateAgentSessionModel.mock.calls.length === 2);
        expect(updateAgentSessionModel).toHaveBeenLastCalledWith(loadedClaudeSession, {
          ...claudeSelection,
          ...(speedFirst ? { variant: "xhigh" } : { speed: "fast" }),
        });
        if (speedFirst) {
          expect(result).toBe(failure);
          expect(toastError).not.toHaveBeenCalled();
        } else {
          expect(result).toBeUndefined();
          expect(toastError).toHaveBeenCalledTimes(1);
          expect(toastError).toHaveBeenCalledWith("Failed to update model", {
            description: failure.message,
          });
        }
      } finally {
        firstUpdate.resolve();
        await speedResult;
        toastError.mockRestore();
        await harness.unmount();
      }
    },
  );

  test("keeps pending changes bound to the full session identity across navigation", async () => {
    const firstUpdate = Promise.withResolvers<void>();
    const updateAgentSessionModel = mock(async () => {
      if (updateAgentSessionModel.mock.calls.length === 1) await firstUpdate.promise;
    });
    const props = createBaseProps({ updateAgentSessionModel });
    const harness = createHarness(props);
    const otherSession = { ...loadedClaudeSession, workingDirectory: "/other-repo" };
    let speedChange = Promise.resolve();

    try {
      await harness.mount();
      await harness.run((state) => {
        speedChange = state.handleSelectSpeed("fast");
        state.handleSelectVariant("xhigh");
      });
      await harness.update({ ...props, loadedSessionIdentity: otherSession });
      await harness.run((state) => state.handleSelectSpeed("fast"));
      expect(updateAgentSessionModel).toHaveBeenCalledTimes(2);
      expect(updateAgentSessionModel).toHaveBeenLastCalledWith(otherSession, {
        ...claudeSelection,
        speed: "fast",
      });

      // Returning to the first session must keep its existing queue.
      await harness.update(props);
      await harness.run((state) => state.handleSelectVariant("low"));
      expect(updateAgentSessionModel).toHaveBeenCalledTimes(2);
      firstUpdate.resolve();
      await speedChange;
      await harness.waitFor(() => updateAgentSessionModel.mock.calls.length === 4);
      expect(updateAgentSessionModel).toHaveBeenLastCalledWith(loadedClaudeSession, {
        ...claudeSelection,
        variant: "low",
        speed: "fast",
      });
    } finally {
      firstUpdate.resolve();
      await speedChange;
      await harness.unmount();
    }
  });

  test("rejects a queued speed change when the accepted model no longer supports it", async () => {
    const firstUpdate = Promise.withResolvers<void>();
    const updateAgentSessionModel = mock(async () => {
      await firstUpdate.promise;
    });
    const selectionCatalog: AgentModelCatalog = {
      ...multiModelCatalog,
      models: multiModelCatalog.models.map((model) => ({
        ...model,
        speedLevels: model.modelId === "claude-sonnet-4-6" ? [] : model.speedLevels,
      })),
    };
    const harness = createHarness(createBaseProps({ selectionCatalog, updateAgentSessionModel }));
    let speedResult: Promise<unknown> = Promise.resolve();

    try {
      await harness.mount();
      await harness.run((state) => {
        state.handleSelectModelPair(
          { runtimeKind: "claude", providerId: "claude", modelId: "claude-sonnet-4-6" },
          selectionCatalog,
        );
        speedResult = state.handleSelectSpeed("fast").catch((cause: unknown) => cause);
      });
      firstUpdate.resolve();
      expect(await speedResult).toEqual(
        new Error(
          "The selected model does not support this speed. Choose Standard or a supported speed.",
        ),
      );
      expect(updateAgentSessionModel).toHaveBeenCalledTimes(1);
    } finally {
      firstUpdate.resolve();
      await speedResult;
      await harness.unmount();
    }
  });
});
