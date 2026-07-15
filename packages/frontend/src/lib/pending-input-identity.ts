export type PendingInputIdentity = {
  requestId: string;
  requestInstanceId?: string;
};

export const pendingInputIdentity = (entry: PendingInputIdentity): string =>
  entry.requestInstanceId ?? entry.requestId;
