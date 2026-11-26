import {
  GOAL_SLASH_COMMAND,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
} from "@openducktor/contracts";
import { classifySystemSlashCommandInvocation, type AgentUserMessagePart } from "@openducktor/core";
import {
  draftToUserMessageParts,
  type AgentChatComposerDraft,
} from "../../drafts/agent-chat-composer-draft";

const systemCommandTrigger = (kind: "manual_session_compaction" | "goal"): string =>
  kind === "goal" ? GOAL_SLASH_COMMAND.trigger : MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger;

const draftPartsForCommandCheck = (draft: AgentChatComposerDraft): AgentUserMessagePart[] => {
  const parts = draftToUserMessageParts({ ...draft, attachments: [] });
  for (const attachment of draft.attachments ?? []) {
    const item: Extract<AgentUserMessagePart, { kind: "attachment" }>["attachment"] = {
      id: attachment.id,
      path: attachment.path ?? attachment.name,
      name: attachment.name,
      kind: attachment.kind,
    };
    if (attachment.mime) item.mime = attachment.mime;
    parts.push({ kind: "attachment", attachment: item });
  }
  return parts;
};

/**
 * Returns an actionable reason when a draft invokes a session-requiring system slash command
 * (such as `/compact` or `/goal`) without an existing session, or `null` when allowed.
 */
export const draftSystemSlashCommandBlockedReason = (
  draft: AgentChatComposerDraft,
  hasExistingSession: boolean,
): string | null => {
  if (hasExistingSession) return null;
  let invocation: ReturnType<typeof classifySystemSlashCommandInvocation>;
  try {
    invocation = classifySystemSlashCommandInvocation(draftPartsForCommandCheck(draft));
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  if (invocation.kind === "not_system") return null;
  const trigger = systemCommandTrigger(invocation.kind);
  return `/${trigger} requires an existing session. Send a message first to start this session.`;
};

/** Throws when message parts invoke a session-requiring system slash command without a session. */
export const requireSystemCommandSessionTarget = (
  parts: AgentUserMessagePart[],
  hasExistingSession: boolean,
): void => {
  if (hasExistingSession) return;
  const invocation = classifySystemSlashCommandInvocation(parts);
  if (invocation.kind === "not_system") return;
  const trigger = systemCommandTrigger(invocation.kind);
  throw new Error(`/${trigger} requires an existing selected session.`);
};
