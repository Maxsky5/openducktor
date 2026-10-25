import type { ReusablePrompt, RuntimeKind } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useRuntimeAvailabilityContext } from "../../../app-state/app-state-contexts";
import type { AgentSessionIdentity } from "../../../types/agent-orchestrator";
import { resolveChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { createChatComposerFileSearch } from "./create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "./runtime-prompt-input-support";
import { useChatComposerCatalogRefresh } from "./use-chat-composer-catalog-refresh";
import { useChatComposerSkills } from "./use-chat-composer-skills";
import { useChatComposerSlashCommands } from "./use-chat-composer-slash-commands";
import { useChatComposerSubagents } from "./use-chat-composer-subagents";

/**
 * The prompt input catalogs of one chat: slash commands, skills, subagents, and file search. They
 * come from the runtime of the session, in the directory where the session works.
 */
export function useSessionPromptInput({
  repoPath,
  runtimeKind,
  workingDirectory,
  identity,
  runtimeReadinessState,
  reusablePrompts,
}: {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  /** The runtime session, or null before the chat has one. */
  identity: AgentSessionIdentity | null;
  runtimeReadinessState: Parameters<
    typeof resolveChatComposerPromptInputRuntime
  >[0]["runtimeReadinessState"];
  reusablePrompts: ReusablePrompt[];
}) {
  const runtime = useRuntimeAvailabilityContext();
  const queryClient = useQueryClient();
  const promptInputRuntime = useMemo(() => {
    const resolved = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: repoPath,
      runtimeReadinessState,
      source: identity ? { kind: "session", session: identity } : { kind: "repo", runtimeKind },
    });
    if (resolved.state !== "available") return resolved;
    return {
      ...resolved,
      runtimeRef: {
        ...resolved.runtimeRef,
        workingDirectory,
      },
    };
  }, [identity, runtimeReadinessState, repoPath, runtimeKind, workingDirectory]);
  const support = resolveRuntimePromptInputSupport({
    runtimeDefinitions: runtime.allRuntimeDefinitions,
    runtimeKind,
  });
  const slashCommands = useChatComposerSlashCommands({
    promptInputRuntime,
    runtimeSupportsSlashCommands: support.runtimeSupportsSlashCommands,
    reusablePrompts,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
  });
  const skills = useChatComposerSkills({
    promptInputRuntime,
    supportsSkillReferences: support.supportsSkillReferences,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
  });
  const subagents = useChatComposerSubagents({
    promptInputRuntime,
    supportsSubagentReferences: support.supportsSubagentReferences,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
  });
  const searchFiles = useMemo(
    () =>
      createChatComposerFileSearch({
        promptInputRuntime,
        supportsFileSearch: support.supportsFileSearch,
        queryClient,
        loadFileSearchForRepo: runtime.loadRepoRuntimeFileSearch,
      }),
    [
      promptInputRuntime,
      queryClient,
      runtime.loadRepoRuntimeFileSearch,
      support.supportsFileSearch,
    ],
  );
  const refreshCatalogIfStale = useChatComposerCatalogRefresh({
    promptInputRuntime,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
  });

  return { support, slashCommands, skills, subagents, searchFiles, refreshCatalogIfStale };
}

export type SessionPromptInput = ReturnType<typeof useSessionPromptInput>;
