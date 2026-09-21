import type { AgentSessionHistoryMessage } from "@openducktor/core";

const insertByTime = (
  history: AgentSessionHistoryMessage[],
  message: AgentSessionHistoryMessage,
): void => {
  const time = Date.parse(message.timestamp);
  const index = history.findIndex((entry) => Date.parse(entry.timestamp) > time);
  if (index === -1) {
    history.push(message);
    return;
  }
  history.splice(index, 0, message);
};

/** Codex does not include blocking question requests in thread history, so keep live answers for renderer reloads. */
export class CodexQuestionHistory {
  private readonly messages = new Map<string, Map<string, AgentSessionHistoryMessage[]>>();

  add(runtimeId: string, threadId: string, message: AgentSessionHistoryMessage): void {
    const runtime = this.messages.get(runtimeId) ?? new Map<string, AgentSessionHistoryMessage[]>();
    const history = runtime.get(threadId) ?? [];
    const index = history.findIndex((entry) => entry.messageId === message.messageId);
    if (index === -1) {
      history.push(message);
    } else {
      history[index] = message;
    }
    runtime.set(threadId, history);
    this.messages.set(runtimeId, runtime);
  }

  merge(
    runtimeId: string,
    threadId: string,
    history: readonly AgentSessionHistoryMessage[],
  ): AgentSessionHistoryMessage[] {
    const merged = [...history];
    const seen = new Set(history.map((message) => message.messageId));
    for (const message of this.messages.get(runtimeId)?.get(threadId) ?? []) {
      if (seen.has(message.messageId)) continue;
      insertByTime(merged, message);
      seen.add(message.messageId);
    }
    return merged;
  }
}
