import type { TaskDocumentPayload } from "@/types/task-documents";

type TaskDocumentStateLike = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

const parseUpdatedAtTimestamp = (updatedAt: string | null): number | null => {
  if (!updatedAt) {
    return null;
  }

  const timestamp = Date.parse(updatedAt);
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const resolveLoadedDocumentState = <TState extends TaskDocumentStateLike>(
  current: TState,
  incoming: TaskDocumentPayload,
): TState => {
  const currentTimestamp = parseUpdatedAtTimestamp(current.updatedAt);
  const incomingTimestamp = parseUpdatedAtTimestamp(incoming.updatedAt);
  const shouldPreserveCurrentDocument =
    currentTimestamp !== null && incomingTimestamp !== null && incomingTimestamp < currentTimestamp;

  if (shouldPreserveCurrentDocument) {
    return {
      ...current,
      isLoading: false,
      error: null,
      loaded: true,
    };
  }

  return {
    ...current,
    markdown: incoming.markdown,
    updatedAt: incoming.updatedAt,
    isLoading: false,
    error: incoming.error ?? null,
    loaded: true,
  };
};
