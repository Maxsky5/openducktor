import { usePreventRemove } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { closeScreen } from "@/navigation/close-screen";

export function useGuardedStartupSheetClose(
  navigation: Parameters<typeof closeScreen>[0],
  preventRemove: boolean,
  onPreventedRemove?: () => void,
): () => void {
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);
  const allowRemoval = usePreventRemove(!closing && preventRemove, onPreventedRemove);
  return useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    // Keep the guard off while the native close transition runs.
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setClosing(true);
    allowRemoval();
    closeScreen(navigation);
  }, [allowRemoval, navigation]);
}
