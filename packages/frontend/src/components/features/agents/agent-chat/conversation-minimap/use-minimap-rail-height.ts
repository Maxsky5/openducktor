import { useLayoutEffect, useRef, useState } from "react";
import { useNarrowWindow } from "@/features/session-panels/use-narrow-window";
import { useAgentChatSettings } from "../agent-chat-settings-context";
import { MINIMAP_MIN_FRAME_WIDTH_PX, MINIMAP_RAIL_INSET_PX } from "./constants";

/**
 * Gives the maximum rail height when the minimap shows, or null when it does not. It shows when
 * the setting is on, the transcript has 2 or more user messages, and the transcript frame is wide
 * enough. A narrow window, where one panel fills the page, is always too narrow.
 *
 * Only the rail height is state. A horizontal panel resize changes the frame width, and a state
 * update for the width would render the whole transcript on every drag step. The width only
 * selects whether the rail shows.
 *
 * The frame does not change with the minimap gutter, so the gutter cannot toggle the minimap.
 */
export function useMinimapRailHeight(
  frame: HTMLElement | null,
  messageCount: number,
): number | null {
  // Settings are null until they load, and the minimap stays hidden until then.
  const isEnabled = useAgentChatSettings()?.showConversationMinimap === true;
  const isNarrowWindow = useNarrowWindow();
  const canShow = isEnabled && messageCount >= 2 && !isNarrowWindow;
  const [railHeight, setRailHeight] = useState<number | null>(null);
  const railHeightRef = useRef<number | null>(null);

  // The first read runs before paint, so the gutter does not appear one frame late.
  useLayoutEffect(() => {
    if (!canShow || !frame) {
      return;
    }

    const readRailHeight = () => {
      const { width, height } = frame.getBoundingClientRect();
      const next =
        width < MINIMAP_MIN_FRAME_WIDTH_PX ? null : Math.max(0, height - MINIMAP_RAIL_INSET_PX * 2);
      if (railHeightRef.current === next) return;
      railHeightRef.current = next;
      setRailHeight(next);
    };
    readRailHeight();
    const observer = new ResizeObserver(readRailHeight);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame, canShow]);

  return canShow ? railHeight : null;
}
