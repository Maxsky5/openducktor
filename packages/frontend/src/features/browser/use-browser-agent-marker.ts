import { useEffect, useState } from "react";
import type { BrowserAgentMarkerPoint } from "./components/browser-agent-marker";
import type { BrowserChannel } from "./browser-channel";

/** The point of the last agent click, hover, or text entry in a tab, so the user sees it. */
export const useBrowserAgentMarker = (
  channel: BrowserChannel,
  tabId: string,
): BrowserAgentMarkerPoint | null => {
  const [marker, setMarker] = useState<BrowserAgentMarkerPoint | null>(null);
  useEffect(() => {
    let count = 0;
    return channel.subscribe((message) => {
      if (message.type !== "agent_marker" || message.tabId !== tabId) return;
      count += 1;
      setMarker({ key: String(count), action: message.action, x: message.x, y: message.y });
    });
  }, [channel, tabId]);
  return marker;
};
