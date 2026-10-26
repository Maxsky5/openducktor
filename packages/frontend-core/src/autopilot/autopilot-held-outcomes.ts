import type { AutopilotState } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { autopilotStateQueryOptions } from "../queries/autopilot";

export type AutopilotHeldOutcomeHandlers = {
  onRead: (workspaceId: string, state: AutopilotState) => void;
  onReadFailure: (workspaceId: string, cause: unknown) => void;
};

/**
 * Reads the failed and skipped outcomes that the host keeps for each workspace. Each read calls
 * its handler when it completes, and the result lists the causes of the failed reads.
 */
export const readAutopilotHeldOutcomes = async (
  queryClient: QueryClient,
  workspaceIds: readonly string[],
  { onRead, onReadFailure }: AutopilotHeldOutcomeHandlers,
): Promise<unknown[]> => {
  const reads = await Promise.allSettled(
    workspaceIds.map((workspaceId) =>
      queryClient.fetchQuery(autopilotStateQueryOptions(workspaceId)).then(
        (state) => onRead(workspaceId, state),
        (cause: unknown) => {
          onReadFailure(workspaceId, cause);
          throw cause;
        },
      ),
    ),
  );
  return reads.flatMap((read) => (read.status === "rejected" ? [read.reason] : []));
};
