import { extractStringField } from "../codex-app-server-shared";
import { codexItemTypeMatches, extractCodexTokenUsageTotals } from "../codex-app-server-transcript";
import type {
  CodexCanonicalAssistantDeltaEvent,
  CodexCanonicalSessionCompactedEvent,
  CodexCanonicalSessionCompactionStartedEvent,
  CodexCanonicalSessionErrorEvent,
  CodexCanonicalSessionIdleEvent,
  CodexCanonicalStreamPartEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";

const toSessionCompactedEvent = (
  ctx: CodexMappingContext,
  messageId?: string,
): CodexCanonicalSessionCompactedEvent => {
  const event: CodexCanonicalSessionCompactedEvent = {
    kind: "session_compacted",
    source: ctx.source,
    mapper: "compaction",
    threadId: ctx.threadId,
    message: "Session compacted.",
  };

  if (ctx.turnId) {
    event.turnId = ctx.turnId;
  }
  if (ctx.timestamp) {
    event.timestamp = ctx.timestamp;
  }
  if (messageId) {
    event.messageId = messageId;
  }

  return event;
};

const toSessionCompactionStartedEvent = (
  ctx: CodexMappingContext,
  messageId?: string,
): CodexCanonicalSessionCompactionStartedEvent => {
  const event: CodexCanonicalSessionCompactionStartedEvent = {
    kind: "session_compaction_started",
    source: ctx.source,
    mapper: "compaction",
    threadId: ctx.threadId,
    message: "Session compaction started.",
  };

  if (ctx.turnId) {
    event.turnId = ctx.turnId;
  }
  if (ctx.timestamp) {
    event.timestamp = ctx.timestamp;
  }
  if (messageId) {
    event.messageId = messageId;
  }

  return event;
};

export const lifecycleMapper: CodexEventMapper = {
  name: "lifecycle",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "notification" || input.notification.method !== "turn/completed") {
      return emptyCodexMappingResult();
    }
    const { turn } = input.notification.params;
    const status = turn.status;
    const events: CodexMappingResult["events"] = [];

    if (status === "failed") {
      const event: CodexCanonicalSessionErrorEvent = {
        kind: "session_error",
        source: ctx.source,
        mapper: "lifecycle",
        threadId: ctx.threadId,
        message: turn.error?.message ?? "Codex turn failed.",
      };
      if (ctx.timestamp) {
        event.timestamp = ctx.timestamp;
      }
      events.push(event);
    }

    const idleEvent: CodexCanonicalSessionIdleEvent = {
      kind: "session_idle",
      source: ctx.source,
      mapper: "lifecycle",
      threadId: ctx.threadId,
    };
    if (ctx.timestamp) {
      idleEvent.timestamp = ctx.timestamp;
    }
    events.push(idleEvent);

    return {
      handled: true,
      events,
    };
  },
  fromThreadItem: emptyCodexMappingResult,
};

export const compactionMapper: CodexEventMapper = {
  name: "compaction",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind === "item_started" && codexItemTypeMatches(input.item, "contextCompaction")) {
      return {
        handled: true,
        events: [toSessionCompactionStartedEvent(ctx, input.item.id)],
      };
    }

    if (input.kind === "item_completed" && codexItemTypeMatches(input.item, "contextCompaction")) {
      return {
        handled: true,
        events: [toSessionCompactedEvent(ctx, input.item.id)],
      };
    }

    return emptyCodexMappingResult();
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!codexItemTypeMatches(input.item, "contextCompaction")) {
      return emptyCodexMappingResult();
    }

    return {
      handled: true,
      events: [toSessionCompactedEvent(ctx, input.item.id)],
    };
  },
};

export const tokenUsageMapper: CodexEventMapper = {
  name: "token_usage",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (
      input.kind !== "notification" ||
      input.notification.method !== "thread/tokenUsage/updated"
    ) {
      return emptyCodexMappingResult();
    }
    const tokenUsage = extractCodexTokenUsageTotals(input.notification.params);
    if (!tokenUsage) {
      return emptyCodexMappingResult();
    }
    const messageId = ctx.turnId ?? ctx.threadId;
    const part: Extract<CodexCanonicalStreamPartEvent["part"], { kind: "step" }> = {
      kind: "step",
      messageId,
      partId: `${messageId}-token-usage`,
      phase: "finish",
      totalTokens: tokenUsage.totalTokens,
    };
    if (tokenUsage.contextWindow !== undefined) {
      part.contextWindow = tokenUsage.contextWindow;
    }
    const event: CodexCanonicalStreamPartEvent = {
      kind: "stream_part",
      source: ctx.source,
      mapper: "token_usage",
      threadId: ctx.threadId,
      part,
    };
    if (ctx.turnId) {
      event.turnId = ctx.turnId;
    }
    if (ctx.timestamp) {
      event.timestamp = ctx.timestamp;
    }
    return {
      handled: true,
      events: [event],
    };
  },
  fromThreadItem: emptyCodexMappingResult,
};
export const deltaMapper: CodexEventMapper = {
  name: "delta",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "notification") {
      return emptyCodexMappingResult();
    }
    const method = input.notification.method;
    const isText = method === "item/agentMessage/delta";
    const isReasoning =
      method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta";
    if (!isText && !isReasoning) {
      return emptyCodexMappingResult();
    }
    const delta = extractStringField(input.notification.params, ["delta"]);
    if (!delta) {
      return emptyCodexMappingResult();
    }
    const messageId = extractStringField(input.notification.params, ["itemId", "item_id"]);
    const event: CodexCanonicalAssistantDeltaEvent = {
      kind: "assistant_delta",
      source: ctx.source,
      mapper: "delta",
      threadId: ctx.threadId,
      channel: isText ? "text" : "reasoning",
      delta,
    };
    if (ctx.timestamp) {
      event.timestamp = ctx.timestamp;
    }
    if (messageId) {
      event.messageId = messageId;
    }
    return {
      handled: true,
      events: [event],
    };
  },
  fromThreadItem: emptyCodexMappingResult,
};
