import { memo, type ReactElement } from "react";
import Svg, { Path } from "react-native-svg";
import { useAppTheme } from "@/theme/app-theme-context";

const STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

/**
 * The star of a model, as the desktop model rows: filled amber on a favorite, a muted outline
 * otherwise.
 */
export const FavoriteStar = memo(function FavoriteStar({
  size = 16,
  filled = true,
}: {
  size?: number;
  filled?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const color = filled ? theme.palette.amber400 : theme.desktop.mutedForeground;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={STAR}
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
});
