import {
  extractStringField,
  extractText,
  isCodexContextualUserMessage,
} from "../codex-app-server-shared";
import {
  codexItemId,
  codexItemTypeMatches,
  codexUserInputListToText,
  codexUserInputsFromItem,
  codexUserInputsToDisplayParts,
  terminalHistoryPart,
} from "../codex-app-server-transcript";
import type { CodexMappingResult } from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";

export const userMessageMapper: CodexEventMapper = {
  name: "user_message",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "item_completed") {
      return emptyCodexMappingResult();
    }
    return this.fromThreadItem({ item: input.item, index: 0 }, ctx, undefined);
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!codexItemTypeMatches(input.item, "userMessage") && input.item.role !== "user") {
      return emptyCodexMappingResult();
    }
    if (isCodexContextualUserMessage(input.item)) {
      return { handled: true, events: [] };
    }
    const parts = codexUserInputsFromItem(input.item);
    const message =
      parts.length > 0 ? codexUserInputListToText(parts) : (extractText(input.item) ?? "");
    if (message.trim().length === 0) {
      return emptyCodexMappingResult();
    }
    const messageId = codexItemId(input.item, `${ctx.threadId}-user-${input.index}`);
    return {
      handled: true,
      events: [
        {
          kind: "user_message",
          source: ctx.source,
          mapper: "user_message",
          threadId: ctx.threadId,
          ...((ctx.timestamp ?? input.timestamp)
            ? { timestamp: ctx.timestamp ?? input.timestamp }
            : {}),
          raw: input.item,
          messageId,
          message,
          displayParts:
            parts.length > 0
              ? codexUserInputsToDisplayParts(parts, messageId)
              : [{ kind: "text", text: message }],
          state: "read",
        },
      ],
    };
  },
};

export const assistantMessageMapper: CodexEventMapper = {
  name: "assistant_message",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "item_completed") {
      return emptyCodexMappingResult();
    }
    return this.fromThreadItem({ item: input.item, index: 0 }, ctx, undefined);
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!codexItemTypeMatches(input.item, "agentMessage") && input.item.role !== "assistant") {
      return emptyCodexMappingResult();
    }
    const message = extractStringField(input.item, ["text"]) ?? "";
    if (message.trim().length === 0) {
      return emptyCodexMappingResult();
    }
    const messageId = codexItemId(input.item, `${ctx.threadId}-assistant-${input.index}`);
    return {
      handled: true,
      events: [
        {
          kind: "assistant_message",
          source: ctx.source,
          mapper: "assistant_message",
          threadId: ctx.threadId,
          ...((ctx.timestamp ?? input.timestamp)
            ? { timestamp: ctx.timestamp ?? input.timestamp }
            : {}),
          raw: input.item,
          messageId,
          message,
        },
        ...(input.isFinalAgentMessage
          ? [
              {
                kind: "stream_part" as const,
                source: ctx.source,
                mapper: "assistant_message",
                threadId: ctx.threadId,
                ...((ctx.timestamp ?? input.timestamp)
                  ? { timestamp: ctx.timestamp ?? input.timestamp }
                  : {}),
                raw: input.item,
                part: terminalHistoryPart(messageId),
              },
            ]
          : []),
      ],
    };
  },
};
