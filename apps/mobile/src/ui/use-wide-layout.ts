import { useWindowDimensions } from "react-native";
import { breakpoints } from "@/theme/unistyles";

/** A window lower than this is a phone in landscape. Its content needs all the height it can get. */
const COMPACT_HEIGHT = 500;

/**
 * True from the `md` breakpoint on a window with room in both directions, as on a tablet. Screens
 * then show two panes side by side, such as a list and its selected item.
 */
export const useWideLayout = (): boolean => {
  const { width, height } = useWindowDimensions();
  return width >= breakpoints.md && height >= COMPACT_HEIGHT;
};

/**
 * True for a low window, such as a phone in landscape. The navigation then moves to a rail on
 * the left edge, and screens move side information to the right edge, so the content keeps the
 * height.
 */
export const useCompactHeight = (): boolean => useWindowDimensions().height < COMPACT_HEIGHT;
