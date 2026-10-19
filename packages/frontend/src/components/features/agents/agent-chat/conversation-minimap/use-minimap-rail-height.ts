import { useLayoutEffect, useState } from "react";
import { useNarrowWindow } from "@/features/session-panels/use-narrow-window";
import { useAgentChatSettings } from "../agent-chat-settings-context";
import { MINIMAP_MIN_FRAME_WIDTH_PX, MINIMAP_RAIL_INSET_PX } from "./constants";

type FrameSize = { width: number; height: number };

/**
 * Gives the maximum rail height when the minimap shows, or null when it does not. It shows when
 * the setting is on, the transcript has 2 or more user messages, and the transcript frame is wide
 * enough. A narrow window, where one panel fills the page, is always too narrow.
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
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);

  // The first read runs before paint, so the gutter does not appear one frame late.
  useLayoutEffect(() => {
    if (!canShow || !frame) {
      return;
    }

    const readFrameSize = () => {
      const { width, height } = frame.getBoundingClientRect();
      setFrameSize((current) =>
        current?.width === width && current.height === height ? current : { width, height },
      );
    };
    readFrameSize();
    const observer = new ResizeObserver(readFrameSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame, canShow]);

  if (!canShow || !frameSize || frameSize.width < MINIMAP_MIN_FRAME_WIDTH_PX) {
    return null;
  }
  return Math.max(0, frameSize.height - MINIMAP_RAIL_INSET_PX * 2);
}
