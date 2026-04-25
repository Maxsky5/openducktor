import type { TaskDocumentPayload } from "@/types/task-documents";

export const toUpdatedAtTimestamp = (updatedAt: string | null): number | null => {
  if (!updatedAt) {
    return null;
  }

  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? null : parsed;
};

export const resolveLatestDocumentPayload = (
  current: TaskDocumentPayload | undefined,
  incoming: TaskDocumentPayload,
): TaskDocumentPayload => {
  if (!current) {
    return incoming;
  }

  const currentTimestamp = toUpdatedAtTimestamp(current.updatedAt);
  const incomingTimestamp = toUpdatedAtTimestamp(incoming.updatedAt);

  if (currentTimestamp !== null && incomingTimestamp !== null) {
    return incomingTimestamp >= currentTimestamp ? incoming : current;
  }

  if (currentTimestamp !== null && incomingTimestamp === null) {
    return incoming.markdown !== current.markdown ? incoming : current;
  }

  return incoming;
};
