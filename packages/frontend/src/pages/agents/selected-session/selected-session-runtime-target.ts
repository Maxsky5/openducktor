import type { AgentRole } from "@openducktor/core";
import { resolveConfiguredAgentRuntimeKind } from "@/lib/repo-agent-defaults";
import {
  type RepoRuntimeReadinessTarget,
  repoRuntimeReadinessTargetForRuntime,
  resolvingRepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-health";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";

export const resolveSelectedSessionRuntimeTarget = ({
  hasSelectedTask,
  selectedSessionIdentity,
  role,
  repoSettings,
  isLoadingRepoSettings,
}: {
  hasSelectedTask: boolean;
  selectedSessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
}): RepoRuntimeReadinessTarget => {
  if (selectedSessionIdentity) {
    return repoRuntimeReadinessTargetForRuntime(selectedSessionIdentity.runtimeKind);
  }

  if (hasSelectedTask && isLoadingRepoSettings) {
    return resolvingRepoRuntimeReadinessTarget;
  }

  return repoRuntimeReadinessTargetForRuntime(
    resolveConfiguredAgentRuntimeKind(repoSettings, role),
  );
};
