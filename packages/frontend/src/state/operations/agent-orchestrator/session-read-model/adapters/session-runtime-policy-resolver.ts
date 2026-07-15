import type { RuntimeKind, SettingsSnapshot } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, AgentSessionScope } from "@openducktor/core";
import { resolveAgentSessionRuntimePolicyFromSnapshot } from "../../support/session-runtime-policy";

type LoadSettingsSnapshot = () => Promise<SettingsSnapshot>;

export type ResolveSessionRuntimePolicySync = (input: {
  runtimeKind: RuntimeKind;
  sessionScope?: AgentSessionScope | null;
}) => AgentSessionRuntimePolicy;

const openCodeRuntimePolicy = (): AgentSessionRuntimePolicy => ({ kind: "opencode" });

export const loadSessionRuntimePolicyResolver = async ({
  runtimeKinds,
  loadSettingsSnapshot,
}: {
  runtimeKinds: readonly RuntimeKind[];
  loadSettingsSnapshot: LoadSettingsSnapshot;
}): Promise<ResolveSessionRuntimePolicySync> => {
  if (runtimeKinds.every((runtimeKind) => runtimeKind === "opencode")) {
    return ({ runtimeKind }) => {
      if (runtimeKind !== "opencode") {
        throw new Error(`Runtime policy for '${runtimeKind}' was not loaded.`);
      }
      return openCodeRuntimePolicy();
    };
  }

  const snapshot = await loadSettingsSnapshot();
  return ({ runtimeKind, sessionScope }) =>
    resolveAgentSessionRuntimePolicyFromSnapshot({
      runtimeKind,
      snapshot,
      ...(sessionScope !== undefined ? { sessionScope } : {}),
    });
};
