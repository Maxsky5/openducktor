import { isCodexContextualUserMessage } from "../codex-app-server-shared";
import {
  codexItemId,
  codexItemTypeMatches,
  terminalHistoryPart,
} from "../codex-app-server-transcript";
import type { CodexMappingResult } from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";
import {
  codexUserInputListToText,
  codexUserInputsToDisplayParts,
} from "../codex-user-input-display";
import { codexUserInputsFromItem } from "../codex-user-inputs";

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
    if (!codexItemTypeMatches(input.item, "userMessage")) {
      return emptyCodexMappingResult();
    }
    if (isCodexContextualUserMessage(input.item)) {
      return { handled: true, events: [] };
    }
    const parts = codexUserInputsFromItem(input.item);
    const message = codexUserInputListToText(parts);
    if (message.trim().length === 0) {
      return emptyCodexMappingResult();
    }
    const messageId = codexItemId(input.item, `${ctx.threadId}-user-${input.index}`);
    const timestamp = ctx.timestamp ?? input.timestamp;
    return {
      handled: true,
      events: [
        {
          kind: "user_message",
          source: ctx.source,
          mapper: "user_message",
          threadId: ctx.threadId,
          ...(timestamp ? { timestamp } : undefined),
          messageId,
          message,
          displayParts: codexUserInputsToDisplayParts(parts, messageId),
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
    if (!codexItemTypeMatches(input.item, "agentMessage")) {
      return emptyCodexMappingResult();
    }
    const message = input.item.text;
    if (message.trim().length === 0) {
      return emptyCodexMappingResult();
    }
    const messageId = codexItemId(input.item, `${ctx.threadId}-assistant-${input.index}`);
    const timestamp = ctx.timestamp ?? input.timestamp;
    return {
      handled: true,
      events: [
        {
          kind: "assistant_message",
          source: ctx.source,
          mapper: "assistant_message",
          threadId: ctx.threadId,
          ...(timestamp ? { timestamp } : undefined),
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
                ...(timestamp ? { timestamp } : undefined),
                part: terminalHistoryPart(messageId),
              },
            ]
          : []),
      ],
    };
  },
};
