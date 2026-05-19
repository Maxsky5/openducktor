import { extractStringField, extractText, isPlainObject } from "../codex-app-server-shared";
import { extractCodexTokenUsageTotals } from "../codex-app-server-transcript";
import type { CodexMappingResult } from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";

export const lifecycleMapper: CodexEventMapper = {
  name: "lifecycle",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "notification" || input.notification.method !== "turn/completed") {
      return emptyCodexMappingResult();
    }
    const turn = isPlainObject(input.notification.params) ? input.notification.params.turn : null;
    if (!isPlainObject(turn)) {
      return emptyCodexMappingResult();
    }
    const status = extractStringField(turn, ["status"]);
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
                ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
                raw: turn,
                message:
                  (isPlainObject(turn.error) ? extractText(turn.error) : null) ??
                  "Codex turn failed.",
              },
            ]
          : []),
        {
          kind: "session_idle",
          source: ctx.source,
          mapper: "lifecycle",
          threadId: ctx.threadId,
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
          raw: turn,
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
    if (input.kind !== "notification" || input.notification.method !== "thread/compacted") {
      return emptyCodexMappingResult();
    }

    return {
      handled: true,
      events: [
        {
          kind: "session_compacted",
          source: ctx.source,
          mapper: "compaction",
          threadId: ctx.threadId,
          ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
          raw: input.notification.params,
          message: "Session compacted.",
        },
      ],
    };
  },
  fromThreadItem: emptyCodexMappingResult,
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
          ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
          raw: input.notification.params,
          part: {
            kind: "step",
            messageId,
            partId: `${messageId}-token-usage`,
            phase: "finish",
            totalTokens: tokenUsage.totalTokens,
            ...(typeof tokenUsage.contextWindow === "number"
              ? { contextWindow: tokenUsage.contextWindow }
              : {}),
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
    const isReasoning = [
      "item/reasoningText/delta",
      "item/reasoningSummaryText/delta",
      "item/reasoning/textDelta",
      "item/reasoning/summaryTextDelta",
    ].includes(method);
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
          ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
          ...(messageId ? { messageId } : {}),
          channel: isText ? "text" : "reasoning",
          delta,
          raw: input.notification.params,
        },
      ],
    };
  },
  fromThreadItem: emptyCodexMappingResult,
};
