import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCompactHeight } from "@/ui/use-wide-layout";
import { CREATE_RISE, TAB_BAR } from "./tab-bar-geometry";

/**
 * The bottom space that the tab bar covers, with the create button. A screen of a tab adds it
 * under its scroll content, so its last rows scroll clear of the bar. On iOS, a scroll view with
 * `contentInsetAdjustmentBehavior="automatic"` already adds the bottom safe area, so it passes
 * `automaticInsets` and gets the space without that area. The rail of a low window covers no
 * bottom space.
 */
export const useTabBarSpace = ({
  automaticInsets = false,
}: { automaticInsets?: boolean } = {}): number => {
  const { bottom } = useSafeAreaInsets();
  const safeArea = automaticInsets && Platform.OS === "ios" ? 0 : bottom;
  const rail = useCompactHeight();
  return rail ? safeArea : safeArea + TAB_BAR.height + CREATE_RISE;
};
