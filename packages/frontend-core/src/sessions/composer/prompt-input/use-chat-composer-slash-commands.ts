import {
  GOAL_SLASH_COMMAND,
  isManualSessionCompactionSlashCommand,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type ReusablePrompt,
  type RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentRuntimeCatalog,
  AgentSlashCommand,
  AgentSlashCommandCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toReusablePromptSlashCommand } from "../../send/agent-chat-reusable-prompts";
import {
  resolveRuntimeCatalogSurface,
  retryRuntimeCatalog,
} from "../../../queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerRuntimeCatalogQuery } from "./use-chat-composer-runtime-catalog-query";

/** Only OpenDucktor can provide these triggers, so no runtime or prompt command can use them. */
const RESERVED_SYSTEM_TRIGGERS = new Set<string>([
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger,
  GOAL_SLASH_COMMAND.trigger,
]);

/**
 * Merges the menu commands. `/compact` comes from the runtime catalog and `/goal` from the
 * composer, so `systemSlashCommands` holds OpenDucktor commands that no runtime catalog lists.
 */
export const mergeSlashCommands = (
  runtimeSlashCommands: AgentSlashCommand[],
  reusablePromptSlashCommands: AgentSlashCommand[],
  systemSlashCommands: AgentSlashCommand[] = [],
): AgentSlashCommand[] => {
  const isReserved = (command: AgentSlashCommand) =>
    RESERVED_SYSTEM_TRIGGERS.has(command.trigger.toLowerCase());
  const systemCommands = [
    ...runtimeSlashCommands.filter(isManualSessionCompactionSlashCommand),
    ...systemSlashCommands,
  ];
  const reusablePromptTriggers = new Set(
    reusablePromptSlashCommands
      .filter((command) => !isReserved(command))
      .map((command) => command.trigger.toLowerCase()),
  );
  return [
    ...systemCommands,
    ...runtimeSlashCommands.filter(
      (command) =>
        !isReserved(command) && !reusablePromptTriggers.has(command.trigger.toLowerCase()),
    ),
    ...reusablePromptSlashCommands.filter((command) => !isReserved(command)),
  ];
};

const GOAL_COMMAND: AgentSlashCommand = {
  ...GOAL_SLASH_COMMAND,
  hints: [...GOAL_SLASH_COMMAND.hints],
};

export const filterSlashCommandsForComposerScope = (
  commands: AgentSlashCommand[],
  scope: "session" | "repo",
  runtimeKind: RuntimeKind,
): AgentSlashCommand[] =>
  scope === "session" &&
  (runtimeKind === "opencode" || runtimeKind === "codex" || runtimeKind === "claude")
    ? commands
    : commands.filter((command) => !isManualSessionCompactionSlashCommand(command));

export const useChatComposerSlashCommands = ({
  promptInputRuntime,
  runtimeSupportsSlashCommands,
  reusablePrompts,
  loadRuntimeCatalog,
  goalsAvailable,
}: {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  runtimeSupportsSlashCommands: boolean;
  reusablePrompts: ReusablePrompt[];
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  /** The session runtime has native goals, so a session composer lists `/goal`. */
  goalsAvailable: boolean;
}) => {
  const queryClient = useQueryClient();
  const slashCommandsQuery = useChatComposerRuntimeCatalogQuery({
    promptInputRuntime,
    supports: runtimeSupportsSlashCommands,
    loadRuntimeCatalog,
  });
  const resolved = resolveRuntimeCatalogSurface(
    slashCommandsQuery.data?.slashCommands,
    slashCommandsQuery.error,
  );
  const runtimeSlashCommandCatalog =
    promptInputRuntime.state === "available" ? resolved.catalog : null;
  const reusablePromptSlashCommands = useMemo(
    () => reusablePrompts.map(toReusablePromptSlashCommand),
    [reusablePrompts],
  );
  const runtimeSlashCommands = useMemo(() => {
    const commands = runtimeSupportsSlashCommands
      ? (runtimeSlashCommandCatalog?.commands ?? [])
      : [];
    return promptInputRuntime.state === "available"
      ? filterSlashCommandsForComposerScope(
          commands,
          promptInputRuntime.scope,
          promptInputRuntime.runtimeRef.runtimeKind,
        )
      : [];
  }, [promptInputRuntime, runtimeSupportsSlashCommands, runtimeSlashCommandCatalog?.commands]);
  const showsGoal =
    goalsAvailable &&
    promptInputRuntime.state === "available" &&
    promptInputRuntime.scope === "session";
  const slashCommands = useMemo(
    () =>
      mergeSlashCommands(
        runtimeSlashCommands,
        reusablePromptSlashCommands,
        showsGoal ? [GOAL_COMMAND] : [],
      ),
    [reusablePromptSlashCommands, runtimeSlashCommands, showsGoal],
  );
  const slashCommandCatalog = useMemo<AgentSlashCommandCatalog>(
    () => ({ commands: slashCommands }),
    [slashCommands],
  );
  let slashCommandsError: string | null = null;
  let isSlashCommandsLoading = false;
  if (runtimeSupportsSlashCommands && promptInputRuntime.state === "unavailable") {
    slashCommandsError = promptInputRuntime.error;
  } else if (runtimeSupportsSlashCommands && promptInputRuntime.state === "available") {
    slashCommandsError = resolved.error;
    isSlashCommandsLoading = slashCommandsQuery.isLoading;
  }
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const retrySlashCommands =
    runtimeSupportsSlashCommands && runtimeRef !== null
      ? () => {
          void retryRuntimeCatalog({
            queryClient,
            runtimeRef,
            loadRuntimeCatalog,
          });
        }
      : null;

  return {
    supportsSlashCommands: runtimeSupportsSlashCommands || reusablePrompts.length > 0 || showsGoal,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    retrySlashCommands,
  } satisfies {
    supportsSlashCommands: boolean;
    slashCommandCatalog: AgentSlashCommandCatalog;
    slashCommands: AgentSlashCommandCatalog["commands"];
    slashCommandsError: string | null;
    isSlashCommandsLoading: boolean;
    retrySlashCommands: (() => void) | null;
  };
};
