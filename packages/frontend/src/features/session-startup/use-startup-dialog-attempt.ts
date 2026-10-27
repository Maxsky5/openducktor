import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type {
  StartupAttempt,
  StartupAttemptStore,
} from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";

type DialogAttemptSnapshot = {
  attempt: StartupAttempt | null;
  released: boolean;
  hasFailed: boolean;
};

export function useStartupDialogAttempt(id: string | null) {
  const { startupAttempts } = useClientConnection();
  const observer = useMemo(
    () => createDialogAttemptObserver(startupAttempts, id),
    [startupAttempts, id],
  );
  return useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getSnapshot);
}

export function useStartupDialogClose(
  { attempt, released }: DialogAttemptSnapshot,
  open: boolean,
  onClose: () => void,
): void {
  const close = useEffectEvent(onClose);
  const transferred = attempt?.presentation === "notification";
  useEffect(() => {
    if (open && (released || transferred)) close();
  }, [open, released, transferred]);
}

function createDialogAttemptObserver(attempts: StartupAttemptStore, id: string | null) {
  const initial = id ? attempts.getAttempt(id) : null;
  let snapshot: DialogAttemptSnapshot = {
    attempt: initial,
    released: false,
    hasFailed: initial?.status.phase === "failed",
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (!id) return () => {};
      const update = () => {
        const attempt = attempts.getAttempt(id);
        if (attempt === snapshot.attempt || (!attempt && snapshot.released)) return;
        if (attempt)
          snapshot = {
            attempt,
            released: false,
            hasFailed: snapshot.hasFailed || attempt.status.phase === "failed",
          };
        else if (snapshot.attempt) snapshot = { ...snapshot, released: true };
        else return;
        listener();
      };
      const stop = attempts.subscribe(update);
      update();
      return stop;
    },
  };
}
