import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  composerCardState,
  composerFieldText,
  composerModelText,
  secondarySendDisabled,
  sendButtonState,
} from "./composer-presentation";

describe("composerFieldText", () => {
  test("shows the trigger keys of the policy and reads them to screen readers", () => {
    expect(
      composerFieldText({
        placeholder: "@ for files and subagents; / for commands; $ for skills",
        hints: ["@ for files and subagents", "/ for commands", "$ for skills"],
      }),
    ).toEqual({
      placeholder: "@ for files and subagents; / for commands; $ for skills",
      hint: "Type @ for files and subagents, / for commands, $ for skills.",
    });
  });

  test("gives no hint when the runtime offers no trigger", () => {
    expect(composerFieldText({ placeholder: "Type a message", hints: [] })).toEqual({
      placeholder: "Type a message",
      hint: null,
    });
  });

  test("keeps a state message of the policy as the placeholder", () => {
    const text = "Resolve the pending request above to continue";
    expect(composerFieldText({ placeholder: text, hints: null })).toEqual({
      placeholder: text,
      hint: text,
    });
  });
});

describe("sendButtonState", () => {
  test("closes the button while there is nothing to send", () => {
    expect(sendButtonState({ hasContent: false, sendDisabled: true, busy: false })).toBe("blocked");
    expect(sendButtonState({ hasContent: false, sendDisabled: false, busy: false })).toBe(
      "blocked",
    );
  });

  test("shows a closed send as gray and an open send as ready", () => {
    expect(sendButtonState({ hasContent: true, sendDisabled: true, busy: false })).toBe("blocked");
    expect(sendButtonState({ hasContent: true, sendDisabled: false, busy: false })).toBe("ready");
  });

  test("shows progress while a send prepares, also after the draft clears", () => {
    expect(sendButtonState({ hasContent: false, sendDisabled: true, busy: true })).toBe("busy");
  });
});

describe("secondarySendDisabled", () => {
  const open = {
    gateOpen: true,
    settingsReady: true,
    sendInputBlocked: false,
    defaultSendDisabled: false,
    steerBlockedReason: null,
  };

  test("closes Queue for an attachment that the selected model does not take", () => {
    // Steer is the primary mode, so the primary attachment errors name only the running turn.
    expect(secondarySendDisabled({ ...open, mode: "default", defaultSendDisabled: true })).toBe(
      true,
    );
    expect(secondarySendDisabled({ ...open, mode: "steer", defaultSendDisabled: true })).toBe(
      false,
    );
  });

  test("closes Steer while the runtime cannot steer the running turn", () => {
    const blocked = { ...open, steerBlockedReason: "This runtime cannot steer." };
    expect(secondarySendDisabled({ ...blocked, mode: "steer" })).toBe(true);
    expect(secondarySendDisabled({ ...blocked, mode: "default" })).toBe(false);
  });

  test("closes both modes until the chat settings load and the host connects", () => {
    expect(secondarySendDisabled({ ...open, mode: "default", settingsReady: false })).toBe(true);
    expect(secondarySendDisabled({ ...open, mode: "steer", gateOpen: false })).toBe(true);
  });
});

describe("composerCardState", () => {
  test("shows the waiting look while the session waits for input", () => {
    expect(
      composerCardState({ isWaitingInput: true, inputDisabled: true, isSubmitting: false }),
    ).toBe("waiting");
  });

  test("fades the card while the field is off, but not while a send locks it", () => {
    expect(
      composerCardState({ isWaitingInput: false, inputDisabled: true, isSubmitting: false }),
    ).toBe("muted");
    expect(
      composerCardState({ isWaitingInput: false, inputDisabled: true, isSubmitting: true }),
    ).toBe("active");
    expect(
      composerCardState({ isWaitingInput: false, inputDisabled: false, isSubmitting: false }),
    ).toBe("active");
  });
});

describe("composerModelText", () => {
  const catalog: AgentModelCatalog = {
    runtime: CLAUDE_RUNTIME_DESCRIPTOR,
    models: [
      {
        id: "anthropic/opus",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "opus-4",
        modelName: "Opus 4",
        variants: ["high"],
      },
    ],
    defaultModelsByProvider: {},
  };

  test("names the control Model while the session has no model", () => {
    expect(composerModelText({ selectedModel: null, modelName: undefined, catalog })).toEqual({
      label: "Model",
      profile: null,
      effort: null,
      speedTone: "standard",
      accessibilityLabel: "Select model",
    });
  });

  test("shows the catalog name and the effort level of the selected model", () => {
    const text = composerModelText({
      selectedModel: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "opus-4",
        variant: "high",
      },
      modelName: "Opus 4",
      catalog,
    });
    expect(text.label).toBe("Opus 4");
    expect(text.profile).toBeNull();
    expect(text.effort).toBe("high");
    expect(text.speedTone).toBe("standard");
    expect(text.accessibilityLabel).toContain("Claude");
    expect(text.accessibilityLabel).toContain("Opus 4");
    expect(text.accessibilityLabel).toContain("Effort high");
  });

  test("shows OpenCode profile label and falls back to profile ID when unlisted", () => {
    const opencodeCatalog: AgentModelCatalog = {
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT-5",
          variants: ["high"],
        },
      ],
      profiles: [{ id: "build", name: "build", label: "Builder", mode: "primary" }],
      defaultModelsByProvider: {},
    };
    const listed = composerModelText({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "build",
        variant: "high",
      },
      modelName: "GPT-5",
      catalog: opencodeCatalog,
    });
    expect(listed.profile).toBe("Builder");
    expect(listed.speedTone).toBe("standard");
    expect(listed.accessibilityLabel).toContain("Builder");

    const unlisted = composerModelText({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "legacy-agent",
      },
      modelName: "GPT-5",
      catalog: opencodeCatalog,
    });
    expect(unlisted.profile).toBe("legacy-agent");
  });

  test("reports fast and ultrafast speed tones and accessible speed labels", () => {
    const codexCatalog: AgentModelCatalog = {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT-5",
          variants: ["high"],
          speedLevels: [
            { id: "fast", label: "Fast" },
            { id: "ultrafast", label: "Ultrafast" },
          ],
        },
      ],
      defaultModelsByProvider: {},
    };
    const fast = composerModelText({
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        speed: "fast",
      },
      modelName: "GPT-5",
      catalog: codexCatalog,
    });
    expect(fast.speedTone).toBe("fast");
    expect(fast.accessibilityLabel).toContain("Speed Fast");

    const ultrafast = composerModelText({
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        speed: "ultrafast",
      },
      modelName: "GPT-5",
      catalog: codexCatalog,
    });
    expect(ultrafast.speedTone).toBe("ultrafast");
    expect(ultrafast.accessibilityLabel).toContain("Speed Ultrafast");
  });

  test("shows no effort for a model without effort levels", () => {
    const noEfforts: AgentModelCatalog = {
      ...catalog,
      models: [
        { ...catalog.models[0]!, modelId: "big-pickle", modelName: "Big Pickle", variants: [] },
      ],
    };
    const text = composerModelText({
      selectedModel: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "big-pickle",
        variant: "default",
      },
      modelName: "Big Pickle",
      catalog: noEfforts,
    });
    expect(text.effort).toBeNull();
    expect(text.accessibilityLabel).toBe("Select model, Claude, Big Pickle");
  });

  test("shows the model ID of a model that the catalog does not have", () => {
    expect(
      composerModelText({
        selectedModel: { runtimeKind: "claude", providerId: "openai", modelId: "gpt-5" },
        modelName: undefined,
        catalog,
      }),
    ).toMatchObject({ label: "gpt-5", effort: null, profile: null, speedTone: "standard" });
  });
});
