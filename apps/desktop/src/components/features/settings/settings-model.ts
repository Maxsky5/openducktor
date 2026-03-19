export { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";

export const parseHookLines = (value: string): string[] =>
  value.split("\n").map((entry) => entry.trim());

export const hasConfiguredHookCommands = (hooks: {
  preStart: string[];
  postComplete: string[];
}): boolean =>
  hooks.preStart.some((entry) => entry.length > 0) ||
  hooks.postComplete.some((entry) => entry.length > 0);
