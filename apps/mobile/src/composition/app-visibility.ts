import { AppState } from "react-native";
import { appActivitySource } from "@/host-session/device-sources";
import { type AppStateSource, visibilityOf } from "./app-visibility-source";

/**
 * The app is hidden only in the background. iOS reports `inactive` while Control Center or a system
 * sheet shows. The user still sees the app then, so Git refreshes and read marks do not change.
 */
export const appStateVisibility = visibilityOf(
  appActivitySource,
  (activity) => activity === "background",
);

const appStateSource: AppStateSource<string | null | undefined> = {
  current: () => AppState.currentState,
  subscribe(listener) {
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  },
};

/**
 * Use only to save drafts. iOS reports only `inactive` while the app switcher shows, and a swipe
 * there ends the app with no `background` event. So drafts save on `inactive` too.
 */
export const draftFlushVisibility = visibilityOf(
  appStateSource,
  (status) => status === "inactive" || status === "background",
);
