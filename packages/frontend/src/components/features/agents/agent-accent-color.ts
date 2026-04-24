const FALLBACK_SATURATION = 74;
const FALLBACK_LIGHTNESS = 46;

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
