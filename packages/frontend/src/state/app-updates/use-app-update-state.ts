import type {
  AppUpdateCommandResult,
  AppUpdateErrorCode,
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

export type AppUpdateCommandError = {
  code?: AppUpdateErrorCode;
  message: string;
  operation: AppUpdateOperation;
};

export type AppUpdateStateController = {
  actionInFlight: AppUpdateAction | null;
  checkFromSettings(): Promise<AppUpdateCommandResult | null>;
  commandError: AppUpdateCommandError | null;
  download(): Promise<AppUpdateCommandResult | null>;
  hasReceivedStateEvent: boolean;
  install(): Promise<AppUpdateCommandResult | null>;
  isLoadingInitialState: boolean;
  state: AppUpdateState | null;
};

export function useAppUpdateState(): AppUpdateStateController {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [isLoadingInitialState, setIsLoadingInitialState] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<AppUpdateAction | null>(null);
  const [commandError, setCommandError] = useState<AppUpdateCommandError | null>(null);
  const [hasReceivedStateEvent, setHasReceivedStateEvent] = useState(false);

  useEffect(() => {
    let disposed = false;
    let receivedSubscribedState = false;
    let unsubscribe: (() => void) | null = null;
    const appUpdates = getShellBridge().appUpdates;

    const loadInitialState = async (): Promise<void> => {
      try {
        const unsubscribeState = await appUpdates.subscribeState((nextState) => {
          receivedSubscribedState = true;
          if (!disposed) {
            setHasReceivedStateEvent(true);
            setState(nextState);
          }
        });
        if (disposed) {
          unsubscribeState();
          return;
        }
        unsubscribe = unsubscribeState;

        const nextState = await appUpdates.getState();
        if (!disposed && !receivedSubscribedState) {
          setCommandError(null);
          setState(nextState);
        }
      } catch (cause) {
        if (!disposed) {
          setState(unavailableState(errorMessage(cause), "initialize"));
        }
      } finally {
        if (!disposed) {
          setIsLoadingInitialState(false);
        }
      }
    };

    void loadInitialState();

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
      setCommandError(null);
      try {
        const result = await command();
        if (result.accepted) {
          setCommandError(null);
        } else {
          setCommandError({
            code: result.rejection.code,
            message: result.rejection.message,
            operation: result.rejection.operation,
          });
        }
        setState(result.state);
        return result;
      } catch (cause) {
        setCommandError({ message: errorMessage(cause), operation });
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
    commandError,
    download: () => runAction("download", "download", () => getShellBridge().appUpdates.download()),
    hasReceivedStateEvent,
    install: () => runAction("install", "install", () => getShellBridge().appUpdates.install()),
    isLoadingInitialState,
    state,
  };
}
