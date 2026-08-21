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
  const promise = new Promise<void>((resolve) => {
    admit = resolve;
  });
  session.pendingUserMessageAdmissions.set(messageId, admit);

  return {
    promise,
    dispose: () => {
      if (session.pendingUserMessageAdmissions.get(messageId) === admit) {
        session.pendingUserMessageAdmissions.delete(messageId);
      }
    },
  };
};

export const admitUserMessage = (session: SessionRecord, messageId: string): void => {
  const admit = session.pendingUserMessageAdmissions.get(messageId);
  if (!admit) {
    return;
  }
  session.pendingUserMessageAdmissions.delete(messageId);
  admit();
};
