import type { RuntimeKind } from "@openducktor/contracts";

export const OPENCODE_SESSION_ACCENT_COLOR = "var(--odt-runtime-accent-opencode)";
export const CODEX_SESSION_ACCENT_COLOR = "var(--odt-runtime-accent-codex)";
export const CLAUDE_SESSION_ACCENT_COLOR = "var(--odt-runtime-accent-claude)";

export const resolveAgentSessionAccentColor = ({
  runtimeKind,
}: {
  runtimeKind?: RuntimeKind | null;
}): string | undefined => {
  switch (runtimeKind) {
    case "opencode":
      return OPENCODE_SESSION_ACCENT_COLOR;
    case "codex":
      return CODEX_SESSION_ACCENT_COLOR;
    case "claude":
      return CLAUDE_SESSION_ACCENT_COLOR;
    default:
      return undefined;
  }
};
