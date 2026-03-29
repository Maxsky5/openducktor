import { CHAT_OVERSCAN, CHAT_WINDOW_SIZE } from "./agent-chat-thread-windowing";

export type WindowRange = {
  start: number;
  end: number;
};

export type PendingScrollRequest = {
  target: "top" | "bottom";
  behavior: ScrollBehavior;
  suppressSentinels: boolean;
  animationDurationMs?: number;
};

export const CHAT_AUTO_SCROLL_ANIMATION_DURATION_MS = 500;
export const CHAT_SCROLL_EDGE_THRESHOLD_PX = 48;
export const CHAT_SENTINEL_ROOT_MARGIN_PX = 96;
export const CHAT_MAX_RENDERED_ROWS = CHAT_WINDOW_SIZE + CHAT_OVERSCAN * 2;
export const EMPTY_WINDOW: WindowRange = { start: 0, end: -1 };

export const clampWindowRange = (range: WindowRange, rowCount: number): WindowRange => {
  if (rowCount <= 0) {
    return EMPTY_WINDOW;
  }

  const maxIndex = rowCount - 1;
  const end = Math.max(0, Math.min(range.end, maxIndex));
  const start = Math.max(0, Math.min(range.start, end));
  return { start, end };
};

export const createBottomAnchoredWindow = (rowCount: number): WindowRange => {
  if (rowCount <= 0) {
    return EMPTY_WINDOW;
  }

  return clampWindowRange(
    {
      start: Math.max(0, rowCount - CHAT_WINDOW_SIZE - CHAT_OVERSCAN),
      end: rowCount - 1,
    },
    rowCount,
  );
};
