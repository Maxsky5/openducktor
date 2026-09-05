import type { NotificationDispatchFailure } from "./notification-policy";

export type NotificationFailureState = {
  coordination: NotificationDispatchFailure | null;
  settings: NotificationDispatchFailure | null;
  os: NotificationDispatchFailure | null;
};

export const createNotificationFailureState = (): NotificationFailureState => ({
  coordination: null,
  settings: null,
  os: null,
});

export const recordNotificationFailure = (
  state: NotificationFailureState,
  failure: NotificationDispatchFailure,
): NotificationFailureState => {
  if (failure.channel === "settings") {
    if (state.settings) return state;
    return { ...state, settings: failure };
  }
  if (failure.channel === "coordination") {
    if (state.coordination) return state;
    return { ...state, coordination: failure };
  }
  if (failure.channel === "os") {
    if (state.os) return state;
    return { ...state, os: failure };
  }
  return state;
};

export const clearOsNotificationFailure = (
  state: NotificationFailureState,
): NotificationFailureState => {
  if (!state.os) return state;
  return { ...state, os: null };
};

export const clearCoordinationNotificationFailure = (
  state: NotificationFailureState,
): NotificationFailureState => {
  if (!state.coordination) return state;
  return { ...state, coordination: null };
};

export const selectNotificationFailure = (
  state: NotificationFailureState,
): NotificationDispatchFailure | null => state.settings ?? state.coordination ?? state.os;

export const clearSettingsNotificationFailure = (
  state: NotificationFailureState,
): NotificationFailureState => {
  if (!state.settings) return state;
  return { ...state, settings: null };
};
