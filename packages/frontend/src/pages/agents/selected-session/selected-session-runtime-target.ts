import type { AgentRole } from "@openducktor/core";
import { resolveConfiguredAgentRuntimeKind } from "@/lib/repo-agent-defaults";
import {
  inactiveRepoRuntimeReadinessTarget,
  type RepoRuntimeReadinessTarget,
  repoRuntimeReadinessTargetForRuntime,
  resolvingRepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-health";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";

export type SelectedSessionRuntimeTargetSource =
  | { kind: "inactive" }
  | { kind: "selected_session"; runtimeKind: AgentSessionIdentity["runtimeKind"] }
  | { kind: "selected_task" };

export const resolveSelectedSessionRuntimeTarget = ({
  source,
  role,
  repoSettings,
  isLoadingRepoSettings,
}: {
  source: SelectedSessionRuntimeTargetSource;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
}): RepoRuntimeReadinessTarget => {
  if (source.kind === "inactive") {
    return inactiveRepoRuntimeReadinessTarget;
  }

  if (source.kind === "selected_session") {
    return repoRuntimeReadinessTargetForRuntime(source.runtimeKind);
  }

  if (source.kind === "selected_task" && isLoadingRepoSettings) {
    return resolvingRepoRuntimeReadinessTarget;
  }

  return repoRuntimeReadinessTargetForRuntime(
    resolveConfiguredAgentRuntimeKind(repoSettings, role),
  );
};
