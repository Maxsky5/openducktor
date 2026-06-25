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

export const createSubagentMapper = (linkState: CodexSubagentLinkState): CodexEventMapper => ({
  name: "subagent",
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (input.kind !== "item_completed" && input.kind !== "item_started") {
      return emptyCodexMappingResult();
    }
    if (
      !codexItemTypeMatches(input.item, "collabAgentToolCall") &&
      !codexItemTypeMatches(input.item, "subAgentActivity")
    ) {
      return emptyCodexMappingResult();
    }
    return subagentEvents(input.item, ctx, linkState);
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (
      !codexItemTypeMatches(input.item, "collabAgentToolCall") &&
      !codexItemTypeMatches(input.item, "subAgentActivity")
    ) {
      return emptyCodexMappingResult();
    }
    return subagentEvents(input.item, ctx, linkState, input.timestamp);
  },
});
