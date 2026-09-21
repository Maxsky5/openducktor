import { isCodexContextualUserMessage } from "../codex-app-server-shared";
import {
  codexAsyncQuestionReplyTools,
  parseCodexAsyncQuestionItem,
  parseCodexAsyncQuestionReplyInputs,
  parseCodexAsyncQuestionSkipIds,
  stripCodexAsyncQuestionSkipMarker,
} from "../codex-async-questions";
import { codexItemTypeMatches, terminalHistoryPart } from "../codex-app-server-transcript";
import type {
  CodexCanonicalAssistantMessageEvent,
  CodexCanonicalStreamPartEvent,
  CodexCanonicalToolEvent,
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
    const sourceParts = codexUserInputsFromItem(input.item);
    const skippedQuestionRequestIds = parseCodexAsyncQuestionSkipIds(sourceParts);
    const parts = stripCodexAsyncQuestionSkipMarker(sourceParts);
    const message = codexUserInputListToText(parts);
    const asyncQuestionReplies = parseCodexAsyncQuestionReplyInputs(parts);
    if (!asyncQuestionReplies && isCodexContextualUserMessage(input.item)) {
      return { handled: true, events: [] };
    }
    const messageId = input.item.id;
    const timestamp = ctx.timestamp ?? input.timestamp;
    if (asyncQuestionReplies) {
      const events = codexAsyncQuestionReplyTools(asyncQuestionReplies).map(
        ({ requestId, invocation }): CodexCanonicalToolEvent => {
          const event: CodexCanonicalToolEvent = {
            kind: "tool",
            source: ctx.source,
            mapper: "user_message",
            threadId: ctx.threadId,
            invocation,
            resolvedQuestionRequestIds: [requestId],
          };
          if (timestamp) event.timestamp = timestamp;
          return event;
        },
      );
      return { handled: true, events };
    }
    const displayParts = codexUserInputsToDisplayParts(parts, messageId);
    const hasAttachment = displayParts.some((part) => part.kind === "attachment");
    if (message.trim().length === 0 && !hasAttachment) {
      return emptyCodexMappingResult();
    }
    const event: CodexCanonicalUserMessageEvent = {
      kind: "user_message",
      source: ctx.source,
      mapper: "user_message",
      threadId: ctx.threadId,
      messageId,
      message,
      displayParts,
      state: "read",
    };
    if (skippedQuestionRequestIds !== undefined) {
      event.resolvedQuestionRequestIds = [...new Set(skippedQuestionRequestIds)];
    }
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
    const asyncQuestion = parseCodexAsyncQuestionItem(input.item);
    if (message.trim().length === 0 && asyncQuestion.kind === "not_async_question") {
      return emptyCodexMappingResult();
    }
    const messageId = input.item.id;
    const timestamp = ctx.timestamp ?? input.timestamp;
    if (asyncQuestion.kind === "invalid") {
      const event: CodexCanonicalStreamPartEvent = {
        kind: "stream_part",
        source: ctx.source,
        mapper: "assistant_message",
        threadId: ctx.threadId,
        part: {
          kind: "text",
          messageId,
          partId: `${messageId}:question-error`,
          text: asyncQuestion.error,
          completed: true,
        },
      };
      if (timestamp) {
        event.timestamp = timestamp;
      }
      return {
        handled: true,
        events: [event],
      };
    }
    const events: CodexMappingResult["events"] = [];
    const assistantMessageEvent: CodexCanonicalAssistantMessageEvent = {
      kind: "assistant_message",
      source: ctx.source,
      mapper: "assistant_message",
      threadId: ctx.threadId,
      messageId,
      message,
    };
    if (asyncQuestion.kind === "question") {
      assistantMessageEvent.questionRequest = asyncQuestion.request;
    }
    if (timestamp) {
      assistantMessageEvent.timestamp = timestamp;
    }
    events.push(assistantMessageEvent);
    if (input.isFinalAgentMessage && asyncQuestion.kind === "not_async_question") {
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
