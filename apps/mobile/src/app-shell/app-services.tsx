import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useSyncExternalStore,
} from "react";
import { useStore } from "zustand";
import type { FeedbackStore } from "@/feedback/feedback-store";
import type { HostSessionOwner, HostSessionState } from "@/host-session/host-session-owner";
import type { DevicePreferences, DevicePreferencesState } from "@/preferences/device-preferences";

export type AppServices = {
  owner: HostSessionOwner;
  preferences: DevicePreferences;
  feedback: FeedbackStore;
};

const AppServicesContext = createContext<AppServices | null>(null);

/** App services for the whole process: saved hosts, the active host session, and preferences. */
export function AppServicesProvider({
  services,
  children,
}: PropsWithChildren<{ services: AppServices }>): ReactElement {
  return <AppServicesContext value={services}>{children}</AppServicesContext>;
}

const useAppServices = (): AppServices => {
  const services = use(AppServicesContext);
  if (!services) throw new Error("App services are missing. Render this view inside the app root.");
  return services;
};

export const useHostSessionOwner = (): HostSessionOwner => useAppServices().owner;

export const useHostSessionState = (): HostSessionState => {
  const { owner } = useAppServices();
  return useSyncExternalStore(owner.subscribe, owner.getState, owner.getState);
};

export const useFeedbackStore = (): FeedbackStore => useAppServices().feedback;

export const useDevicePreferences = <Selected,>(
  select: (state: DevicePreferencesState) => Selected,
): Selected => useStore(useAppServices().preferences.state, select);

export const useDevicePreferencesActions = (): Pick<DevicePreferences, "update" | "reset"> => {
  const { preferences } = useAppServices();
  return preferences;
};
