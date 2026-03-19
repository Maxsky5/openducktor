export { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";

type HookDraftInput = {
  preStart: string[];
  postComplete: string[];
};

// Preserve blank draft rows so controlled multi-line inputs do not collapse trailing newlines
// while the user is still editing. Save-time normalization removes blank commands.
export const parseHookLines = (value: string): string[] =>
  value.split("\n").map((entry) => entry.trim());

const normalizeHookCommands = (commands: string[]): string[] =>
  commands.map((entry) => entry.trim()).filter(Boolean);

export const hasConfiguredHookCommands = (hooks: HookDraftInput): boolean =>
  hooks.preStart.some((entry) => entry.trim().length > 0) ||
  hooks.postComplete.some((entry) => entry.trim().length > 0);

export const normalizeHooksWithTrust = (
  hooks: HookDraftInput,
  trustedHooks: boolean,
): { hooks: HookDraftInput; trustedHooks: boolean } => {
  const normalizedHooks = {
    preStart: normalizeHookCommands(hooks.preStart),
    postComplete: normalizeHookCommands(hooks.postComplete),
  };

  return {
    hooks: normalizedHooks,
    trustedHooks: hasConfiguredHookCommands(normalizedHooks) ? trustedHooks : false,
  };
};
