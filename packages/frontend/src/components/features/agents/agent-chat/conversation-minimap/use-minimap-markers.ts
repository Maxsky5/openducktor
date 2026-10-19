import { useLayoutEffect, useState } from "react";
import type { AgentChatUserMessageAnchor } from "../agent-chat-transcript-model";
import type { AgentChatTranscriptNavigation } from "../use-agent-chat-transcript-navigation";
import {
  areMinimapMarkersEqual,
  EMPTY_MINIMAP_MARKERS,
  type MinimapMarkers,
  readMinimapMarkers,
} from "./conversation-minimap-markers";

/** Follows the viewport rows of the transcript at most once per frame. */
export function useMinimapMarkers(
  anchors: AgentChatUserMessageAnchor[],
  navigation: AgentChatTranscriptNavigation,
): MinimapMarkers {
  const [markers, setMarkers] = useState(EMPTY_MINIMAP_MARKERS);
  useLayoutEffect(() => {
    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const next = readMinimapMarkers(anchors, navigation.readViewportRows());
      setMarkers((current) => (areMinimapMarkersEqual(current, next) ? current : next));
    };
    update();
    const unsubscribe = navigation.subscribeViewportRows(() => {
      frameId ??= requestAnimationFrame(update);
    });
    return () => {
      unsubscribe();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [anchors, navigation]);
  return markers;
}
