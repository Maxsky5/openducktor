import type { SettingsSnapshot } from "@openducktor/contracts";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import type {
  AgentSessionRuntimePolicy,
  AgentSessionScope,
  PolicyBoundSessionRef,
  RuntimeKind,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionRefWithPolicy } from "./session-runtime-ref";

type RuntimeSessionContextSource = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory"
> & {
  taskId?: string;
  role?: AgentSessionState["role"];
  selectedModel?: AgentSessionState["selectedModel"];
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
    ...(sessionScope !== undefined ? { sessionScope } : {}),
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
  if (sessionScope && sessionScope.kind !== "workflow") {
    throw new Error("Codex runtime policy requires workflow session scope.");
  }
  return {
    kind: "codex",
    policy: resolveCodexEffectivePolicy(snapshot.agentRuntimes.codex, sessionScope?.role ?? null),
  };
};

export const resolveRuntimeSessionContextRef = async (
  repoPath: string,
  session: RuntimeSessionContextSource,
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy,
): Promise<PolicyBoundSessionRef> => {
  const sessionScope =
    session.role && session.taskId ? workflowAgentSessionScope(session.taskId, session.role) : null;
  const runtimePolicy = await resolveAgentSessionRuntimePolicy({
    runtimeKind: session.runtimeKind,
    sessionScope,
    loadSettingsSnapshot,
  });
  return {
    ...toRuntimeSessionRefWithPolicy(repoPath, session, runtimePolicy),
    ...(sessionScope ? { sessionScope } : {}),
  };
};
