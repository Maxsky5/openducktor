import type {
  AgentMessageSubmitMode,
  AgentQueuedMessage,
  AgentSessionUserMessagePart,
} from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  BLOCKED_ON_INPUT_REASON,
  steeringPartsBlockedReason,
} from "@openducktor/core";
import {
  type AttachmentToCheck,
  runningTurnAttachmentBlockedReason,
} from "../../drafts/agent-chat-attachments";
import type { AgentChatComposerDraft } from "../../drafts/agent-chat-composer-draft";
import { isReusablePromptSlashCommand } from "./agent-chat-reusable-prompts";

/** The session state that decides whether a queued message can steer the running work. */
export type QueuedMessageSteerContext = {
  /** Why the session cannot steer the running turn now, or null when it can. */
  steerBlockedReason: string | null;
  runningTurnModel: AgentModelCatalog["models"][number] | null;
  isSessionWorking: boolean;
  /** True while the session runs a turn in the foreground. */
  foregroundTurnActive?: boolean | undefined;
  isWaitingInput: boolean;
};

/** An idle session takes a steer as a new turn, so steering limits apply only to a running turn. */
export const steersRunningTurn = (mode: AgentMessageSubmitMode, turnActive: boolean): boolean =>
  mode === "steer" && turnActive;

/** A session works in the foreground while it runs a turn that the user waits for. */
export const hasForegroundTurn = (
  context: Pick<QueuedMessageSteerContext, "foregroundTurnActive" | "isSessionWorking">,
): boolean => context.foregroundTurnActive ?? context.isSessionWorking;

/** A reusable prompt becomes text before it is sent, so only native commands block steering. */
export const draftSteerBlockedReason = (
  draft: AgentChatComposerDraft,
  context: RunningTurnSteerContext,
): string | null =>
  runningTurnSteerBlockedReason(
    {
      parts: draft.segments.filter(
        (segment) =>
          segment.kind !== "slash_command" || !isReusablePromptSlashCommand(segment.command),
      ),
      attachments: draft.attachments ?? [],
    },
    context,
  );

export const queuedMessageSteerBlockedReason = (
  entry: Pick<AgentQueuedMessage, "parts">,
  context: QueuedMessageSteerContext,
): string | null => {
  if (context.isWaitingInput) return BLOCKED_ON_INPUT_REASON;
  if (!hasForegroundTurn(context)) return null;
  return runningTurnSteerBlockedReason(
    {
      parts: entry.parts,
      attachments: entry.parts.flatMap((part) =>
        part.kind === "attachment" ? [part.attachment] : [],
      ),
    },
    context,
  );
};

type RunningTurnSteerContext = Pick<
  QueuedMessageSteerContext,
  "steerBlockedReason" | "runningTurnModel"
>;

const runningTurnSteerBlockedReason = (
  content: {
    readonly parts: ReadonlyArray<Pick<AgentSessionUserMessagePart, "kind">>;
    readonly attachments: readonly AttachmentToCheck[];
  },
  { steerBlockedReason, runningTurnModel }: RunningTurnSteerContext,
): string | null =>
  steerBlockedReason ??
  steeringPartsBlockedReason(content.parts) ??
  runningTurnAttachmentBlockedReason(content.attachments, runningTurnModel);
