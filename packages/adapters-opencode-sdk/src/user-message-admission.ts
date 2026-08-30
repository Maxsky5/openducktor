import type { SessionRecord } from "./types";

export type PendingUserMessageAdmission = {
  promise: Promise<void>;
  dispose: () => void;
};

export const waitForUserMessageAdmission = (
  session: SessionRecord,
  messageId: string,
): PendingUserMessageAdmission => {
  let admit!: () => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<void>((resolve, rejectPromise) => {
    admit = resolve;
    reject = rejectPromise;
  });
  const pending = { admit, reject };
  session.pendingUserMessageAdmissions.set(messageId, pending);

  return {
    promise,
    dispose: () => {
      if (session.pendingUserMessageAdmissions.get(messageId) === pending) {
        session.pendingUserMessageAdmissions.delete(messageId);
      }
    },
  };
};

export const admitUserMessage = (session: SessionRecord, messageId: string): void => {
  const pending = session.pendingUserMessageAdmissions.get(messageId);
  if (!pending) {
    return;
  }
  session.pendingUserMessageAdmissions.delete(messageId);
  pending.admit();
};

export const cancelPendingUserMessageAdmissions = (session: SessionRecord, reason: Error): void => {
  const pendingAdmissions = [...session.pendingUserMessageAdmissions.values()];
  session.pendingUserMessageAdmissions.clear();
  for (const pending of pendingAdmissions) {
    pending.reject(reason);
  }
};
