import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

export type VirtualWindowRange = {
  startIndex: number;
  endIndex: number;
};

type FindVirtualWindowRangeArgs = {
  itemOffsets: number[];
  itemHeights: number[];
  totalHeight: number;
  viewportStart: number;
  viewportEnd: number;
};

type VirtualWindowEdgeOffsetsArgs = {
  range: VirtualWindowRange;
  itemOffsets: number[];
  itemHeights: number[];
  totalHeight: number;
};

type BuildVirtualRowLayoutArgs = {
  itemHeights: number[];
  gapPx: number;
};

export const AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT = 40;
export const AGENT_CHAT_VIRTUAL_OVERSCAN_PX = 480;
export const AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS = 8;
export const AGENT_CHAT_VIRTUAL_ROW_GAP_PX = 4;

const UNMEASURED_MESSAGE_HEIGHT_PX = 0;
const ESTIMATED_TURN_DURATION_HEIGHT_PX = 36;
const ESTIMATED_STREAMING_DRAFT_HEIGHT_PX = 88;
const ESTIMATED_THINKING_HEIGHT_PX = 44;

const EMPTY_RANGE: VirtualWindowRange = { startIndex: 0, endIndex: -1 };

export type AgentChatVirtualRow =
  | {
      kind: "turn_duration";
      key: string;
      durationMs: number;
      estimatedHeightPx: number;
    }
  | {
      kind: "message";
      key: string;
      message: AgentChatMessage;
      estimatedHeightPx: number;
    }
  | {
      kind: "draft";
      key: string;
      draftText: string;
      estimatedHeightPx: number;
    }
  | {
      kind: "thinking";
      key: string;
      estimatedHeightPx: number;
    };

export function buildAgentChatVirtualRows(session: AgentSessionState): AgentChatVirtualRow[] {
  const rows: AgentChatVirtualRow[] = [];

  for (const message of session.messages) {
    const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
    const turnDurationMs = assistantMeta?.durationMs;
    const shouldShowTurnDuration =
      message.role === "assistant" && typeof turnDurationMs === "number" && turnDurationMs > 0;

    if (shouldShowTurnDuration) {
      rows.push({
        kind: "turn_duration",
        // Scope virtual row identity to the active session to avoid cross-session cache reuse.
        key: `${session.sessionId}:${message.id}:duration`,
        durationMs: turnDurationMs,
        estimatedHeightPx: ESTIMATED_TURN_DURATION_HEIGHT_PX,
      });
    }

    rows.push({
      kind: "message",
      // Message IDs can repeat across sessions; include session ID for stable virtualization keys.
      key: `${session.sessionId}:${message.id}`,
      message,
      estimatedHeightPx: UNMEASURED_MESSAGE_HEIGHT_PX,
    });
  }

  if (session.draftAssistantText) {
    rows.push({
      kind: "draft",
      key: `${session.sessionId}:draft`,
      draftText: session.draftAssistantText,
      estimatedHeightPx: ESTIMATED_STREAMING_DRAFT_HEIGHT_PX,
    });
  }

  if (
    session.status === "running" &&
    !session.draftAssistantText &&
    session.pendingQuestions.length === 0
  ) {
    rows.push({
      kind: "thinking",
      key: `${session.sessionId}:thinking`,
      estimatedHeightPx: ESTIMATED_THINKING_HEIGHT_PX,
    });
  }

  return rows;
}

export function buildVirtualRowLayout({ itemHeights, gapPx }: BuildVirtualRowLayoutArgs): {
  itemOffsets: number[];
  totalHeight: number;
} {
  const safeGapPx = Math.max(0, gapPx);
  const itemOffsets = new Array<number>(itemHeights.length);
  let nextOffset = 0;

  for (let index = 0; index < itemHeights.length; index += 1) {
    itemOffsets[index] = nextOffset;
    const safeHeight = Math.max(0, itemHeights[index] ?? 0);
    nextOffset += safeHeight;
    if (index < itemHeights.length - 1) {
      nextOffset += safeGapPx;
    }
  }

  return { itemOffsets, totalHeight: nextOffset };
}

export function findVirtualWindowRange({
  itemOffsets,
  itemHeights,
  totalHeight,
  viewportStart,
  viewportEnd,
}: FindVirtualWindowRangeArgs): VirtualWindowRange {
  if (itemHeights.length === 0) {
    return EMPTY_RANGE;
  }

  const minViewport = Math.min(viewportStart, viewportEnd);
  const maxViewport = Math.max(viewportStart, viewportEnd);

  if (maxViewport < 0 || minViewport > totalHeight) {
    return EMPTY_RANGE;
  }

  const start = Math.max(0, minViewport);
  const end = Math.max(0, maxViewport);
  const firstIndex = findFirstIndexWithEndAfterStart(itemOffsets, itemHeights, start);
  const lastIndex = findLastIndexWithStartBeforeEnd(itemOffsets, end);

  if (firstIndex < 0 || lastIndex < firstIndex) {
    return EMPTY_RANGE;
  }

  return { startIndex: firstIndex, endIndex: lastIndex };
}

export function getVirtualWindowEdgeOffsets({
  range,
  itemOffsets,
  itemHeights,
  totalHeight,
}: VirtualWindowEdgeOffsetsArgs): { topSpacerHeight: number; bottomSpacerHeight: number } {
  if (range.endIndex < range.startIndex || itemHeights.length === 0) {
    return { topSpacerHeight: 0, bottomSpacerHeight: totalHeight };
  }

  const topSpacerHeight = itemOffsets[range.startIndex] ?? 0;
  const visibleWindowEnd = (itemOffsets[range.endIndex] ?? 0) + (itemHeights[range.endIndex] ?? 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - visibleWindowEnd);

  return { topSpacerHeight, bottomSpacerHeight };
}

export function normalizeVirtualWindowRange(
  range: VirtualWindowRange,
  itemCount: number,
): VirtualWindowRange {
  if (itemCount <= 0) {
    return EMPTY_RANGE;
  }

  const lastIndex = itemCount - 1;
  const startIndex = Math.min(Math.max(range.startIndex, 0), lastIndex);
  const endIndex = Math.min(Math.max(range.endIndex, startIndex), lastIndex);

  return { startIndex, endIndex };
}

function findFirstIndexWithEndAfterStart(
  itemOffsets: number[],
  itemHeights: number[],
  start: number,
): number {
  let low = 0;
  let high = itemOffsets.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const itemEnd = (itemOffsets[mid] ?? 0) + (itemHeights[mid] ?? 0);
    if (itemEnd >= start) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return candidate;
}

function findLastIndexWithStartBeforeEnd(itemOffsets: number[], end: number): number {
  let low = 0;
  let high = itemOffsets.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const itemStart = itemOffsets[mid] ?? 0;
    if (itemStart <= end) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
}
