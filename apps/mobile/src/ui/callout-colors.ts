import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";

export type CalloutTone = "destructive" | "warning" | "info" | "success";

/** The desktop status family of a tone: a surface, a 70% outline, strong text, and muted text. */
export const calloutColors = (theme: AppTheme, tone: CalloutTone) => {
  const { desktop } = theme;
  switch (tone) {
    case "destructive":
      return {
        surface: desktop.destructiveSurface,
        border: withAlpha(desktop.destructiveBorder, 0.7),
        text: desktop.destructiveSurfaceForeground,
        muted: desktop.destructiveMuted,
      };
    case "warning":
      return {
        surface: desktop.warningSurface,
        border: withAlpha(desktop.warningBorder, 0.7),
        text: desktop.warningSurfaceForeground,
        muted: desktop.warningMuted,
      };
    case "info":
      return {
        surface: desktop.infoSurface,
        border: withAlpha(desktop.infoBorder, 0.7),
        text: desktop.infoSurfaceForeground,
        muted: desktop.infoMuted,
      };
    case "success":
      return {
        surface: desktop.successSurface,
        border: withAlpha(desktop.successBorder, 0.7),
        text: desktop.successSurfaceForeground,
        muted: desktop.successMuted,
      };
  }
};
