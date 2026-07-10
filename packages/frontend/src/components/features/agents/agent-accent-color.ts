import type { RuntimeKind } from "@openducktor/contracts";

const FALLBACK_SATURATION = 74;
const FALLBACK_LIGHTNESS = 46;

export const CODEX_SESSION_ACCENT_COLOR = "var(--odt-runtime-accent-codex)";
export const CLAUDE_SESSION_ACCENT_COLOR = "var(--odt-runtime-accent-claude)";

type AgentSessionAccentColorInput = {
  agentName?: string | null | undefined;
  agentColors?: Readonly<Record<string, string>> | undefined;
  runtimeKind?: RuntimeKind | null;
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const normalizeColor = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.startsWith("#")) {
    return normalized;
  }
  if (
    normalized.startsWith("rgb(") ||
    normalized.startsWith("rgba(") ||
    normalized.startsWith("hsl(") ||
    normalized.startsWith("hsla(") ||
    normalized.startsWith("var(")
  ) {
    return normalized;
  }
  return null;
};

export const resolveAgentAccentColor = (
  agentName: string | undefined,
  explicitColor?: string,
): string | undefined => {
  const normalizedExplicit = normalizeColor(explicitColor);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }
  if (!agentName || agentName.trim().length === 0) {
    return undefined;
  }
  const hash = hashString(agentName.trim().toLowerCase());
  const hue = hash % 360;
  return `hsl(${hue} ${FALLBACK_SATURATION}% ${FALLBACK_LIGHTNESS}%)`;
};

export const resolveAgentSessionAccentColor = ({
  agentName,
  agentColors,
  runtimeKind,
}: AgentSessionAccentColorInput): string | undefined => {
  const normalizedAgentName = agentName?.trim();
  if (normalizedAgentName) {
    return resolveAgentAccentColor(normalizedAgentName, agentColors?.[normalizedAgentName]);
  }
  if (runtimeKind === "codex") {
    return CODEX_SESSION_ACCENT_COLOR;
  }
  if (runtimeKind === "claude") {
    return CLAUDE_SESSION_ACCENT_COLOR;
  }
  return undefined;
};
