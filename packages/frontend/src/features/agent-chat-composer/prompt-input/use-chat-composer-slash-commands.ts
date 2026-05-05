import type { ReusablePrompt, RuntimeKind } from "@openducktor/contracts";
import type { AgentSlashCommand, AgentSlashCommandCatalog } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { SessionRuntimeQueryInput } from "@/state/operations/agent-orchestrator/support/session-runtime-query-state";
import { sessionSlashCommandsQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeSlashCommandsQueryOptions } from "@/state/queries/runtime-catalog";
import type { AgentSessionState } from "@/types/agent-orchestrator";

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
  hasActiveSession,
  activeExternalSessionId,
  activeSessionStatus,
  activeSessionRuntimeQueryInput,
  activeSessionRuntimeQueryError,
  runtimeSupportsSlashCommands,
  workspaceRepoPath,
  selectedRuntimeKind,
  reusablePrompts,
  loadSlashCommandsForRepo,
  readSessionSlashCommands,
}: {
  hasActiveSession: boolean;
  activeExternalSessionId: string | null;
  activeSessionStatus: AgentSessionState["status"] | null;
  activeSessionRuntimeQueryInput: SessionRuntimeQueryInput | null;
  activeSessionRuntimeQueryError: string | null;
  runtimeSupportsSlashCommands: boolean;
  workspaceRepoPath: string | null;
  selectedRuntimeKind: RuntimeKind | null;
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
    ...(activeSessionRuntimeQueryInput && readSessionSlashCommands
      ? sessionSlashCommandsQueryOptions(
          activeSessionRuntimeQueryInput.repoPath,
          activeSessionRuntimeQueryInput.runtimeKind,
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
      hasActiveSession &&
      activeSessionStatus !== "starting" &&
      activeSessionRuntimeQueryInput !== null &&
      activeSessionRuntimeQueryError === null &&
      readSessionSlashCommands !== undefined,
  });
  const repoSlashCommandsQuery = useQuery({
    ...repoRuntimeSlashCommandsQueryOptions(
      workspaceRepoPath ?? "",
      selectedRuntimeKind ?? DEFAULT_RUNTIME_KIND,
      loadSlashCommandsForRepo,
    ),
    enabled:
      runtimeSupportsSlashCommands &&
      workspaceRepoPath !== null &&
      activeExternalSessionId === null &&
      selectedRuntimeKind !== null,
  });
  const runtimeSlashCommandCatalog = hasActiveSession
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
  const slashCommandsError = runtimeSupportsSlashCommands
    ? hasActiveSession
      ? activeSessionSlashCommandsQuery.error instanceof Error
        ? activeSessionSlashCommandsQuery.error.message
        : null
      : repoSlashCommandsQuery.error instanceof Error
        ? repoSlashCommandsQuery.error.message
        : null
    : null;
  const isSlashCommandsLoading = runtimeSupportsSlashCommands
    ? hasActiveSession
      ? activeSessionSlashCommandsQuery.isLoading
      : repoSlashCommandsQuery.isLoading
    : false;

  return {
    supportsSlashCommands: runtimeSupportsSlashCommands || reusablePrompts.length > 0,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
  };
};
