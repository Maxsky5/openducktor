import {
  GOAL_SLASH_COMMAND,
  isManualSessionCompactionSlashCommand,
  type ReusablePrompt,
  RUNTIME_DESCRIPTORS_BY_KIND,
} from "@openducktor/contracts";
import {
  type AgentRuntimeCatalog,
  type AgentSlashCommand,
  type AgentSlashCommandCatalog,
  RESERVED_SYSTEM_SLASH_COMMAND_TRIGGERS,
  type RuntimeWorkingDirectoryRef,
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

/**
 * Merges the menu commands. `/compact` comes from the runtime catalog and `/goal` from the
 * composer, so `systemSlashCommands` holds OpenDucktor commands that no runtime catalog lists.
 * A runtime command keeps a reserved trigger only when OpenDucktor does not run that trigger for
 * the runtime. Reusable prompts never use a reserved trigger.
 */
export const mergeSlashCommands = (
  runtimeSlashCommands: AgentSlashCommand[],
  reusablePromptSlashCommands: AgentSlashCommand[],
  systemSlashCommands: AgentSlashCommand[] = [],
  openDucktorTriggers: ReadonlySet<string> = RESERVED_SYSTEM_SLASH_COMMAND_TRIGGERS,
): AgentSlashCommand[] => {
  const isReserved = (command: AgentSlashCommand) =>
    RESERVED_SYSTEM_SLASH_COMMAND_TRIGGERS.has(command.trigger.toLowerCase());
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
        !isManualSessionCompactionSlashCommand(command) &&
        !openDucktorTriggers.has(command.trigger.toLowerCase()) &&
        !reusablePromptTriggers.has(command.trigger.toLowerCase()),
    ),
    ...reusablePromptSlashCommands.filter((command) => !isReserved(command)),
  ];
};

/**
 * The reserved triggers that OpenDucktor runs for the runtime of a composer: `/goal` when the
 * runtime has native goals, and `/compact` when its catalog lists the OpenDucktor command. The
 * scope of the composer does not change them.
 */
const openDucktorTriggersOf = (
  goalsAvailable: boolean,
  catalogCommands: readonly AgentSlashCommand[],
): ReadonlySet<string> =>
  new Set([
    ...(goalsAvailable ? [GOAL_SLASH_COMMAND.trigger] : []),
    ...catalogCommands
      .filter(isManualSessionCompactionSlashCommand)
      .map((command) => command.trigger.toLowerCase()),
  ]);

/** The `/goal` entry of the menu, with only the actions that the runtime can run. */
const goalCommandFor = (supportsPauseResume: boolean): AgentSlashCommand => ({
  ...GOAL_SLASH_COMMAND,
  hints: supportsPauseResume ? [...GOAL_SLASH_COMMAND.hints] : ["<objective> | clear"],
});

export const filterSlashCommandsForComposerScope = (
  commands: AgentSlashCommand[],
  scope: "session" | "repo",
): AgentSlashCommand[] =>
  scope === "session"
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
      ? filterSlashCommandsForComposerScope(commands, promptInputRuntime.scope)
      : [];
  }, [promptInputRuntime, runtimeSupportsSlashCommands, runtimeSlashCommandCatalog?.commands]);
  const catalogCommands = runtimeSlashCommandCatalog?.commands;
  const openDucktorTriggers = useMemo(
    () => openDucktorTriggersOf(goalsAvailable, catalogCommands ?? []),
    [goalsAvailable, catalogCommands],
  );
  const showsGoal =
    goalsAvailable &&
    promptInputRuntime.state === "available" &&
    promptInputRuntime.scope === "session";
  const goalSupportsPauseResume =
    promptInputRuntime.state === "available" &&
    RUNTIME_DESCRIPTORS_BY_KIND[promptInputRuntime.runtimeRef.runtimeKind].capabilities.goals
      .supportsPauseResume;
  const slashCommands = useMemo(
    () =>
      mergeSlashCommands(
        runtimeSlashCommands,
        reusablePromptSlashCommands,
        showsGoal ? [goalCommandFor(goalSupportsPauseResume)] : [],
        openDucktorTriggers,
      ),
    [
      reusablePromptSlashCommands,
      runtimeSlashCommands,
      showsGoal,
      goalSupportsPauseResume,
      openDucktorTriggers,
    ],
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
