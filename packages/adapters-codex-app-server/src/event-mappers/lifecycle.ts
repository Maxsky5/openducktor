import { extractStringField } from "../codex-app-server-shared";
import { codexItemTypeMatches, extractCodexTokenUsageTotals } from "../codex-app-server-transcript";
import type {
  CodexCanonicalSessionCompactedEvent,
  CodexCanonicalSessionCompactionStartedEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";

const toSessionCompactedEvent = (
  ctx: CodexMappingContext,
  messageId?: string,
): CodexCanonicalSessionCompactedEvent => ({
  kind: "session_compacted",
  source: ctx.source,
  mapper: "compaction",
  threadId: ctx.threadId,
  ...(ctx.turnId ? { turnId: ctx.turnId } : undefined),
  ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
  ...(messageId ? { messageId } : undefined),
  message: "Session compacted.",
});

const toSessionCompactionStartedEvent = (
  ctx: CodexMappingContext,
  messageId?: string,
): CodexCanonicalSessionCompactionStartedEvent => ({
  kind: "session_compaction_started",
  source: ctx.source,
  mapper: "compaction",
  threadId: ctx.threadId,
  ...(ctx.turnId ? { turnId: ctx.turnId } : undefined),
  ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
  ...(messageId ? { messageId } : undefined),
  message: "Session compaction started.",
});

export const lifecycleMapper: CodexEventMapper = {
  name: "lifecycle",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "notification" || input.notification.method !== "turn/completed") {
      return emptyCodexMappingResult();
    }
    const { turn } = input.notification.params;
    const status = turn.status;
    return {
      handled: true,
      events: [
        ...(status === "failed"
          ? [
              {
                kind: "session_error" as const,
                source: ctx.source,
                mapper: "lifecycle",
                threadId: ctx.threadId,
                ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
                message: turn.error?.message ?? "Codex turn failed.",
              },
            ]
          : []),
        {
          kind: "session_idle",
          source: ctx.source,
          mapper: "lifecycle",
          threadId: ctx.threadId,
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
        },
      ],
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
    return {
      handled: true,
      events: [
        {
          kind: "stream_part",
          source: ctx.source,
          mapper: "token_usage",
          threadId: ctx.threadId,
          ...(ctx.turnId ? { turnId: ctx.turnId } : undefined),
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
          part: {
            kind: "step",
            messageId,
            partId: `${messageId}-token-usage`,
            phase: "finish",
            totalTokens: tokenUsage.totalTokens,
            ...(typeof tokenUsage.contextWindow === "number"
              ? { contextWindow: tokenUsage.contextWindow }
              : undefined),
          },
        },
      ],
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
    return {
      handled: true,
      events: [
        {
          kind: "assistant_delta",
          source: ctx.source,
          mapper: "delta",
          threadId: ctx.threadId,
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : undefined),
          ...(messageId ? { messageId } : undefined),
          channel: isText ? "text" : "reasoning",
          delta,
        },
      ],
    };
  },
  fromThreadItem: emptyCodexMappingResult,
};
