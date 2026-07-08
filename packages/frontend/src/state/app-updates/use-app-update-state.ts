import type {
  AppUpdateCommandResult,
  AppUpdateOperation,
  AppUpdateState,
} from "@openducktor/contracts";
import { useCallback, useEffect, useState } from "react";
import { getShellBridge } from "@/lib/shell-bridge";

const unavailableState = (message: string, operation: AppUpdateOperation): AppUpdateState => ({
  status: "error",
  currentVersion: "unknown",
  error: {
    code: "updater_unavailable",
    message,
    operation,
  },
});

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export type AppUpdateAction = "check" | "download" | "install";

export type AppUpdateStateController = {
  actionInFlight: AppUpdateAction | null;
  checkFromSettings(): Promise<AppUpdateCommandResult | null>;
  download(): Promise<AppUpdateCommandResult | null>;
  install(): Promise<AppUpdateCommandResult | null>;
  isLoadingInitialState: boolean;
  state: AppUpdateState | null;
};

export function useAppUpdateState(): AppUpdateStateController {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [isLoadingInitialState, setIsLoadingInitialState] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<AppUpdateAction | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const appUpdates = getShellBridge().appUpdates;

    void appUpdates
      .getState()
      .then((nextState) => {
        if (!disposed) {
          setState(nextState);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setState(unavailableState(errorMessage(cause), "initialize"));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoadingInitialState(false);
        }
      });

    void appUpdates
      .subscribeState((nextState) => {
        if (!disposed) {
          setState(nextState);
        }
      })
      .then((unsubscribeState) => {
        if (disposed) {
          unsubscribeState();
          return;
        }
        unsubscribe = unsubscribeState;
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setState(unavailableState(errorMessage(cause), "initialize"));
        }
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const runAction = useCallback(
    async (
      action: AppUpdateAction,
      operation: AppUpdateOperation,
      command: () => Promise<AppUpdateCommandResult>,
    ): Promise<AppUpdateCommandResult | null> => {
      setActionInFlight(action);
      try {
        const result = await command();
        setState(result.state);
        return result;
      } catch (cause) {
        setState(unavailableState(errorMessage(cause), operation));
        return null;
      } finally {
        setActionInFlight(null);
      }
    },
    [],
  );

  return {
    actionInFlight,
    checkFromSettings: () =>
      runAction("check", "check", () =>
        getShellBridge().appUpdates.check({ initiator: "settings" }),
      ),
    download: () => runAction("download", "download", () => getShellBridge().appUpdates.download()),
    install: () => runAction("install", "install", () => getShellBridge().appUpdates.install()),
    isLoadingInitialState,
    state,
  };
}
