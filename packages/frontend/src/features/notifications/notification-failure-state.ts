import type { NotificationDispatchFailure } from "./notification-policy";

export const selectOsFailureState = (
  current: NotificationDispatchFailure | null,
  next: NotificationDispatchFailure,
): NotificationDispatchFailure => current ?? next;
