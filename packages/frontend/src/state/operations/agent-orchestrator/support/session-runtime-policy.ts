import type { SettingsSnapshot } from "@openducktor/contracts";
import { resolveCodexEffectivePolicy } from "@openducktor/contracts";
import type {
  AgentSessionRuntimePolicy,
  AgentSessionRuntimeRef,
  AgentSessionScope,
  RuntimeKind,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionContextRef } from "./session-runtime-ref";

type RuntimeSessionContextSource = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory" | "taskId" | "role"
> & {
  selectedModel?: AgentSessionState["selectedModel"];
};

export type LoadSettingsSnapshotForRuntimePolicy = () => Promise<SettingsSnapshot>;

export const resolveAgentSessionRuntimePolicy = async ({
  runtimeKind,
  sessionScope,
  loadSettingsSnapshot,
}: {
  runtimeKind: RuntimeKind;
  sessionScope: AgentSessionScope;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
}): Promise<AgentSessionRuntimePolicy> => {
  if (runtimeKind === "opencode") {
    return { kind: "opencode" };
  }
  const snapshot = await loadSettingsSnapshot();
  return resolveAgentSessionRuntimePolicyFromSnapshot({ runtimeKind, sessionScope, snapshot });
};

export const resolveAgentSessionRuntimePolicyFromSnapshot = ({
  runtimeKind,
  sessionScope,
  snapshot,
}: {
  runtimeKind: RuntimeKind;
  sessionScope: AgentSessionScope;
  snapshot: SettingsSnapshot;
}): AgentSessionRuntimePolicy => {
  if (runtimeKind === "opencode") {
    return { kind: "opencode" };
  }
  if (runtimeKind !== "codex") {
    throw new Error(`Unsupported runtime kind '${runtimeKind}' for session runtime policy.`);
  }
  if (sessionScope.kind !== "workflow") {
    throw new Error("Codex runtime policy requires workflow session scope.");
  }
  return {
    kind: "codex",
    policy: resolveCodexEffectivePolicy(snapshot.agentRuntimes.codex, sessionScope.role),
  };
};

export const resolveRuntimeSessionContextRef = async (
  repoPath: string,
  session: RuntimeSessionContextSource,
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy,
): Promise<AgentSessionRuntimeRef> => {
  if (!session.role) {
    throw new Error(`Workflow session '${session.externalSessionId}' is missing a role.`);
  }
  const sessionScope = workflowAgentSessionScope(session.taskId, session.role);
  const runtimePolicy = await resolveAgentSessionRuntimePolicy({
    runtimeKind: session.runtimeKind,
    sessionScope,
    loadSettingsSnapshot,
  });
  return toRuntimeSessionContextRef(repoPath, session, runtimePolicy);
};
