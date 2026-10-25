import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Reads `text` to VoiceOver when it appears or changes, after the current speech. iOS has no live
 * regions, so this does the work of `accessibilityLiveRegion="polite"`, which Android reads.
 */
export const useAnnounce = (text: string | null | undefined): void => {
  useEffect(() => {
    if (Platform.OS === "ios" && text) {
      AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
    }
  }, [text]);
};
