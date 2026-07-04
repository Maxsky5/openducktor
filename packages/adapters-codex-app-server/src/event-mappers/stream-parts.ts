import { arrayFromUnknown, extractStringField, isPlainObject } from "../codex-app-server-shared";
import { codexItemTypeMatches, toStreamPart } from "../codex-app-server-transcript";
import type { CodexMappingContext, CodexMappingResult } from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";
import type { CodexToolTimingOptions } from "../codex-tool-timing";
import { emptyMapper } from "./empty";

const streamPartEvents = (
  name: string,
  ctx: CodexMappingContext,
  raw: unknown,
  item: Record<string, unknown>,
  messageId: string,
  partId: string,
  timestamp?: string,
  timingOptions?: CodexToolTimingOptions,
): CodexMappingResult => ({
  handled: true,
  events: toStreamPart(item, messageId, partId, timingOptions).map((part) => {
    const eventTimestamp = ctx.timestamp ?? timestamp;
    return {
      kind: "stream_part",
      source: ctx.source,
      mapper: name,
      threadId: ctx.threadId,
      ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
      ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      raw,
      part,
    };
  }),
});

const streamPartMapper = (name: string, itemType: string): CodexEventMapper => ({
  name,
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "item_completed" && input.kind !== "item_started") {
      return emptyCodexMappingResult();
    }
    if (!codexItemTypeMatches(input.item, itemType)) {
      return emptyCodexMappingResult();
    }
    const itemId =
      typeof input.item.id === "string" ? input.item.id : `${ctx.threadId}-${name}-${Date.now()}`;
    return streamPartEvents(name, ctx, input.item, input.item, itemId, itemId, undefined, {
      allowStartedAtOnly: input.kind === "item_started",
    });
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!codexItemTypeMatches(input.item, itemType)) {
      return emptyCodexMappingResult();
    }
    const itemId =
      typeof input.item.id === "string" ? input.item.id : `${ctx.threadId}-${name}-${input.index}`;
    return streamPartEvents(name, ctx, input.item, input.item, itemId, itemId, input.timestamp);
  },
});

export const fileChangeMapper: CodexEventMapper = {
  name: "file_change",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (
      input.kind !== "notification" ||
      input.notification.method !== "item/fileChange/patchUpdated"
    ) {
      return emptyCodexMappingResult();
    }

    const params = isPlainObject(input.notification.params) ? input.notification.params : null;
    const itemId = extractStringField(params, ["itemId", "item_id"]);
    const changes = arrayFromUnknown(params?.changes);
    if (!itemId || changes.length === 0) {
      return emptyCodexMappingResult();
    }

    return streamPartEvents(
      this.name,
      ctx,
      input.notification,
      {
        type: "fileChange",
        id: itemId,
        changes,
        status: "inProgress",
      },
      itemId,
      itemId,
    );
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!codexItemTypeMatches(input.item, "fileChange")) {
      return emptyCodexMappingResult();
    }
    const itemId =
      typeof input.item.id === "string"
        ? input.item.id
        : `${ctx.threadId}-file_change-${input.index}`;
    return streamPartEvents(
      this.name,
      ctx,
      input.item,
      input.item,
      itemId,
      itemId,
      input.timestamp,
    );
  },
};

export const reasoningMapper = streamPartMapper("reasoning", "reasoning");
export const planMapper = streamPartMapper("plan", "plan");
export const commandToolMapper = streamPartMapper("command_tool", "commandExecution");
export const mcpToolMapper = streamPartMapper("mcp_tool", "mcpToolCall");
export const webSearchMapper = streamPartMapper("web_search", "webSearch");
export const collabToolMapper = streamPartMapper("collab_tool", "collabAgentToolCall");
export const dynamicToolMapper = streamPartMapper("dynamic_tool", "dynamicToolCall");
export const hiddenItemMapper = emptyMapper("hidden_item");
