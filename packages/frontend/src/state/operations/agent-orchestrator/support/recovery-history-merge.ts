import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";

/** Replace unchanged history and keep messages changed while history was loading. */
export const mergeRecoveryHistory = (
  externalSessionId: string,
  loaded: AgentSessionState["messages"],
  current: AgentSessionState["messages"],
  baseline: AgentSessionState["messages"] | undefined,
  deltaMessageIds: ReadonlySet<string> = new Set(),
): AgentSessionState["messages"] => {
  if (!baseline)
    throw new Error("History recovery has no committed baseline. Reload this conversation.");
  const aliases = new Map(loaded.items.map((message) => [message.id, messageKey(message)]));
  const currentKey = (message: AgentChatMessage): string =>
    aliases.get(message.id) ?? messageKey(message);
  const before = new Map(baseline.items.map((message) => [currentKey(message), message]));
  const latest = new Map(current.items.map((message) => [currentKey(message), message]));
  const changed = new Map<string, AgentChatMessage>();
  for (const message of current.items) {
    const key = currentKey(message);
    if (before.get(key) === message) continue;
    if (deltaMessageIds.has(message.id)) {
      throw new Error(
        "Streaming deltas overlap the history read without cumulative coverage. Keep this content visible and reload conversation history after the turn completes.",
      );
    }
    changed.set(key, message);
  }
  const covered = new Set<string>();
  const replacedParents = new Set<string>();
  const currentParents = new Set(
    current.items.flatMap((message) =>
      message.meta?.kind === "assistant" && message.meta.sourceMessageId
        ? [message.meta.sourceMessageId]
        : [],
    ),
  );
  const result: AgentChatMessage[] = [];
  for (const message of loaded.items) {
    const key = messageKey(message);
    covered.add(key);
    const parent = message.meta?.kind === "assistant" ? message.meta.sourceMessageId : undefined;
    if (parent) {
      covered.add(parent);
      if (before.has(parent) && !latest.has(parent) && !currentParents.has(parent)) continue;
      const whole = changed.get(parent);
      if (whole) {
        if (!replacedParents.has(parent)) result.push(whole);
        replacedParents.add(parent);
        continue;
      }
    }
    // Keep messages removed during the read out of the saved history.
    if (before.has(key) && !latest.has(key)) continue;
    const retained = latest.get(key);
    const recovered = changed.get(key) ?? message;
    if (message.role === "user" && retained) {
      const user = { ...recovered, id: retained.id };
      const nativeMessageId =
        retained.meta?.kind === "user" ? retained.meta.nativeMessageId : undefined;
      if (nativeMessageId && user.meta?.kind === "user")
        user.meta = { ...user.meta, nativeMessageId };
      result.push(user);
    } else result.push(recovered);
  }
  for (const message of current.items) {
    const key = currentKey(message);
    if (covered.has(key)) continue;
    if (
      before.has(key) &&
      !changed.has(key) &&
      (message.role !== "user" ||
        (message.id.startsWith("codex-user-") &&
          message.meta?.kind === "user" &&
          message.meta.state === "read")) &&
      message.role !== "system"
    ) {
      throw new Error(
        "Full runtime history did not cover a retained transcript item. Keep the conversation visible and check the assigned runtime history before reloading.",
      );
    }
    result.push(message);
  }
  return createSessionMessagesState(externalSessionId, result, current.version + 1);
};

const messageKey = (message: AgentChatMessage): string => {
  if (message.meta?.kind === "assistant" && message.meta.sourceMessageId) {
    return message.meta.partId
      ? `text:${message.meta.sourceMessageId}:${message.meta.partId}`
      : message.meta.sourceMessageId;
  }
  if (message.meta?.kind === "user" && message.meta.nativeMessageId)
    return message.meta.nativeMessageId;
  return message.id;
};
