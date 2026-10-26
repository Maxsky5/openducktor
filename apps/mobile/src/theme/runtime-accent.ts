import type { RuntimeKind } from "@openducktor/contracts";
import type { AppTheme } from "./tokens";

/** The desktop `resolveAgentSessionAccentColor`: the brand accent of a session runtime. */
export const runtimeAccentColor = (theme: AppTheme, runtimeKind: RuntimeKind): string => {
  switch (runtimeKind) {
    case "opencode":
      return theme.colors.runtimeOpencode;
    case "codex":
      return theme.colors.runtimeCodex;
    case "claude":
      return theme.colors.runtimeClaude;
  }
};
