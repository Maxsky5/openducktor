import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { SessionStartModalModel } from "./session-start-modal-model";
import { useSessionStartSpeed } from "./use-session-start-speed";

const catalog = (speedLevels: { id: string; label: string }[]): AgentModelCatalog => ({
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "claude/opus",
      providerId: "claude",
      providerName: "Claude",
      modelId: "opus",
      modelName: "Opus",
      variants: [],
      speedLevels,
    },
  ],
  defaultModelsByProvider: {},
});

const createModel = (
  speedLevels: { id: string; label: string }[],
  overrides: Partial<SessionStartModalModel> = {},
): SessionStartModalModel =>
  // SAFETY: The speed hook reads only the fields that this fixture sets.
  ({
    phase: { kind: "choices" },
    onContinueInBackground: () => {},
    onEditChoices: () => {},
    open: true,
    requestId: "request-1",
    selectedStartMode: "reuse",
    selectedSourceSessionValue: "source-1",
    selectedRuntimeKind: "claude",
    selectedModelSelection: { runtimeKind: "claude", providerId: "claude", modelId: "opus" },
    existingSessionOptions: [
      {
        value: "source-1",
        label: "Builder #1",
        sourceSession: {
          externalSessionId: "source-1",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
        },
        selectedModel: {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "opus",
          speed: "fast",
        },
      },
    ],
    modelPickerRuntimes: [
      {
        descriptor: CLAUDE_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
        resource: { status: "ready", catalog: catalog(speedLevels) },
      },
    ],
    isStarting: false,
    ...overrides,
  }) as SessionStartModalModel;

const createHarness = (model: SessionStartModalModel) => {
  const feedback = createFeedbackFake();
  const connection = createTestClientConnection({ feedback });
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(ClientConnectionProvider, { connection }, children);
  return { feedback, harness: createHookHarness(useSessionStartSpeed, model, { wrapper }) };
};

describe("useSessionStartSpeed", () => {
  test("keeps the source speed of a reused session and sends no change", async () => {
    const { feedback, harness } = createHarness(createModel([{ id: "fast", label: "Fast" }]));
    await harness.mount();
    try {
      expect(harness.getLatest().control?.choice).toBe("fast");
      expect(harness.getLatest().change).toBeUndefined();
      await harness.run((speed) => speed.control?.onChange("standard"));
      await harness.waitFor((speed) => speed.change === "standard");
      expect(feedback.shown).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("resets a speed that the selected model cannot use and tells the user", async () => {
    const { feedback, harness } = createHarness(createModel([]));
    await harness.mount();
    try {
      await harness.waitFor((speed) => speed.control?.choice === "standard");
      expect(harness.getLatest().change).toBe("standard");
      expect(feedback.shownOf("info").map((entry) => entry.message)).toEqual([
        "Speed was set to Standard because this model does not support the previous level.",
      ]);
    } finally {
      await harness.unmount();
    }
  });
});
