import {
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
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { resolveRuntimeCatalogSurface, retryRuntimeCatalog } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerRuntimeCatalogQuery } from "./use-chat-composer-runtime-catalog-query";

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

export const useChatComposerSlashCommands = ({
  promptInputRuntime,
  runtimeSupportsSlashCommands,
  reusablePrompts,
  loadRuntimeCatalog,
}: {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  runtimeSupportsSlashCommands: boolean;
  reusablePrompts: ReusablePrompt[];
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
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
    slashCommandsError = resolved.error;
    isSlashCommandsLoading = slashCommandsQuery.isLoading;
  }
  // OpenCode supports slash commands but not skills, so this surface retries the
  // catalog on its own.
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
    supportsSlashCommands: runtimeSupportsSlashCommands || reusablePrompts.length > 0,
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
