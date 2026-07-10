import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";
import type { AgentSessionRuntimeSnapshot } from "./session-runtime-snapshot";

export type RuntimeChildSnapshot = Extract<
  AgentSessionRuntimeSnapshot,
  { availability: "runtime" }
> & { parentExternalSessionId: string };

export const runtimeChildSnapshotsForSession = ({
  session,
  runtimeSnapshots,
  materializedSessionKeys,
}: {
  session: AgentSessionState;
  runtimeSnapshots: RepoRuntimeSessionSnapshots;
  materializedSessionKeys: ReadonlySet<string>;
}): RuntimeChildSnapshot[] => {
  const normalizedWorkingDirectory = normalizeWorkingDirectory(session.workingDirectory);
  return [...runtimeSnapshots.values()].filter(
    (snapshot): snapshot is RuntimeChildSnapshot =>
      snapshot.availability === "runtime" &&
      snapshot.parentExternalSessionId === session.externalSessionId &&
      snapshot.ref.externalSessionId !== session.externalSessionId &&
      snapshot.ref.runtimeKind === session.runtimeKind &&
      normalizeWorkingDirectory(snapshot.ref.workingDirectory) === normalizedWorkingDirectory &&
      !materializedSessionKeys.has(agentSessionIdentityKey(snapshot.ref)),
  );
};
