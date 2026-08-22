import type { SettingsSnapshot } from "@openducktor/contracts";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import type {
  AgentSessionRuntimePolicy,
  AgentSessionScope,
  PolicyBoundSessionRef,
  RuntimeKind,
} from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionRefWithPolicy } from "./session-runtime-ref";
import { resolveSessionRuntimeScope } from "./session-runtime-scope";

type RuntimeSessionContextSource = {
  identity: AgentSessionIdentity;
  selectedModel: AgentSessionState["selectedModel"];
  sessionAssociation: AgentSessionState["sessionAssociation"];
};

export type LoadSettingsSnapshotForRuntimePolicy = () => Promise<SettingsSnapshot>;

export const resolveSettingsIndependentAgentSessionRuntimePolicy = (
  runtimeKind: RuntimeKind,
): AgentSessionRuntimePolicy | null => {
  if (runtimeKind === "opencode" || runtimeKind === "claude") {
    return { kind: runtimeKind };
  }
  return null;
};

export const resolveAgentSessionRuntimePolicy = async ({
  runtimeKind,
  sessionScope,
  loadSettingsSnapshot,
}: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
}): Promise<AgentSessionRuntimePolicy> => {
  const settingsIndependentPolicy =
    resolveSettingsIndependentAgentSessionRuntimePolicy(runtimeKind);
  if (settingsIndependentPolicy) {
    return settingsIndependentPolicy;
  }
  const snapshot = await loadSettingsSnapshot();
  return resolveAgentSessionRuntimePolicyFromSnapshot({
    runtimeKind,
    snapshot,
    ...(sessionScope !== undefined ? { sessionScope } : undefined),
  });
};

export const resolveAgentSessionRuntimePolicyFromSnapshot = ({
  runtimeKind,
  sessionScope,
  snapshot,
}: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
  snapshot: SettingsSnapshot;
}): AgentSessionRuntimePolicy => {
  const settingsIndependentPolicy =
    resolveSettingsIndependentAgentSessionRuntimePolicy(runtimeKind);
  if (settingsIndependentPolicy) {
    return settingsIndependentPolicy;
  }
  if (runtimeKind !== "codex") {
    throw new Error(`Unsupported runtime kind '${runtimeKind}' for session runtime policy.`);
  }
  const role = sessionScope?.kind === "workflow" ? sessionScope.role : null;
  return {
    kind: "codex",
    policy: resolveCodexEffectivePolicy(snapshot.agentRuntimes.codex, role),
  };
};

export const resolveRuntimeSessionContextRef = async (
  repoPath: string,
  session: RuntimeSessionContextSource,
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy,
): Promise<PolicyBoundSessionRef> => {
  const sessionScope = resolveSessionRuntimeScope(session.sessionAssociation);
  const runtimePolicy = await resolveAgentSessionRuntimePolicy({
    runtimeKind: session.identity.runtimeKind,
    sessionScope,
    loadSettingsSnapshot,
  });
  return {
    ...toRuntimeSessionRefWithPolicy(
      repoPath,
      { ...session.identity, selectedModel: session.selectedModel },
      runtimePolicy,
    ),
    ...(sessionScope ? { sessionScope } : undefined),
  };
};
