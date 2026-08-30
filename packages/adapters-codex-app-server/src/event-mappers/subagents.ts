import { codexItemTypeMatches } from "../codex-app-server-transcript";
import type {
  CodexCanonicalStreamPartEvent,
  CodexMappingContext,
  CodexMappingResult,
} from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper, CodexTimedThreadItem } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";
import { codexSubagentPartsFromItem } from "../codex-subagent-items";
import type { CodexSubagentLinkState } from "../codex-subagent-link-state";

type CodexSubagentItem = Extract<
  CodexTimedThreadItem,
  { type: "collabAgentToolCall" | "subAgentActivity" }
>;

const subagentEvents = (
  item: CodexSubagentItem,
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
    events: parts.map((part) => {
      const event: CodexCanonicalStreamPartEvent = {
        kind: "stream_part",
        source: ctx.source,
        mapper: "subagent",
        threadId: ctx.threadId,
        part,
      };
      if (ctx.turnId) {
        event.turnId = ctx.turnId;
      }
      if (eventTimestamp) {
        event.timestamp = eventTimestamp;
      }
      return event;
    }),
  };
};

const shouldMapAsSubagentItem = (item: CodexTimedThreadItem): item is CodexSubagentItem => {
  if (codexItemTypeMatches(item, "subAgentActivity")) {
    return true;
  }
  return (
    codexItemTypeMatches(item, "collabAgentToolCall") &&
    (item.tool === "spawnAgent" || item.receiverThreadIds.length > 0)
  );
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
