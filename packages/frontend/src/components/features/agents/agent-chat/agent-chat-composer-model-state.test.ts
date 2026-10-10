import { describe, expect, test } from "bun:test";
import { CLAUDE_SESSION_ACCENT_COLOR, CODEX_SESSION_ACCENT_COLOR } from "../agent-accent-color";
import { deriveAgentChatComposerModelState } from "./agent-chat-composer-model-state";

describe("agent-chat-composer-model-state", () => {
  test("derives selected-session accent and pending model state from the selected session", () => {
    expect(
      deriveAgentChatComposerModelState({
        selectedSession: {
          runtimeKind: "opencode",
          selectedModel: null,
        },
        selectedModelSelection: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "ignored-selection",
        },
        isSessionModelCatalogLoading: true,
        isInteractionEnabled: false,
      }),
    ).toEqual({
      accentColor: "var(--odt-runtime-accent-opencode)",
      isInteractionEnabled: false,
      isModelSelectionPending: true,
    });
  });

  test("uses selected model accent before a session exists", () => {
    expect(
      deriveAgentChatComposerModelState({
        selectedSession: null,
        selectedModelSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "builder",
        },
        isSessionModelCatalogLoading: false,
        isInteractionEnabled: true,
      }),
    ).toEqual({
      accentColor: "var(--odt-runtime-accent-opencode)",
      isInteractionEnabled: true,
      isModelSelectionPending: false,
    });
  });

  test("uses Codex runtime accent when there is no agent profile", () => {
    expect(
      deriveAgentChatComposerModelState({
        selectedSession: null,
        selectedModelSelection: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        isSessionModelCatalogLoading: false,
        isInteractionEnabled: true,
      }).accentColor,
    ).toBe(CODEX_SESSION_ACCENT_COLOR);
  });

  test("uses Claude runtime accent when there is no agent profile", () => {
    expect(
      deriveAgentChatComposerModelState({
        selectedSession: null,
        selectedModelSelection: {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "claude-sonnet-4-6",
        },
        isSessionModelCatalogLoading: false,
        isInteractionEnabled: true,
      }).accentColor,
    ).toBe(CLAUDE_SESSION_ACCENT_COLOR);
  });
});
