import type { ReusablePrompt, RuntimeKind } from "@openducktor/contracts";
import type { AgentSlashCommand, AgentSlashCommandCatalog } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { sessionSlashCommandsQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeSlashCommandsQueryOptions } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputTarget } from "./chat-composer-prompt-input-target";

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

export const useChatComposerSlashCommands = ({
  promptInputTarget,
  runtimeSupportsSlashCommands,
  reusablePrompts,
  loadSlashCommandsForRepo,
  readSessionSlashCommands,
}: {
  promptInputTarget: ChatComposerPromptInputTarget;
  runtimeSupportsSlashCommands: boolean;
  reusablePrompts: ReusablePrompt[];
  loadSlashCommandsForRepo: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionSlashCommands?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
}): {
  supportsSlashCommands: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog;
  slashCommands: AgentSlashCommandCatalog["commands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
} => {
  const activeSessionSlashCommandsQuery = useQuery({
    ...(promptInputTarget.kind === "session" && readSessionSlashCommands
      ? sessionSlashCommandsQueryOptions(
          promptInputTarget.runtimeRef.repoPath,
          promptInputTarget.runtimeRef.runtimeKind,
          readSessionSlashCommands,
        )
      : {
          queryKey: ["agent-session-runtime", "slash-commands", "", DEFAULT_RUNTIME_KIND] as const,
          queryFn: async (): Promise<AgentSlashCommandCatalog> => {
            throw new Error("Session slash commands query is disabled.");
          },
        }),
    enabled:
      runtimeSupportsSlashCommands &&
      promptInputTarget.kind === "session" &&
      readSessionSlashCommands !== undefined,
  });
  const repoSlashCommandsQuery = useQuery({
    ...repoRuntimeSlashCommandsQueryOptions(
      promptInputTarget.kind === "repo" ? promptInputTarget.repoPath : "",
      promptInputTarget.kind === "repo" ? promptInputTarget.runtimeKind : DEFAULT_RUNTIME_KIND,
      loadSlashCommandsForRepo,
    ),
    enabled: runtimeSupportsSlashCommands && promptInputTarget.kind === "repo",
  });
  const runtimeSlashCommandCatalog =
    promptInputTarget.kind === "session"
      ? (activeSessionSlashCommandsQuery.data ?? null)
      : (repoSlashCommandsQuery.data ?? null);
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
  if (runtimeSupportsSlashCommands && promptInputTarget.kind === "unavailable") {
    slashCommandsError = promptInputTarget.error;
  } else if (runtimeSupportsSlashCommands && promptInputTarget.kind === "session") {
    slashCommandsError =
      activeSessionSlashCommandsQuery.error instanceof Error
        ? activeSessionSlashCommandsQuery.error.message
        : null;
    isSlashCommandsLoading = activeSessionSlashCommandsQuery.isLoading;
  } else if (runtimeSupportsSlashCommands && promptInputTarget.kind === "repo") {
    slashCommandsError =
      repoSlashCommandsQuery.error instanceof Error ? repoSlashCommandsQuery.error.message : null;
    isSlashCommandsLoading = repoSlashCommandsQuery.isLoading;
  }

  return {
    supportsSlashCommands: runtimeSupportsSlashCommands || reusablePrompts.length > 0,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
  };
};
