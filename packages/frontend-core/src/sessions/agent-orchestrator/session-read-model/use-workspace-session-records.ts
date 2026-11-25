import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { HostFeedbackFailure } from "../../../lib/host-failure";
import { workspaceSessionListQueryOptions } from "../../../queries/workspace-sessions";
import { observeWorkspaceSessionRecords } from "../../../queries/workspace-session-updates";

export const useWorkspaceSessionRecords = (
  workspaceId: string | null,
  queryClient: QueryClient,
  reloadGeneration: number,
) => {
  const records = useQuery(
    {
      ...workspaceSessionListQueryOptions(workspaceId ?? ""),
      enabled: workspaceId !== null,
    },
    queryClient,
  );
  const [subscriptionError, setSubscriptionError] = useState<HostFeedbackFailure | null>(null);
  useEffect(() => {
    if (workspaceId === null) return;
    return observeWorkspaceSessionRecords(queryClient, setSubscriptionError);
  }, [queryClient, reloadGeneration, workspaceId]);
  return { records, subscriptionError };
};
