import { codexItemTypeMatches, toStreamPart } from "../codex-app-server-transcript";
import type { CodexMappingResult } from "../codex-canonical-events";
import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";
import { emptyMapper } from "./empty";

const streamPartMapper = (name: string, itemType: string): CodexEventMapper => ({
  name,
  createState: noCodexMapperState,
  fromLive(input, ctx): CodexMappingResult {
    if (
      (input.kind !== "item_completed" && input.kind !== "item_started") ||
      !codexItemTypeMatches(input.item, itemType)
    ) {
      return emptyCodexMappingResult();
    }
    const itemId =
      typeof input.item.id === "string" ? input.item.id : `${ctx.threadId}-${name}-${Date.now()}`;
    return {
      handled: true,
      events: toStreamPart(input.item, itemId, itemId).map((part) => ({
        kind: "stream_part",
        source: ctx.source,
        mapper: name,
        threadId: ctx.threadId,
        ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
        ...(ctx.timestamp ? { timestamp: ctx.timestamp } : {}),
        raw: input.item,
        part,
      })),
    };
  },
  fromThreadItem(input, ctx): CodexMappingResult {
    if (!codexItemTypeMatches(input.item, itemType)) {
      return emptyCodexMappingResult();
    }
    const itemId =
      typeof input.item.id === "string" ? input.item.id : `${ctx.threadId}-${name}-${input.index}`;
    return {
      handled: true,
      events: toStreamPart(input.item, itemId, itemId).map((part) => ({
        kind: "stream_part",
        source: ctx.source,
        mapper: name,
        threadId: ctx.threadId,
        ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
        ...((ctx.timestamp ?? input.timestamp)
          ? { timestamp: ctx.timestamp ?? input.timestamp }
          : {}),
        raw: input.item,
        part,
      })),
    };
  },
});

export const reasoningMapper = streamPartMapper("reasoning", "reasoning");
export const planMapper = streamPartMapper("plan", "plan");
export const commandToolMapper = streamPartMapper("command_tool", "commandExecution");
export const fileChangeMapper = streamPartMapper("file_change", "fileChange");
export const mcpToolMapper = streamPartMapper("mcp_tool", "mcpToolCall");
export const webSearchMapper = streamPartMapper("web_search", "webSearch");
export const collabToolMapper = streamPartMapper("collab_tool", "collabAgentToolCall");
export const dynamicToolMapper = streamPartMapper("dynamic_tool", "dynamicToolCall");
export const hiddenItemMapper = emptyMapper("hidden_item");
