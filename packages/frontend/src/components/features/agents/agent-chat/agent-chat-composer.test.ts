import { describe, expect, test } from "bun:test";
import { DEFAULT_CHAT_SETTINGS, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { steerShortcutLabel } from "@/lib/steer-shortcut";
import type { AgentChatComposerModel, AgentChatMessageQueueModel } from "./agent-chat.types";
import { AgentChatComposer } from "./agent-chat-composer-test-helpers";
import { buildModelSelection } from "./agent-chat-test-fixtures";

const readComposerCard = (html: string): Element => {
  const card = new DOMParser().parseFromString(html, "text/html").body.querySelector("form > div");
  if (!card) throw new Error("Expected the composer card");
  return card;
};

const buildModel = () => ({
  displayedSessionKey: "session-1",
  isInteractionEnabled: true,
  isReadOnly: false,
  readOnlyReason: null,
  busySendBlockedReason: null,
  steerBlockedReason: null,
  runningTurnModel: null,
  messageQueue: null,
  draftScope: {
    key: "draft-1",
    persistence: null,
  },
  onSend: async () => true,
  isSending: false,
  isStarting: false,
  isSessionWorking: false,
  isWaitingInput: false,
  waitingInputPlaceholder: null,
  isModelSelectionPending: false,
  selectedModelSelection: buildModelSelection(),
  speed: null,
  isSelectionCatalogLoading: false,
  supportsAttachments: true,
  supportsSlashCommands: true,
  supportsFileSearch: true,
  supportsSkillReferences: false,
  supportsSubagentReferences: false,
  slashCommandCatalog: { commands: [] },
  slashCommands: [],
  slashCommandsError: null,
  isSlashCommandsLoading: false,
  skillCatalog: null,
  skills: [],
  skillsError: null,
  isSkillsLoading: false,
  subagentCatalog: null,
  subagents: [],
  subagentsError: null,
  isSubagentsLoading: false,
  retrySlashCommands: null,
  retrySkills: null,
  retrySubagents: null,
  onAgentSelectorOpen: () => {},
  onVariantSelectorOpen: () => {},
  onCatalogMenuOpen: () => {},
  searchFiles: async () => [],
  agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
  modelPicker: {
    runtimes: [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
        resource: {
          status: "ready" as const,
          catalog: {
            runtime: OPENCODE_RUNTIME_DESCRIPTOR,
            models: [
              {
                id: "openai/gpt-5.3-codex",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5.3-codex",
                modelName: "GPT-5.3 Codex",
                variants: ["high"],
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5.3-codex" },
          },
        },
      },
    ],
    value: {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5.3-codex",
    },
    selectionPolicy: { kind: "editable" as const },
    favoriteState: {
      favorites: [],
      isLoading: false,
      readError: null,
      isMutationPending: false,
      mutationError: null,
      canMutate: true,
      toggleFavorite: () => {},
      retryRead: () => {},
      retryMutation: () => {},
    },
    onValueChange: () => {},
    onOpenChange: () => {},
  },
  variantOptions: [{ value: "high", label: "high" }],
  onSelectAgent: () => {},
  onSelectVariant: () => {},
  accentColor: "#d97706",
  contextUsage: {
    totalTokens: 45_000,
    contextWindow: 200_000,
    outputLimit: 8_000,
  },
  canStopSession: true,
  isResumingSession: false,
  onStopSession: () => {},
  composerFormRef: createRef<HTMLFormElement>(),
  composerEditorRef: createRef<HTMLDivElement>(),
  onComposerEditorInput: () => {},
  scrollToBottomOnSendRef: { current: null } satisfies { current: (() => void) | null },
});

const queuedFollowUp: AgentChatMessageQueueModel = {
  queue: {
    target: {
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: { kind: "repository" },
    },
    revision: 1,
    entries: [
      {
        submissionId: "submission-1",
        parts: [{ kind: "text", text: "Queued follow-up" }],
        queuedAt: "2026-10-08T10:00:00.000Z",
        state: "queued",
      },
    ],
    pause: null,
  },
  onAction: async () => {},
  onSaveEdit: async () => {},
};

const buildCodexModelSelectionWithoutProfile = () => {
  const { profileId: _profileId, ...selection } = buildModelSelection({ runtimeKind: "codex" });
  return selection;
};

describe("AgentChatComposer", () => {
  test("renders the runtime-aware model picker and send controls", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("Send message");
    expect(html).toContain("Stop session");
    expect(html).toContain('aria-label="Session context: 22.5% used, 45K tokens"');
    expect(html).toContain("Select model, OpenCode, GPT-5.3 Codex");
    expect(html).toContain('viewBox="0 0 512 512"');
    expect(html).toContain("lucide-brain-cog");
    expect(html).toContain("high");
  });

  test("includes skill references in the composer placeholder when supported", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          supportsSkillReferences: true,
        },
      }),
    );

    expect(html).toContain("@ for files; / for commands; $ for skills");
  });

  test("includes subagents in the composer placeholder when supported", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          supportsSubagentReferences: true,
        },
      }),
    );

    expect(html).toContain("@ for files and subagents; / for commands");
  });

  test("uses a subagent-only reference placeholder when file search is unsupported", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          supportsFileSearch: false,
          supportsSubagentReferences: true,
        },
      }),
    );

    expect(html).toContain("@ for subagents; / for commands");
    expect(html).not.toContain("@ for files");
  });

  test("does not advertise @ references when files and subagents are unsupported", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          supportsFileSearch: false,
          supportsSubagentReferences: false,
        },
      }),
    );

    expect(html).toContain("/ for commands");
    expect(html).not.toContain("@ for files");
    expect(html).not.toContain("@ for subagents");
  });

  test("does not render an interrupted-turn resume action in the composer", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: { ...buildModel(), isResumingSession: true },
      }),
    );

    expect(html).not.toContain("Resume");
    expect(html).not.toContain("Resuming");
  });

  test("hides stop and context widgets when not available", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          contextUsage: null,
          canStopSession: false,
        },
      }),
    );

    expect(html).not.toContain("Stop session");
    expect(html).not.toContain("Session context:");
  });

  test("hides the agent profile selector when runtime profiles are unsupported", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          supportsProfiles: false,
        },
      }),
    );

    expect(html).not.toContain("Hephaestus (Deep Agent)");
    expect(html).toContain("GPT-5.3 Codex");
  });

  test("hides the variant selector when no variants are available", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          variantOptions: [],
        },
      }),
    );

    expect(html).toContain("GPT-5.3 Codex");
    expect(html).not.toContain("lucide-brain-cog");
    expect(html).not.toContain("Search effort...");
  });

  test("stop button is enabled when session is working even when sends are otherwise disabled", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isInteractionEnabled: false,
          canStopSession: true,
          isSessionWorking: true,
        },
      }),
    );

    expect(html).toContain("Stop session");
    expect(html).not.toContain('aria-label="Stop session" disabled');
  });

  test("stop button stays enabled while a non-queueable message is submitting", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          canStopSession: true,
          isSending: true,
          isSessionWorking: false,
        },
      }),
    );

    expect(html).toContain("Stop session");
    expect(html).not.toContain('aria-label="Stop session" disabled');
    expect(html).toContain('aria-label="Preparing message" disabled');
  });

  // The reference keys stay, so the composer still teaches them while the agent works.
  for (const steerMessagesByDefault of [false, true]) {
    test.each<[string, Partial<AgentChatComposerModel>, string]>([
      [
        "a working session",
        // A send waits in the queue, so it does not show the preparing state.
        { isSessionWorking: true, isSending: true },
        steerMessagesByDefault
          ? `@ for files; / for commands; Enter to steer; ${steerShortcutLabel()} to queue`
          : `@ for files; / for commands; Enter to queue; ${steerShortcutLabel()} to steer`,
      ],
      [
        "a working session that cannot steer",
        { isSessionWorking: true, steerBlockedReason: "OpenCode 1.0.0 cannot steer running work." },
        steerMessagesByDefault
          ? `@ for files; / for commands; ${steerShortcutLabel()} to queue`
          : "@ for files; / for commands; Enter to queue",
      ],
      [
        "an idle session with queued messages",
        { messageQueue: queuedFollowUp },
        steerMessagesByDefault
          ? `@ for files; / for commands; Enter to send now; ${steerShortcutLabel()} to queue`
          : `@ for files; / for commands; Enter to queue; ${steerShortcutLabel()} to send now`,
      ],
      ["an idle session without queued messages", {}, "@ for files; / for commands"],
    ])("names the queue keys in the placeholder for %s", (_name, overrides, placeholder) => {
      const html = renderToStaticMarkup(
        createElement(AgentChatComposer, {
          settings: { ...DEFAULT_CHAT_SETTINGS, steerMessagesByDefault },
          model: { ...buildModel(), ...overrides },
        }),
      );

      const card = readComposerCard(html);
      expect(card.querySelector('[aria-label="Message composer"]')?.textContent).toBe(placeholder);
      // The send button stays the same. Only the placeholder names the queue keys.
      expect(card.querySelector('[aria-label="Send message"]')).not.toBeNull();
      expect(html.includes("Queued follow-up")).toBe(overrides.messageQueue !== undefined);
    });
  }

  test("disables send when input is blank", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
        },
      }),
    );

    expect(html).toContain('aria-label="Send message" disabled');
  });

  test("shows caller-owned pending send items and keeps send enabled when the draft is empty", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          pendingSendItems: {
            count: 3,
            accessibleLabel: "3 pending review comments",
          },
        },
      }),
    );

    expect(html).toContain("agent-chat-send-pending-items-badge");
    expect(html).toContain('aria-label="3 pending review comments"');
    expect(html).toContain(">3<");
    expect(html).not.toContain('aria-label="Send message" disabled');
  });

  test.each([false, true])(
    "shows the speed control and blocks send while pending=%s",
    (pending) => {
      const html = renderToStaticMarkup(
        createElement(AgentChatComposer, {
          model: {
            ...buildModel(),
            pendingSendItems: { count: 1, accessibleLabel: "1 pending review comment" },
            speed: {
              key: "session",
              choice: "fast",
              levels: [{ id: "fast", label: "Fast" }],
              blockedReason: undefined,
              pending,
              disabled: false,
              error: null,
              onChange: () => {},
            },
          },
        }),
      );

      expect(html).toContain('aria-label="Speed: Fast"');
      expect(html.includes('aria-label="Send message" disabled')).toBe(pending);
      // A speed change must not lock the model and effort controls.
      expect(html).not.toContain("Model selection is unavailable right now.");
    },
  );

  test("warns when pending comments are not saved for later", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          pendingSendItems: {
            count: 2,
            accessibleLabel: "2 pending review comments",
            warning: "These comments are not saved for this session.",
          },
        },
      }),
    );

    const card = readComposerCard(html);
    const warning = card.querySelector('[data-testid="agent-chat-pending-items-warning"]');
    const editor = card.querySelector('[aria-label="Message composer"]');
    expect(warning?.textContent).toBe("These comments are not saved for this session.");
    expect(editor).not.toBeNull();
    expect(
      warning && editor
        ? warning.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
  });

  test("hides the warning when there are no pending comments", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          pendingSendItems: {
            count: 0,
            accessibleLabel: "0 pending review comments",
            warning: "These comments are not saved for this session.",
          },
        },
      }),
    );

    expect(html).not.toContain("agent-chat-pending-items-warning");
  });

  test("renders the idle composer as one rounded card without the agent accent", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: buildModel(),
      }),
    );

    const card = readComposerCard(html);
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("bg-chat-surface shadow-chat");
    expect(card.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(card.className).toContain("has-[[data-composer-editor]:focus]:shadow-chat-focus");
    expect(card.querySelector('[aria-label="Message composer"]')).not.toBeNull();
    expect(card.querySelector('[aria-label="Send message"]')).not.toBeNull();
    expect(html).not.toContain("border-l-4");
    expect(html).not.toContain("#d97706");
  });

  test("mutes the composer card while input is read-only", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isReadOnly: true,
          readOnlyReason: "This session is read-only.",
        },
      }),
    );

    const card = readComposerCard(html);
    expect(card.className).toContain("bg-chat-surface/60");
    expect(card.className).not.toContain("has-[[data-composer-editor]:focus]:shadow-chat-focus");
    expect(html).toContain("This session is read-only.");
    expect(html).toContain('aria-label="Send message" disabled');
  });

  test("keeps the Codex runtime accent off the idle composer", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          selectedModelSelection: buildCodexModelSelectionWithoutProfile(),
          supportsProfiles: false,
          accentColor: "var(--odt-runtime-accent-codex)",
        },
      }),
    );

    expect(html).not.toContain("--odt-runtime-accent-codex");
  });

  test("keeps stop and send together in a wrapping group that the context meter can wrap above", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: buildModel(),
      }),
    );

    const card = readComposerCard(html);
    const stop = card.querySelector('[aria-label="Stop session"]');
    const send = card.querySelector('[aria-label="Send message"]');
    const contextMeter = card.querySelector('[aria-label^="Session context:"]');
    const actions = stop?.parentElement;
    const actionsRow = actions?.parentElement;
    expect(actions?.contains(send ?? null)).toBe(true);
    expect(actions?.contains(contextMeter)).toBe(false);
    expect(actions?.className).toContain("shrink-0");
    expect(actionsRow?.contains(contextMeter)).toBe(true);
    expect(actionsRow?.className).toContain("max-w-full flex-wrap");
  });

  test("renders a colored border ray while the session is working", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isSessionWorking: true,
        },
      }),
    );

    expect(html).toContain('class="odt-border-ray"');
    expect(html).toContain("--odt-border-ray-color:#d97706");
    expect(html).toContain("--odt-border-ray-stroke-width:2.6");
  });

  test("renders a Codex-colored border ray while a no-profile Codex session is working", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          selectedModelSelection: buildCodexModelSelectionWithoutProfile(),
          supportsProfiles: false,
          accentColor: "var(--odt-runtime-accent-codex)",
          isSessionWorking: true,
        },
      }),
    );

    expect(html).toContain('class="odt-border-ray"');
    expect(html).toContain("--odt-border-ray-color:var(--odt-runtime-accent-codex)");
    expect(html).not.toContain("--odt-border-ray-color:rgba(56, 189, 248, 1)");
  });

  test("uses the waiting-input shell and suppresses the border ray while input is pending", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isSessionWorking: true,
          isWaitingInput: true,
          waitingInputPlaceholder: "Answer the pending question above to continue",
        },
      }),
    );

    const card = readComposerCard(html);
    expect(card.className).toContain("odt-waiting-input-card");
    expect(card.className).not.toContain("bg-chat-surface/60");
    expect(html).toContain("Answer the pending question above to continue");
    expect(html).toContain('aria-label="Send message" disabled');
    expect(html).not.toContain("Enter to queue");
    expect(html).not.toContain('class="odt-border-ray"');
    expect(html).not.toContain("border-l-4");
    expect(html).not.toContain("border-left-color:#d97706");
  });

  test("uses an approval-specific waiting placeholder when input is blocked by approvals", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isWaitingInput: true,
          waitingInputPlaceholder: "Respond to the pending approval request above to continue",
        },
      }),
    );

    expect(html).toContain("Respond to the pending approval request above to continue");
    expect(html).toContain('aria-label="Send message" disabled');
  });

  test("renders read-only mode when selected role is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isReadOnly: true,
          readOnlyReason: "Planner is unavailable for this task right now.",
        },
      }),
    );

    expect(html).toContain("Planner is unavailable for this task right now.");
    expect(html).toContain('aria-label="Send message" disabled');
  });
});
