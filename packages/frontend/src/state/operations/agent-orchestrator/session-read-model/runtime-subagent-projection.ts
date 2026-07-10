import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { upsertSessionMessage } from "../support/messages";
import { createSubagentMessage } from "../support/subagent-messages";
import type { RepoRuntimeSessionSnapshots } from "./repo-runtime-session-snapshots";

export type RuntimeSubagentProjection = {
  session: AgentSessionState;
  hasActiveChild: boolean;
};

export const projectRuntimeSubagentsToSession = ({
  session,
  runtimeSnapshots,
  materializedSessionKeys,
}: {
  session: AgentSessionState;
  runtimeSnapshots: RepoRuntimeSessionSnapshots;
  materializedSessionKeys: ReadonlySet<string>;
}): RuntimeSubagentProjection => {
  let messages = session.messages;
  let hasProjectedChild = false;
  let hasActiveChild = false;

  for (const snapshot of runtimeSnapshots.values()) {
    if (
      snapshot.availability !== "runtime" ||
      snapshot.parentExternalSessionId !== session.externalSessionId ||
      snapshot.ref.runtimeKind !== session.runtimeKind ||
      normalizeWorkingDirectory(snapshot.ref.workingDirectory) !==
        normalizeWorkingDirectory(session.workingDirectory) ||
      materializedSessionKeys.has(agentSessionIdentityKey(snapshot.ref))
    ) {
      continue;
    }

    const status = snapshot.classification === "idle" ? "completed" : "running";
    hasProjectedChild = true;
    hasActiveChild = hasActiveChild || status === "running";
    const correlationKey = `session:${snapshot.ref.externalSessionId}`;
    messages = upsertSessionMessage(
      { ...session, messages },
      createSubagentMessage({
        timestamp: snapshot.startedAt,
        meta: {
          kind: "subagent",
          partId: correlationKey,
          correlationKey,
          status,
          prompt: snapshot.title,
          externalSessionId: snapshot.ref.externalSessionId,
        },
      }),
    );
  }

  return {
    session: hasProjectedChild ? { ...session, messages } : session,
    hasActiveChild,
  };
};
