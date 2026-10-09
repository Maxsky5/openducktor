import type {
  AgentEvent,
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentStreamPart,
} from "@openducktor/core";

type AssistantMessage = Extract<AgentSessionHistoryMessage, { role: "assistant" }>;

// Codex flushes its first rollout before turn completion. Until then, history must come from the live stream.
export class CodexFirstTurnHistory {
  private readonly messages = new Map<string, AgentSessionHistoryMessage>();

  record(event: AgentEvent, model: AgentModelSelection | undefined): void {
    if (event.type === "user_message") {
      const message: AgentSessionHistoryMessage = {
        messageId: event.messageId,
        role: "user",
        timestamp: event.timestamp,
        text: event.message,
        displayParts: event.parts,
        state: event.state,
        parts: [],
      };
      const userModel = event.model ?? model;
      if (userModel) message.model = userModel;
      if (event.resolvedQuestionRequestIds !== undefined) {
        message.resolvedQuestionRequestIds = event.resolvedQuestionRequestIds;
      }
      this.messages.set(event.messageId, message);
      return;
    }
    if (event.type === "assistant_delta" && event.messageId) {
      const message = this.assistant(event.messageId, event.timestamp, model);
      if (event.channel === "text") {
        message.text += event.delta;
      } else {
        const part = message.parts.find((part) => part.partId === event.messageId);
        this.setPart(message, {
          kind: "reasoning",
          messageId: event.messageId,
          partId: event.messageId,
          text: (part?.kind === "reasoning" ? part.text : "") + event.delta,
          completed: false,
        });
      }
      return;
    }
    if (event.type === "assistant_message") {
      const message = this.assistant(event.messageId, event.timestamp, event.model ?? model);
      message.text = event.message;
      if (event.durationMs !== undefined) message.durationMs = event.durationMs;
      if (event.totalTokens !== undefined) message.totalTokens = event.totalTokens;
      if (event.contextWindow !== undefined) message.contextWindow = event.contextWindow;
      if (event.questionRequest) message.questionRequest = event.questionRequest;
      return;
    }
    if (event.type === "assistant_part") {
      const message = this.assistant(event.part.messageId, event.timestamp, model);
      // Keep the live message ID so the final reply updates this row.
      if (event.part.kind === "text" && !event.part.synthetic) {
        message.text = event.part.text;
        return;
      }
      this.setPart(message, event.part);
      return;
    }
    if (event.type === "question_required" && event.blocking === false) {
      const message = this.assistant(event.requestId, event.timestamp, model);
      message.questionRequest = {
        requestId: event.requestId,
        questions: event.questions,
        blocking: false,
      };
      return;
    }
    if (event.type === "session_compacted") {
      const messageId = event.messageId ?? `session-compacted:${event.timestamp}`;
      this.messages.set(messageId, {
        messageId,
        role: "system",
        timestamp: event.timestamp,
        text: event.message,
        notice: { tone: "info", reason: "session_compacted", title: "Compacted" },
        parts: [],
      });
    }
  }

  snapshot(): AgentSessionHistoryMessage[] {
    return structuredClone([...this.messages.values()]);
  }

  private setPart(message: AssistantMessage, part: AgentStreamPart): void {
    const index = message.parts.findIndex((current) => current.partId === part.partId);
    if (index === -1) message.parts.push(part);
    else message.parts[index] = part;
  }

  private assistant(
    messageId: string,
    timestamp: string,
    model: AgentModelSelection | undefined,
  ): AssistantMessage {
    const existing = this.messages.get(messageId);
    if (existing?.role === "assistant") {
      if (model) existing.model = model;
      return existing;
    }
    const message: AssistantMessage = {
      messageId,
      role: "assistant",
      timestamp,
      text: "",
      parts: [],
    };
    if (model) message.model = model;
    this.messages.set(messageId, message);
    return message;
  }
}
