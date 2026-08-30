import { isCodexContextualUserMessage } from "../codex-app-server-shared";
import { codexItemTypeMatches, terminalHistoryPart } from "../codex-app-server-transcript";
import type {
  CodexCanonicalAssistantMessageEvent,
  CodexCanonicalStreamPartEvent,
  CodexCanonicalUserMessageEvent,
  CodexMappingResult,
} from "../codex-canonical-events";
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
    const messageId = input.item.id;
    const timestamp = ctx.timestamp ?? input.timestamp;
    const event: CodexCanonicalUserMessageEvent = {
      kind: "user_message",
      source: ctx.source,
      mapper: "user_message",
      threadId: ctx.threadId,
      messageId,
      message,
      displayParts: codexUserInputsToDisplayParts(parts, messageId),
      state: "read",
    };
    if (timestamp) {
      event.timestamp = timestamp;
    }
    return {
      handled: true,
      events: [event],
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
    const messageId = input.item.id;
    const timestamp = ctx.timestamp ?? input.timestamp;
    const events: CodexMappingResult["events"] = [];
    const assistantMessageEvent: CodexCanonicalAssistantMessageEvent = {
      kind: "assistant_message",
      source: ctx.source,
      mapper: "assistant_message",
      threadId: ctx.threadId,
      messageId,
      message,
    };
    if (timestamp) {
      assistantMessageEvent.timestamp = timestamp;
    }
    events.push(assistantMessageEvent);
    if (input.isFinalAgentMessage) {
      const terminalPartEvent: CodexCanonicalStreamPartEvent = {
        kind: "stream_part",
        source: ctx.source,
        mapper: "assistant_message",
        threadId: ctx.threadId,
        part: terminalHistoryPart(messageId),
      };
      if (timestamp) {
        terminalPartEvent.timestamp = timestamp;
      }
      events.push(terminalPartEvent);
    }
    return {
      handled: true,
      events,
    };
  },
};
