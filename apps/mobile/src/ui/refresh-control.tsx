import type { ReactElement } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";
import { useAppTheme } from "@/theme/app-theme-context";

type ListRefreshControlProps = Omit<
  RefreshControlProps,
  "tintColor" | "colors" | "progressBackgroundColor"
>;

/**
 * Pull to refresh in the theme colors. Android draws the spinner on a disc, which is white when no
 * color is set, so the disc takes the card color of the theme.
 */
export function ListRefreshControl(props: ListRefreshControlProps): ReactElement {
  const theme = useAppTheme();
  return (
    <RefreshControl
      {...props}
      tintColor={theme.colors.secondaryLabel}
      colors={[theme.colors.tint]}
      progressBackgroundColor={theme.colors.surface}
    />
  );
}
