import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Keeps a modal window open until its current content finishes leaving. */
export function useModalPresence(
  visible: boolean,
  {
    onShow,
    onDismiss,
  }: { onShow?: (() => void) | undefined; onDismiss?: (() => void) | undefined },
) {
  const [state, setState] = useState({ visible, mounted: visible, cycle: 0 });
  if (state.visible !== visible) {
    // Commit the new cycle with its content, so a late exit cannot remove a reopened modal.
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setState({
      visible,
      mounted: visible || state.mounted,
      cycle: state.cycle + (visible ? 1 : 0),
    });
  }
  const latest = useRef({ ...state, onShow, onDismiss });
  useLayoutEffect(() => {
    latest.current = { ...state, onShow, onDismiss };
  }, [onDismiss, onShow, state]);

  const entered = useCallback((cycle: number) => {
    const current = latest.current;
    if (current.visible && current.cycle === cycle) current.onShow?.();
  }, []);
  const exited = useCallback((cycle: number) => {
    const current = latest.current;
    if (current.visible || !current.mounted || current.cycle !== cycle) return;
    current.mounted = false;
    setState((state) => ({ ...state, mounted: false }));
    current.onDismiss?.();
  }, []);

  return { mounted: visible || state.mounted, cycle: state.cycle, entered, exited };
}
