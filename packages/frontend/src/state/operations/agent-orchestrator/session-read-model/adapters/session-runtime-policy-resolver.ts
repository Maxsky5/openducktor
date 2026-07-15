import type { RuntimeKind, SettingsSnapshot } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy } from "@openducktor/core";
import { resolveAgentSessionRuntimePolicyFromSnapshot } from "../../support/session-runtime-policy";
import type { ResolveSessionRuntimePolicySync } from "../repo-session-read-model";

type LoadSettingsSnapshot = () => Promise<SettingsSnapshot>;

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
