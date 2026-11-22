import type { AppTheme } from "@/theme/tokens";

/** The desktop `-mb-1.5`: a card on the top edge of the composer tucks under the next card. */
const COMPOSER_EDGE_TUCK = 6;

/** The desktop `leading-5` of the edge cards. */
export const COMPOSER_EDGE_LINE_HEIGHT = 20;

/**
 * The card of a row on the top edge of the composer, such as the goal row and the background task
 * bar. The desktop classes: `mx-3 -mb-1.5 rounded-t-xl border border-b-0 border-input
 * bg-chat-surface px-3 pt-2 pb-3.5 shadow-xs`.
 */
export const composerEdgeCardStyle = (theme: AppTheme) =>
  ({
    marginHorizontal: theme.space.md,
    marginBottom: -COMPOSER_EDGE_TUCK,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.sm + COMPOSER_EDGE_TUCK,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.card,
  }) as const;

/** The 13-point text of the edge cards, in the given weight and color. */
export const composerEdgeTextStyle = (
  theme: AppTheme,
  weight: "regular" | "medium",
  color: string,
) =>
  ({
    fontFamily: weight === "medium" ? theme.fonts.sans.medium : theme.fonts.sans.regular,
    fontWeight: weight === "medium" ? "500" : "400",
    fontSize: 13,
    lineHeight: COMPOSER_EDGE_LINE_HEIGHT,
    color,
  }) as const;
