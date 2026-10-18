import { describe, expect, test } from "bun:test";
import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentSlashCommand,
  BLOCKED_ON_INPUT_REASON,
} from "@openducktor/core";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { toReusablePromptSlashCommand } from "./agent-chat-reusable-prompts";
import {
  draftSteerBlockedReason,
  type QueuedMessageSteerContext,
  queuedMessageSteerBlockedReason,
  steersRunningTurn,
} from "./agent-chat-steering";

const VERSION_REASON = "Update Codex to 0.106.0 or later.";
const SLASH_COMMAND_REASON = "A slash command cannot join running work.";

const runningTurnModel = (support: {
  image: boolean;
  pdf: boolean;
}): AgentModelCatalog["models"][number] => ({
  id: "openai/gpt-5",
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5",
  modelName: "GPT-5",
  variants: [],
  attachmentSupport: { audio: false, video: false, ...support },
});

const working = (
  overrides: Partial<QueuedMessageSteerContext> = {},
): QueuedMessageSteerContext => ({
  steerBlockedReason: null,
  runningTurnModel: runningTurnModel({ image: false, pdf: false }),
  isSessionWorking: true,
  isWaitingInput: false,
  ...overrides,
});

const nativeCommand: AgentSlashCommand = {
  id: "compact",
  trigger: "compact",
  title: "Compact",
  hints: [],
};

const queued = (...parts: AgentSessionUserMessagePart[]) => ({ parts });
const text = (value: string): AgentSessionUserMessagePart => ({ kind: "text", text: value });
const command: AgentSessionUserMessagePart = { kind: "slash_command", command: nativeCommand };
const image: AgentSessionUserMessagePart = {
  kind: "attachment",
  attachment: { id: "a-1", path: "/tmp/shot.png", name: "shot.png", kind: "image" },
};

const draftWith = (
  slashCommand: AgentSlashCommand | null,
  attachments: AgentChatComposerDraft["attachments"] = [],
): AgentChatComposerDraft => ({
  segments: [
    { id: "text-1", kind: "text", text: "" },
    ...(slashCommand
      ? [{ id: "command-1", kind: "slash_command" as const, command: slashCommand }]
      : []),
    { id: "text-2", kind: "text", text: " now" },
  ],
  attachments,
});
const brief = { id: "b-1", name: "brief.pdf", kind: "pdf" as const, mime: "application/pdf" };

describe("steering rules", () => {
  test.each<[string, () => string | null, string | null]>([
    [
      "blocking input stops a queued steer before any other limit",
      () =>
        queuedMessageSteerBlockedReason(
          queued(command),
          working({ isWaitingInput: true, steerBlockedReason: VERSION_REASON }),
        ),
      BLOCKED_ON_INPUT_REASON,
    ],
    [
      "an idle session takes a queued steer as a new turn",
      () =>
        queuedMessageSteerBlockedReason(
          queued(command, image),
          working({ isSessionWorking: false, steerBlockedReason: VERSION_REASON }),
        ),
      null,
    ],
    [
      "the runtime version reason comes before the content of a queued message",
      () =>
        queuedMessageSteerBlockedReason(
          queued(command),
          working({ steerBlockedReason: VERSION_REASON }),
        ),
      VERSION_REASON,
    ],
    [
      "the runtime version reason blocks a draft",
      () =>
        draftSteerBlockedReason(draftWith(null), working({ steerBlockedReason: VERSION_REASON })),
      VERSION_REASON,
    ],
    [
      "a native slash command cannot join the running turn from the queue",
      () => queuedMessageSteerBlockedReason(queued(command), working()),
      SLASH_COMMAND_REASON,
    ],
    [
      "a native slash command cannot join the running turn from a draft",
      () => draftSteerBlockedReason(draftWith(nativeCommand), working()),
      SLASH_COMMAND_REASON,
    ],
    [
      "a reusable prompt becomes text, so a draft with one can steer",
      () =>
        draftSteerBlockedReason(
          draftWith(
            toReusablePromptSlashCommand({
              id: "review",
              name: "review",
              description: "",
              content: "Review the change.",
            }),
          ),
          working(),
        ),
      null,
    ],
    [
      "a queued attachment must suit the model of the running turn",
      () => queuedMessageSteerBlockedReason(queued(text("Look"), image), working()),
      "shot.png: The model of the running turn does not support image attachments.",
    ],
    [
      "a queued attachment that the running turn takes can steer",
      () =>
        queuedMessageSteerBlockedReason(
          queued(text("Look"), image),
          working({ runningTurnModel: runningTurnModel({ image: true, pdf: false }) }),
        ),
      null,
    ],
    [
      "a draft attachment must suit the model of the running turn",
      () => draftSteerBlockedReason(draftWith(null, [brief]), working()),
      "brief.pdf: The model of the running turn does not support pdf attachments.",
    ],
    [
      "an unknown running turn model blocks a steer with attachments",
      () => draftSteerBlockedReason(draftWith(null, [brief]), working({ runningTurnModel: null })),
      "The model of the running turn is unknown, so its attachment support cannot be checked. Queue the message instead.",
    ],
  ])("%s", (_name, blockedReason, expected) => {
    expect(blockedReason()).toBe(expected);
  });

  test("steers the running turn only in steer mode while the session works", () => {
    expect(steersRunningTurn("steer", true)).toBe(true);
    // An idle session takes a steer as a new turn, so the composer does not check its limits.
    expect(steersRunningTurn("steer", false)).toBe(false);
    expect(steersRunningTurn("default", true)).toBe(false);
  });
});
