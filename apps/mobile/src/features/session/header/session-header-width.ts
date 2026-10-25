import { Platform } from "react-native";

/**
 * The widest title that leaves space for the back control and the header actions. iOS centers
 * the title between them; Android starts it after the back control.
 */
export const titleMaxWidth = (windowWidth: number, actionCount: number): number => {
  const reserved = Platform.select({
    ios: 52 + Math.max(actionCount * 44 + 16, 52) + 16,
    default: 72 + actionCount * 48 + 8,
  });
  return Math.min(Math.max(windowWidth - reserved, 120), 520);
};
