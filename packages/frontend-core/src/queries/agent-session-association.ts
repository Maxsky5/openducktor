import type { AgentSessionLiveRef, WorkspaceSession } from "@openducktor/contracts";
import { matchesAgentSessionIdentity } from "../lib/agent-session-identity";
export const findWorkspaceSessionByIdentity = (
  records: readonly WorkspaceSession[],
  ref: Pick<AgentSessionLiveRef, "externalSessionId" | "runtimeKind" | "workingDirectory">,
): WorkspaceSession | undefined =>
  records.find(
    (record) =>
      record.externalSessionId !== null &&
      matchesAgentSessionIdentity(
        {
          ...record,
          externalSessionId: record.externalSessionId,
          workingDirectory: record.executionTarget.workingDirectory,
        },
        ref,
      ),
  );
