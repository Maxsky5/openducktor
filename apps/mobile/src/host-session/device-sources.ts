import * as Network from "expo-network";
import { AppState, type AppStateStatus } from "react-native";
import type {
  AppActivity,
  AppActivitySource,
  DeviceNetwork,
  DeviceNetworkSource,
} from "./lifecycle-controller";

// iOS reports `inactive` during the app switcher and system sheets. The app keeps working then.
// Only draft writes count `inactive` as hidden, through `draftFlushVisibility`.
const activityOf = (status: AppStateStatus | string | null | undefined): AppActivity =>
  status === "background" ? "background" : "foreground";

export const appActivitySource: AppActivitySource = {
  current: () => activityOf(AppState.currentState),
  subscribe(listener) {
    const subscription = AppState.addEventListener("change", (status) =>
      listener(activityOf(status)),
    );
    return () => subscription.remove();
  },
};

const networkOf = (state: Network.NetworkState): DeviceNetwork => ({
  // An unknown link counts as connected; protected networks can lack internet access.
  isConnected: state.isConnected !== false,
  type: state.type ?? Network.NetworkStateType.UNKNOWN,
});

/**
 * Reports the device link from expo-network. Create one source for the app process: its
 * expo-network listener stays, because the iOS module cancels its path monitor when the last
 * listener goes and does not restart it. Internet reachability is not used.
 */
export const createDeviceNetworkSource = (): DeviceNetworkSource => {
  let current: DeviceNetwork = { isConnected: true, type: null };
  const listeners = new Set<(network: DeviceNetwork) => void>();
  const update = (next: DeviceNetwork) => {
    if (next.isConnected === current.isConnected && next.type === current.type) return;
    current = next;
    for (const listener of listeners) listener(next);
  };
  Network.addNetworkStateListener((event) => update(networkOf(event)));
  const refresh = () => {
    void Network.getNetworkStateAsync().then(
      (state) => update(networkOf(state)),
      (cause) => console.warn("Could not read the device network state", cause),
    );
  };
  refresh();
  return {
    current: () => current,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
