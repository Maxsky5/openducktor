import type { RuntimeKind, SettingsSnapshot } from "@openducktor/contracts";
import type { TaskWorkflowRole } from "@openducktor/workflows";
import type { AgentSessionRuntimePolicy, AgentSessionScope } from "@openducktor/core";
import {
  resolveAgentSessionRuntimePolicyFromSnapshot,
  resolveSettingsIndependentAgentSessionRuntimePolicy,
} from "../../support/session-runtime-policy";

type LoadSettingsSnapshot = () => Promise<SettingsSnapshot>;

export type ResolveSessionRuntimePolicySync = (input: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
  workflowRole?: TaskWorkflowRole;
}) => AgentSessionRuntimePolicy;

export const loadSessionRuntimePolicyResolver = async ({
  runtimeKinds,
  loadSettingsSnapshot,
}: {
  runtimeKinds: readonly RuntimeKind[];
  loadSettingsSnapshot: LoadSettingsSnapshot;
}): Promise<ResolveSessionRuntimePolicySync> => {
  if (runtimeKinds.every((runtimeKind) => runtimeKind !== "codex")) {
    return ({ runtimeKind }) => {
      const runtimePolicy = resolveSettingsIndependentAgentSessionRuntimePolicy(runtimeKind);
      if (!runtimePolicy) {
        throw new Error(`Runtime policy for '${runtimeKind}' was not loaded.`);
      }
      return runtimePolicy;
    };
  }

  const snapshot = await loadSettingsSnapshot();
  return ({ runtimeKind, sessionScope, workflowRole }) => {
    const input: Parameters<typeof resolveAgentSessionRuntimePolicyFromSnapshot>[0] = {
      runtimeKind,
      snapshot,
    };
    if (sessionScope !== undefined) {
      input.sessionScope = sessionScope;
    }
    if (workflowRole) input.workflowRole = workflowRole;
    return resolveAgentSessionRuntimePolicyFromSnapshot(input);
  };
};
