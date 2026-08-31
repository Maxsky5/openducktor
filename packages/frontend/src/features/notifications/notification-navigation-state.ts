import {
  notificationSessionIdentitySchema,
  type NotificationSessionIdentity,
} from "@openducktor/contracts";
import { z } from "zod";

const NOTIFICATION_SESSION_STATE_KEY = "notificationSession";
const notificationSessionNavigationStateSchema = z.object({
  [NOTIFICATION_SESSION_STATE_KEY]: notificationSessionIdentitySchema,
});
export type NotificationSessionNavigationState = z.output<
  typeof notificationSessionNavigationStateSchema
>;

export const notificationSessionNavigationState = (session: NotificationSessionIdentity) =>
  ({
    [NOTIFICATION_SESSION_STATE_KEY]: session,
  }) satisfies NotificationSessionNavigationState;

export const notificationSessionIdentityFromNavigationState = (
  state: NotificationSessionNavigationState | null,
  sessionExternalId: string | null,
): NotificationSessionIdentity | null => {
  if (!sessionExternalId) {
    return null;
  }
  const parsed = notificationSessionNavigationStateSchema.safeParse(state);
  if (!parsed.success || parsed.data.notificationSession.externalSessionId !== sessionExternalId) {
    return null;
  }
  return parsed.data.notificationSession;
};
