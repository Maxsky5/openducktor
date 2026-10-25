import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { resolveChatComposerPromptInputRuntime } from "@openducktor/frontend-core/sessions/composer/prompt-input/chat-composer-prompt-input-runtime";
import { resolveRuntimePromptInputSupport } from "@openducktor/frontend-core/sessions/composer/prompt-input/runtime-prompt-input-support";
import { useChatComposerSkills } from "@openducktor/frontend-core/sessions/composer/prompt-input/use-chat-composer-skills";
import type { AgentSkillReference } from "@openducktor/core";
import { useMemo } from "react";
import { useSessionScreen } from "./session-target";

/**
 * The skills of the session runtime. The transcript shows `$skill` mentions in Claude messages
 * with them; the composer reads the same catalog through TanStack Query.
 */
export function useSessionSkills(): readonly AgentSkillReference[] {
  const { target, interaction } = useSessionScreen();
  const { allRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const runtimeReadinessState = interaction.runtimeReadiness.state;
  const promptInputRuntime = useMemo(
    () =>
      resolveChatComposerPromptInputRuntime({
        workspaceRepoPath: target.repoPath,
        runtimeReadinessState,
        source: { kind: "session", session: target.identity },
      }),
    [runtimeReadinessState, target.identity, target.repoPath],
  );
  const support = resolveRuntimePromptInputSupport({
    runtimeDefinitions: allRuntimeDefinitions,
    runtimeKind: target.identity.runtimeKind,
  });
  return useChatComposerSkills({
    promptInputRuntime,
    supportsSkillReferences: support.supportsSkillReferences,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  }).skills;
}
