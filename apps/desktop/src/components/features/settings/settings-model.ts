export { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";

export const parseHookLines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
