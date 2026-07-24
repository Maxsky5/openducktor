import { codexItemTypeMatches } from "../codex-app-server-transcript";
import type { CodexMappingContext, CodexMappingResult } from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";
import { codexSubagentPartsFromItem } from "../codex-subagent-items";
import type { CodexSubagentLinkState } from "../codex-subagent-link-state";

const subagentEvents = (
  item: Record<string, unknown>,
  ctx: CodexMappingContext,
  linkState: CodexSubagentLinkState,
  timestamp?: string,
): CodexMappingResult => {
  const parts = codexSubagentPartsFromItem(item, ctx, linkState);
  if (parts.length === 0) {
    if (codexItemTypeMatches(item, "subAgentActivity")) {
      return { handled: true, events: [] };
    }
    return emptyCodexMappingResult();
  }
  const eventTimestamp = ctx.timestamp ?? timestamp;
  return {
    handled: true,
    events: parts.map((part) => ({
      kind: "stream_part",
      source: ctx.source,
      mapper: "subagent",
      threadId: ctx.threadId,
      ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
      ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      raw: item,
      part,
    })),
  };
};

const shouldMapAsSubagentItem = (item: Record<string, unknown>): boolean => {
  const isCollabToolCall =
    codexItemTypeMatches(item, "collabAgentToolCall") ||
    codexItemTypeMatches(item, "collabToolCall");
  if (!isCollabToolCall) {
    return codexItemTypeMatches(item, "subAgentActivity");
  }

  const tool = item.tool;
  const receiverThreadIds = item.receiverThreadIds ?? item.receiver_thread_ids;
  const receiverThreadId =
    item.receiverThreadId ?? item.receiver_thread_id ?? item.newThreadId ?? item.new_thread_id;
  if (tool === "spawnAgent") {
    return true;
  }
  if (Array.isArray(receiverThreadIds)) {
    return receiverThreadIds.length > 0;
  }
  if (receiverThreadIds !== undefined && receiverThreadIds !== null) {
    return true;
  }
  if (typeof receiverThreadId === "string") {
    return receiverThreadId.trim().length > 0;
  }
  return receiverThreadId !== undefined && receiverThreadId !== null;
};

export const createSubagentMapper = (linkState: CodexSubagentLinkState): CodexEventMapper => ({
  name: "subagent",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "item_completed" && input.kind !== "item_started") {
      return emptyCodexMappingResult();
    }
    if (!shouldMapAsSubagentItem(input.item)) {
      return emptyCodexMappingResult();
    }
    return subagentEvents(input.item, ctx, linkState);
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!shouldMapAsSubagentItem(input.item)) {
      return emptyCodexMappingResult();
    }
    return subagentEvents(input.item, ctx, linkState, input.timestamp);
  },
});
