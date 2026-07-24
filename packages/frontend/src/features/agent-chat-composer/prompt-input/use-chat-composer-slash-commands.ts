import {
  isManualSessionCompactionSlashCommand,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  type ReusablePrompt,
  type RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentSlashCommand,
  AgentSlashCommandCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeSlashCommandsQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

export const mergeSlashCommands = (
  runtimeSlashCommands: AgentSlashCommand[],
  reusablePromptSlashCommands: AgentSlashCommand[],
): AgentSlashCommand[] => {
  const reservedTrigger = MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger;
  const systemCommands = runtimeSlashCommands.filter(isManualSessionCompactionSlashCommand);
  const systemTriggers = new Set(systemCommands.map((command) => command.trigger.toLowerCase()));
  const reusablePromptTriggers = new Set(
    reusablePromptSlashCommands
      .map((command) => command.trigger.toLowerCase())
      .filter((trigger) => trigger !== reservedTrigger && !systemTriggers.has(trigger)),
  );
  return [
    ...systemCommands,
    ...runtimeSlashCommands.filter(
      (command) =>
        !isManualSessionCompactionSlashCommand(command) &&
        command.trigger.toLowerCase() !== reservedTrigger &&
        !systemTriggers.has(command.trigger.toLowerCase()) &&
        !reusablePromptTriggers.has(command.trigger.toLowerCase()),
    ),
    ...reusablePromptSlashCommands.filter(
      (command) =>
        command.trigger.toLowerCase() !== reservedTrigger &&
        !systemTriggers.has(command.trigger.toLowerCase()),
    ),
  ];
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

const skippedSlashCommandsQueryOptions = (runtimeRef: RuntimeWorkingDirectoryRef | null) =>
  skippedQueryOptions<AgentSlashCommandCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repoSlashCommands(runtimeRef)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const useChatComposerSlashCommands = ({
  promptInputRuntime,
  runtimeSupportsSlashCommands,
  reusablePrompts,
  loadSlashCommandsForRepo,
}: {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  runtimeSupportsSlashCommands: boolean;
  reusablePrompts: ReusablePrompt[];
  loadSlashCommandsForRepo: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSlashCommandCatalog>;
}): {
  supportsSlashCommands: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog;
  slashCommands: AgentSlashCommandCatalog["commands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
} => {
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const slashCommandsQuery = useQuery(
    runtimeSupportsSlashCommands && runtimeRef
      ? repoRuntimeSlashCommandsQueryOptions(runtimeRef, loadSlashCommandsForRepo)
      : skippedSlashCommandsQueryOptions(runtimeRef),
  );
  const runtimeSlashCommandCatalog =
    promptInputRuntime.state === "available" ? (slashCommandsQuery.data ?? null) : null;
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
  const slashCommands = useMemo(
    () => mergeSlashCommands(runtimeSlashCommands, reusablePromptSlashCommands),
    [reusablePromptSlashCommands, runtimeSlashCommands],
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
    slashCommandsError =
      slashCommandsQuery.error instanceof Error ? slashCommandsQuery.error.message : null;
    isSlashCommandsLoading = slashCommandsQuery.isLoading;
  }

  return {
    supportsSlashCommands: runtimeSupportsSlashCommands || reusablePrompts.length > 0,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
  };
};
