import type { AgentToolPart } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "../lib/working-directory";
import type { AgentOperationsContextValue } from "../types/session-slices";
import {
  type RuntimeSessionHistoryRefInput,
  runtimeSessionHistoryRefQueryOptions,
} from "./agent-session-history";
import { loadSettingsSnapshotFromQuery } from "./workspace";

/** The session of a transcript whose tool rows can read full tool parts. */
export type ToolPartSession = RuntimeSessionHistoryRefInput;

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
          loadSettingsSnapshotFromQuery(queryClient),
        ),
      );
      return readSessionToolPart({ ...ref, partId, callId });
    },
    staleTime: Number.POSITIVE_INFINITY,
    // A remote read already waits for a reconnect. The user retries other failures.
    retry: false,
    refetchOnWindowFocus: false,
  });
