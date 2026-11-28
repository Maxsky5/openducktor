import { useSyncExternalStore } from "react";
import { useClientConnection } from "../connection/client-connection-react";

export const useBackgroundAttempts = () => {
  const { backgroundOperations } = useClientConnection();
  return useSyncExternalStore(
    backgroundOperations.subscribe,
    backgroundOperations.getSnapshot,
    backgroundOperations.getSnapshot,
  );
};
