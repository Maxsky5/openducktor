import { useEffect, useLayoutEffect, useState } from "react";

/**
 * The lifecycle of a workflow sheet. The sheet runs its action once, when `ready` is true. The
 * action opens its first step, such as the start choices, in the same render. The sheet then
 * closes when no step is open: after a start that stays, a cancel, or a failure before a step
 * opened. A start that opens its session leaves the sheet first, so `close` does nothing after it.
 * Missing required data controls loading. Local setup opens the step before the sheet paints.
 */
export function useWorkflowSheetLifecycle({
  ready,
  run,
  anyOpen,
  close,
}: {
  ready: boolean;
  run: () => void;
  anyOpen: boolean;
  close: () => void;
}) {
  const [triggered, setTriggered] = useState(false);
  useLayoutEffect(() => {
    if (triggered || !ready) return;
    // The action can open no step, such as after a failure. The state change renders the sheet
    // once more, so the close check below sees what the action opened.
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setTriggered(true);
    run();
  }, [ready, run, triggered]);
  useEffect(() => {
    if (triggered && !anyOpen) close();
  }, [anyOpen, close, triggered]);
  return { triggered, loading: !ready };
}
