export const compactText = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

export const stripToolPrefix = (tool: string, value: string): string => {
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalized = value.trim();
  return normalized
    .replace(new RegExp(`^Tool\\s+${escaped}\\s*`, "i"), "")
    .replace(/^(queued|running|executing|completed|failed|cancelled|canceled)\s*[:.-]?\s*/i, "")
    .trim();
};
