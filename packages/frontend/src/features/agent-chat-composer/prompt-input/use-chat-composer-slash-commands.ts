import type { RepoRuntimeRef, ReusablePrompt } from "@openducktor/contracts";
import type { AgentSlashCommand, AgentSlashCommandCatalog } from "@openducktor/core";
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
  const reusablePromptTriggers = new Set(
    reusablePromptSlashCommands.map((command) => command.trigger.toLowerCase()),
  );
  return [
    ...runtimeSlashCommands.filter(
      (command) => !reusablePromptTriggers.has(command.trigger.toLowerCase()),
    ),
    ...reusablePromptSlashCommands,
  ];
};

const skippedSlashCommandsQueryOptions = (runtimeRef: RepoRuntimeRef | null) =>
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
  loadSlashCommandsForRepo: (runtimeRef: RepoRuntimeRef) => Promise<AgentSlashCommandCatalog>;
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
  const runtimeSlashCommands = useMemo(
    () => (runtimeSupportsSlashCommands ? (runtimeSlashCommandCatalog?.commands ?? []) : []),
    [runtimeSupportsSlashCommands, runtimeSlashCommandCatalog?.commands],
  );
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
