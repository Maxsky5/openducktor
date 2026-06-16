import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSkillCatalog } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { sessionSkillsQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeSkillsQueryOptions } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputTarget } from "./chat-composer-prompt-input-target";

const EMPTY_SKILL_CATALOG: AgentSkillCatalog = { skills: [] };

type UseChatComposerSkillsArgs = {
  promptInputTarget: ChatComposerPromptInputTarget;
  supportsSkillReferences: boolean;
  loadSkillsForRepo: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
  readSessionSkills?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
};

export const useChatComposerSkills = ({
  promptInputTarget,
  supportsSkillReferences,
  loadSkillsForRepo,
  readSessionSkills,
}: UseChatComposerSkillsArgs): {
  skillCatalog: AgentSkillCatalog;
  skills: AgentSkillCatalog["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
} => {
  const activeSessionSkillsQuery = useQuery({
    ...(promptInputTarget.kind === "session" && readSessionSkills
      ? sessionSkillsQueryOptions(
          promptInputTarget.runtimeRef.repoPath,
          promptInputTarget.runtimeRef.runtimeKind,
          promptInputTarget.runtimeRef.workingDirectory,
          readSessionSkills,
        )
      : {
          queryKey: ["agent-session-runtime", "skills", "", DEFAULT_RUNTIME_KIND, ""] as const,
          queryFn: async (): Promise<AgentSkillCatalog> => {
            throw new Error("Session skills query is disabled.");
          },
        }),
    enabled:
      supportsSkillReferences &&
      promptInputTarget.kind === "session" &&
      readSessionSkills !== undefined,
  });

  const repoSkillsQuery = useQuery({
    ...repoRuntimeSkillsQueryOptions(
      promptInputTarget.kind === "repo" ? promptInputTarget.repoPath : "",
      promptInputTarget.kind === "repo" ? promptInputTarget.runtimeKind : DEFAULT_RUNTIME_KIND,
      promptInputTarget.kind === "repo" ? promptInputTarget.repoPath : "",
      loadSkillsForRepo,
    ),
    enabled: supportsSkillReferences && promptInputTarget.kind === "repo",
  });

  let catalog = EMPTY_SKILL_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSkillReferences && promptInputTarget.kind === "unavailable") {
    error = promptInputTarget.error;
  } else if (supportsSkillReferences && promptInputTarget.kind === "session") {
    catalog = activeSessionSkillsQuery.data ?? EMPTY_SKILL_CATALOG;
    error =
      activeSessionSkillsQuery.error instanceof Error
        ? activeSessionSkillsQuery.error.message
        : null;
    isLoading = activeSessionSkillsQuery.isLoading;
  } else if (supportsSkillReferences && promptInputTarget.kind === "repo") {
    catalog = repoSkillsQuery.data ?? EMPTY_SKILL_CATALOG;
    error = repoSkillsQuery.error instanceof Error ? repoSkillsQuery.error.message : null;
    isLoading = repoSkillsQuery.isLoading;
  }

  return {
    skillCatalog: catalog,
    skills: supportsSkillReferences ? catalog.skills : [],
    skillsError: error,
    isSkillsLoading: isLoading,
  };
};
