export type PendingInputIdentity = {
  requestId: string;
  requestInstanceId?: string | undefined;
};

export const pendingInputIdentity = (entry: PendingInputIdentity): string =>
  entry.requestInstanceId ?? entry.requestId;
