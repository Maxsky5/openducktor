export const DEFAULT_BRANCH_PREFIX = "obp";

export const parseHookLines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
