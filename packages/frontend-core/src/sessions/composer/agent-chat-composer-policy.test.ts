import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createSlashCommandSegment,
  createTextSegment,
} from "../../drafts/agent-chat-composer-draft";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { type ComposerPolicyModel, useComposerPolicy } from "./agent-chat-composer-policy";

const model = (overrides: Partial<ComposerPolicyModel> = {}): ComposerPolicyModel => ({
  selectedModelDescriptor: null,
  runningTurnModel: null,
  isSessionWorking: false,
  isSending: false,
  isStarting: false,
  isModelSelectionPending: false,
  isSavingModel: false,
  isInteractionEnabled: true,
  isReadOnly: false,
  isWaitingInput: false,
  isResumingSession: false,
  speed: null,
  supportsAttachments: true,
  steerBlockedReason: null,
  supportsFileSearch: true,
  supportsSubagentReferences: true,
  supportsSlashCommands: true,
  supportsSkillReferences: true,
  readOnlyReason: null,
  messageQueue: null,
  ...overrides,
});

const textDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, "text-1")],
  attachments: [],
});

const resolve = async (
  input: Partial<Parameters<typeof useComposerPolicy>[0]> & { model: ComposerPolicyModel },
) => {
  const harness = createHookHarness(useComposerPolicy, {
    draft: textDraft("Hello"),
    primaryMode: "default",
    settingsReady: true,
    steerShortcutLabel: "⌘ Enter",
    ...input,
  });
  await harness.mount();
  const policy = harness.getLatest();
  await harness.unmount();
  return policy;
};

describe("useComposerPolicy", () => {
  test("names the reference triggers and the queue keys while a turn runs", async () => {
    const policy = await resolve({ model: model({ isSessionWorking: true }) });

    expect(policy.placeholder).toBe(
      "@ for files and subagents; / for commands; $ for skills; Enter to queue; ⌘ Enter to steer",
    );
    expect(policy.sendDisabled).toBe(false);
  });

  test("leaves the key hints out when the client has no steer shortcut", async () => {
    const policy = await resolve({
      model: model({ isSessionWorking: true }),
      steerShortcutLabel: null,
    });

    expect(policy.placeholder).toBe("@ for files and subagents; / for commands; $ for skills");
    expect(policy.placeholderHints).toEqual([
      "@ for files and subagents",
      "/ for commands",
      "$ for skills",
    ]);
  });

  test("lists no hint when the runtime offers no trigger", async () => {
    const policy = await resolve({
      model: model({
        supportsFileSearch: false,
        supportsSubagentReferences: false,
        supportsSlashCommands: false,
        supportsSkillReferences: false,
      }),
      steerShortcutLabel: null,
    });

    expect(policy.placeholder).toBe("Type a message");
    expect(policy.placeholderHints).toEqual([]);
  });

  test("asks for the pending request while the session waits for input", async () => {
    const policy = await resolve({ model: model({ isWaitingInput: true }) });

    expect(policy.placeholder).toBe("Resolve the pending request above to continue");
    expect(policy.placeholderHints).toBeNull();
    expect(policy.isComposerInputDisabled).toBe(true);
    expect(policy.sendDisabled).toBe(true);
  });

  test("blocks a send that has no content and no pending review comments", async () => {
    expect((await resolve({ model: model(), draft: textDraft("  ") })).sendDisabled).toBe(true);
    expect(
      (
        await resolve({
          model: model({
            pendingSendItems: [
              { key: "review_comments", count: 1, accessibleLabel: "1 pending review comment" },
            ],
          }),
          draft: textDraft(""),
        })
      ).sendDisabled,
    ).toBe(false);
  });

  test("blocks a slash command with attachments", async () => {
    const draft: AgentChatComposerDraft = {
      segments: [
        createSlashCommandSegment({
          id: "review",
          trigger: "review",
          title: "review",
          source: "command",
          hints: [],
        }),
      ],
      attachments: [createComposerAttachment({ name: "a.png", kind: "image", path: "/tmp/a.png" })],
    };

    const policy = await resolve({ model: model(), draft });

    expect(policy.hasSlashAttachmentConflict).toBe(true);
    expect(policy.sendDisabled).toBe(true);
  });

  test("keeps send closed until the chat settings load", async () => {
    const policy = await resolve({ model: model(), settingsReady: false });

    expect(policy.sendDisabled).toBe(true);
    expect(policy.sendBlockedReason).toBe(
      "Load chat settings before sending. Use Retry settings if the read failed.",
    );
  });

  test("closes send when the chat cannot send now", async () => {
    expect((await resolve({ model: model({ canSend: false }) })).sendDisabled).toBe(true);
  });
});
