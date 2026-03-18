export const DEFAULT_BRANCH_PREFIX = "odt";

export const parseHookLines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
