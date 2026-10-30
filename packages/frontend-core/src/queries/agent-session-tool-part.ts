import type { AgentToolPart } from "@openducktor/contracts";
import type { AgentSessionScope } from "@openducktor/core";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "../lib/working-directory";
import type { AgentSessionIdentity } from "../types/agent-orchestrator";
import type { AgentOperationsContextValue } from "../types/session-slices";
import { runtimeSessionHistoryRefQueryOptions } from "./agent-session-history";
import { settingsSnapshotQueryOptions } from "./workspace";

/** The session of a transcript whose tool rows can read full tool parts. */
export type ToolPartSession = AgentSessionIdentity & {
  repoPath: string;
  sessionScope: AgentSessionScope | null;
};

/** Reads one full tool part of a compact history. The part does not change after it ends. */
export const sessionToolPartQueryOptions = (
  session: ToolPartSession,
  { partId, callId }: { partId: string; callId: string },
  readSessionToolPart: AgentOperationsContextValue["readSessionToolPart"],
  queryClient: QueryClient,
) =>
  queryOptions<AgentToolPart>({
    queryKey: [
      "agent-session-tool-part",
      normalizeWorkingDirectory(session.repoPath),
      session.runtimeKind,
      normalizeWorkingDirectory(session.workingDirectory),
      session.externalSessionId,
      partId,
      callId,
    ],
    queryFn: async () => {
      const ref = await queryClient.ensureQueryData(
        runtimeSessionHistoryRefQueryOptions(session, () =>
          queryClient.ensureQueryData(settingsSnapshotQueryOptions()),
        ),
      );
      return readSessionToolPart({ ...ref, partId, callId });
    },
    staleTime: Number.POSITIVE_INFINITY,
    // A remote read already waits for a reconnect. The user retries other failures.
    retry: false,
    refetchOnWindowFocus: false,
  });
