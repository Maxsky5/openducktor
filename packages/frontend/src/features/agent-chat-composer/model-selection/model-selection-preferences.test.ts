import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  resolveChatComposerModelSelections,
  resolveChatComposerSelectedRuntimeKind,
} from "./model-selection-preferences";
import { resolvePreferredModelSelection } from "./model-selection-state";

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
      variants: [],
      contextWindow: 100_000,
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
      color: "#f59e0b",
    },
    {
      name: "hidden-subagent",
      mode: "subagent",
      hidden: true,
    },
  ],
};

const LIVE_UPDATE_CATALOG: AgentModelCatalog = {
  ...CATALOG,
  models: CATALOG.models.map((model) =>
    model.modelId === "gpt-5"
      ? {
          ...model,
          variants: ["default", "high", "max"],
          liveSessionUpdates: { variants: ["default", "high"] },
        }
      : model,
  ),
};

describe("model-selection-preferences", () => {
  test("resolves chat composer runtime kind from selected session, draft, caller default, then runtime default", () => {
    const defaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        draftSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
        defaultSelection,
        defaultRuntimeKind: "opencode",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("codex");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: null,
        defaultSelection,
        defaultRuntimeKind: "codex",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("opencode");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: null,
        defaultSelection: null,
        defaultRuntimeKind: "codex",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
  });

  test("ignores unavailable new-session runtimes but preserves the loaded-session runtime", () => {
    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        draftSelection: null,
        defaultSelection: null,
        defaultRuntimeKind: "opencode",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("codex");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        defaultSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
        defaultRuntimeKind: "codex",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("opencode");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: null,
        defaultSelection: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        defaultRuntimeKind: "opencode",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("opencode");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        defaultSelection: null,
        defaultRuntimeKind: "codex",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
  });

  test("resolves draft selection by normalizing existing selection then falling back", () => {
    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "missing-variant",
          profileId: "hidden-subagent",
        },
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: null,
        fallbackSelection: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });

    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: null,
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("resolves preferred active-session model using selected model before defaults", () => {
    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        },
        fallbackSelection: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: {
          runtimeKind: "opencode",
          providerId: "missing",
          modelId: "model",
        },
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("resolves stale loaded-session models to an explicit repair selection", () => {
    const sessionIdentity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };
    const draftSelection = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    };
    const defaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };
    const unknownSessionModel = {
      runtimeKind: "opencode" as const,
      providerId: "missing",
      modelId: "missing-model",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "session",
          sessionIdentity,
          sessionRuntimeKind: "opencode",
          modelCatalog: CATALOG,
          selectedSessionModel: unknownSessionModel,
          draftSelection,
        },
        defaultSelection,
      }),
    ).toEqual({
      selectionCatalog: CATALOG,
      selectedModelSelection: defaultSelection,
      selectionForNewSession: defaultSelection,
      sessionModelRepairCommand: {
        key: "session-1|opencode|%2Frepo\u001fopencode\u001fanthropic\u001fclaude-sonnet\u001f\u001f",
        session: sessionIdentity,
        selection: defaultSelection,
      },
      isSelectedSessionModelSendable: false,
    });
  });

  test("uses a live-compatible variant when repairing a loaded-session model", () => {
    const sessionIdentity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "session",
          sessionIdentity,
          sessionRuntimeKind: "opencode",
          modelCatalog: LIVE_UPDATE_CATALOG,
          selectedSessionModel: {
            runtimeKind: "opencode",
            providerId: "missing",
            modelId: "missing-model",
          },
          draftSelection: null,
        },
        defaultSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "max",
        },
      }),
    ).toEqual({
      selectionCatalog: LIVE_UPDATE_CATALOG,
      selectedModelSelection: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
      },
      selectionForNewSession: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
      },
      sessionModelRepairCommand: {
        key: "session-1|opencode|%2Frepo\u001fopencode\u001fopenai\u001fgpt-5\u001fdefault\u001f",
        session: sessionIdentity,
        selection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "default",
        },
      },
      isSelectedSessionModelSendable: false,
    });
  });

  test("preserves the current loaded-session variant even when it cannot be selected live", () => {
    const selectedSessionModel = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "max",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "session",
          sessionIdentity: {
            externalSessionId: "session-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo",
          },
          sessionRuntimeKind: "opencode",
          modelCatalog: LIVE_UPDATE_CATALOG,
          selectedSessionModel,
          draftSelection: null,
        },
        defaultSelection: null,
      }),
    ).toEqual({
      selectionCatalog: LIVE_UPDATE_CATALOG,
      selectedModelSelection: selectedSessionModel,
      selectionForNewSession: selectedSessionModel,
      sessionModelRepairCommand: null,
      isSelectedSessionModelSendable: true,
    });
  });

  test("does not invent a loaded-session model when the persisted session has none", () => {
    const defaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "session",
          sessionIdentity: {
            externalSessionId: "session-1",
            runtimeKind: "opencode" as const,
            workingDirectory: "/repo",
          },
          sessionRuntimeKind: "opencode",
          modelCatalog: CATALOG,
          selectedSessionModel: null,
          draftSelection: null,
        },
        defaultSelection,
      }),
    ).toEqual({
      selectionCatalog: CATALOG,
      selectedModelSelection: null,
      selectionForNewSession: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec-agent",
      },
      sessionModelRepairCommand: null,
      isSelectedSessionModelSendable: true,
    });
  });

  test("uses the loaded-session model as the next new-session seed", () => {
    const selectedSessionModel = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };
    const defaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "session",
          sessionIdentity: {
            externalSessionId: "session-1",
            runtimeKind: "opencode" as const,
            workingDirectory: "/repo",
          },
          sessionRuntimeKind: "opencode",
          modelCatalog: CATALOG,
          selectedSessionModel,
          draftSelection: null,
        },
        defaultSelection,
      }).selectionForNewSession,
    ).toEqual(selectedSessionModel);
  });

  test("ignores stale draft selections while a session is selected", () => {
    const selectedSessionModel = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "session",
          sessionIdentity: {
            externalSessionId: "session-1",
            runtimeKind: "opencode" as const,
            workingDirectory: "/repo",
          },
          sessionRuntimeKind: "opencode",
          modelCatalog: CATALOG,
          selectedSessionModel,
          draftSelection: {
            runtimeKind: "codex" as const,
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
        defaultSelection: null,
      }).selectionForNewSession,
    ).toEqual(selectedSessionModel);
  });

  test("resolves chat composer selections for a new session from draft, defaults, then catalog", () => {
    const defaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "new_session",
          composerCatalog: CATALOG,
          draftSelection: null,
        },
        defaultSelection,
      }),
    ).toEqual({
      selectionCatalog: CATALOG,
      selectedModelSelection: defaultSelection,
      selectionForNewSession: defaultSelection,
      sessionModelRepairCommand: null,
      isSelectedSessionModelSendable: true,
    });

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "new_session",
          composerCatalog: null,
          draftSelection: null,
        },
        defaultSelection,
      }),
    ).toEqual({
      selectionCatalog: null,
      selectedModelSelection: null,
      selectionForNewSession: null,
      sessionModelRepairCommand: null,
      isSelectedSessionModelSendable: true,
    });
  });

  test("coerces a new-session draft after its catalog loads", () => {
    const defaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "new_session",
          composerCatalog: CATALOG,
          draftSelection: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
        defaultSelection,
      }).selectionForNewSession,
    ).toEqual(defaultSelection);

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "new_session",
          composerCatalog: CATALOG,
          draftSelection: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "missing-variant",
            profileId: "hidden-subagent",
          },
        },
        defaultSelection,
      }).selectionForNewSession,
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "new_session",
          composerCatalog: CATALOG,
          draftSelection: {
            runtimeKind: "codex",
            providerId: "missing",
            modelId: "missing",
          },
        },
        defaultSelection: {
          runtimeKind: "codex",
          providerId: "missing",
          modelId: "missing",
        },
      }).selectionForNewSession,
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("preserves an unvalidated new-session draft until its catalog loads", () => {
    const draftSelection = {
      runtimeKind: "opencode" as const,
      providerId: "missing",
      modelId: "missing",
      variant: "stale",
      profileId: "stale-profile",
    };

    expect(
      resolveChatComposerModelSelections({
        source: {
          kind: "new_session",
          composerCatalog: null,
          draftSelection,
        },
        defaultSelection: null,
      }).selectionForNewSession,
    ).toEqual(draftSelection);
  });
});
