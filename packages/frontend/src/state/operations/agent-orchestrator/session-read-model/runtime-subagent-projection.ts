import type { AgentSessionState } from "@/types/agent-orchestrator";
import { upsertSubagentMessage } from "../support/subagent-messages";
import type { RuntimeChildSnapshot } from "./runtime-child-snapshots";

export type RuntimeSubagentProjection = {
  session: AgentSessionState;
  hasActiveChild: boolean;
};

export const projectRuntimeSubagentsToSession = ({
  session,
  runtimeChildSnapshots,
}: {
  session: AgentSessionState;
  runtimeChildSnapshots: readonly RuntimeChildSnapshot[];
}): RuntimeSubagentProjection => {
  let messages = session.messages;
  let hasProjectedChild = false;
  let hasActiveChild = false;

  for (const snapshot of runtimeChildSnapshots) {
    const status = snapshot.classification === "idle" ? "completed" : "running";
    hasProjectedChild = true;
    hasActiveChild = hasActiveChild || status === "running";
    const correlationKey = `session:${snapshot.ref.externalSessionId}`;
    messages = upsertSubagentMessage({
      owner: { ...session, messages },
      timestamp: snapshot.startedAt,
      incomingMeta: {
        kind: "subagent",
        partId: correlationKey,
        correlationKey,
        status,
        prompt: snapshot.title,
        externalSessionId: snapshot.ref.externalSessionId,
      },
    });
  }

  return {
    session: hasProjectedChild ? { ...session, messages } : session,
    hasActiveChild,
  };
};
