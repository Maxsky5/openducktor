import type { EnsureQueryDataOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import type { TaskDocumentPayload } from "@/types/task-documents";

export const ensureTaskDocumentQueryData = <TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: EnsureQueryDataOptions<TaskDocumentPayload, Error, TaskDocumentPayload, TQueryKey>,
): Promise<TaskDocumentPayload> =>
  queryClient.ensureQueryData({
    ...options,
    revalidateIfStale: true,
  });
