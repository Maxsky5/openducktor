import type { ReusablePrompt, WorkspaceSession } from "@openducktor/contracts";
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { resolveChatComposerPromptInputRuntime } from "@/features/agent-chat-composer/prompt-input/chat-composer-prompt-input-runtime";
import { createChatComposerFileSearch } from "@/features/agent-chat-composer/prompt-input/create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "@/features/agent-chat-composer/prompt-input/runtime-prompt-input-support";
import { useChatComposerCatalogRefresh } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-catalog-refresh";
import { useChatComposerSkills } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-skills";
import { useChatComposerSlashCommands } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands";
import { useChatComposerSubagents } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-subagents";

export function useWorkspaceSessionPromptInput({
  repoPath,
  record,
  identity,
  repoReadinessState,
  reusablePrompts,
}: {
  repoPath: string;
  record: WorkspaceSession;
  identity: AgentSessionIdentity | null;
  repoReadinessState: Parameters<
    typeof resolveChatComposerPromptInputRuntime
  >[0]["repoReadinessState"];
  reusablePrompts: ReusablePrompt[];
}) {
  const runtime = useRuntimeAvailabilityContext();
  const queryClient = useQueryClient();
  const promptInputRuntime = useMemo(() => {
    const resolved = resolveChatComposerPromptInputRuntime({
      workspaceRepoPath: repoPath,
      repoReadinessState: repoReadinessState,
      source: identity
        ? { kind: "session", session: identity }
        : { kind: "repo", runtimeKind: record.runtimeKind },
    });
    if (resolved.state !== "available") return resolved;
    return {
      ...resolved,
      runtimeRef: {
        ...resolved.runtimeRef,
        workingDirectory: record.executionTarget.workingDirectory,
      },
    };
  }, [
    identity,
    repoReadinessState,
    repoPath,
    record.runtimeKind,
    record.executionTarget.workingDirectory,
  ]);
  const support = resolveRuntimePromptInputSupport({
    runtimeDefinitions: runtime.allRuntimeDefinitions,
    runtimeKind: record.runtimeKind,
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
