export const pendingInputIdentity = (entry: {
  requestId: string;
  requestInstanceId?: string | undefined;
}): string => entry.requestInstanceId ?? entry.requestId;
