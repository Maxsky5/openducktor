export { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";

import type { RepoDevServerScript } from "@openducktor/contracts";

type HookDraftInput = {
  preStart: string[];
  postComplete: string[];
};

type RepoDevServerDraftInput = RepoDevServerScript;

type RepoScriptDraftInput = {
  hooks: HookDraftInput;
  devServers: RepoDevServerDraftInput[];
};

// Preserve blank draft rows and raw spacing so controlled multi-line inputs do not collapse
// trailing newlines or strip characters while the user is still editing. Save-time
// normalization removes blank commands and trims persisted values.
export const parseHookLines = (value: string): string[] => value.split("\n");

const normalizeHookCommands = (commands: string[]): string[] =>
  commands.map((entry) => entry.trim()).filter(Boolean);

const normalizeDevServerName = (name: string): string => name.trim();

const normalizeDevServerCommand = (command: string): string => command.trim();

export const normalizeDevServers = (
  devServers: RepoDevServerDraftInput[],
): RepoDevServerDraftInput[] =>
  devServers.flatMap((devServer) => {
    const command = normalizeDevServerCommand(devServer.command);
    if (!command) {
      return [];
    }

    const name = normalizeDevServerName(devServer.name);
    if (!name) {
      throw new Error("Dev server names cannot be blank when a command is configured.");
    }

    return [
      {
        id: devServer.id,
        name,
        command,
      },
    ];
  });

export const hasConfiguredHookCommands = (hooks: HookDraftInput): boolean =>
  hooks.preStart.some((entry) => entry.trim().length > 0) ||
  hooks.postComplete.some((entry) => entry.trim().length > 0);

export const hasConfiguredRepoScriptCommands = ({
  hooks,
  devServers,
}: RepoScriptDraftInput): boolean =>
  hasConfiguredHookCommands(hooks) ||
  devServers.some((devServer) => normalizeDevServerCommand(devServer.command).length > 0);

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

export const normalizeRepoScriptsWithTrust = (
  input: RepoScriptDraftInput,
  trustedHooks: boolean,
): {
  hooks: HookDraftInput;
  devServers: RepoDevServerDraftInput[];
  trustedHooks: boolean;
} => {
  const normalizedHooks = {
    preStart: normalizeHookCommands(input.hooks.preStart),
    postComplete: normalizeHookCommands(input.hooks.postComplete),
  };
  const normalizedDevServers = normalizeDevServers(input.devServers);

  return {
    hooks: normalizedHooks,
    devServers: normalizedDevServers,
    trustedHooks: hasConfiguredRepoScriptCommands({
      hooks: normalizedHooks,
      devServers: normalizedDevServers,
    })
      ? trustedHooks
      : false,
  };
};
