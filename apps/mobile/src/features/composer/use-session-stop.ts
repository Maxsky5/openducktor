import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useCallback, useState } from "react";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";
import { useSessionTarget } from "@/features/session/session-target";
import { useSessionFacts } from "@/features/session/use-session-facts";

export type SessionStop = {
  /** True while the session runs a turn or waits for input, so Stop applies. */
  available: boolean;
  isStopping: boolean;
  failure: CommandFailure | null;
  stop: () => void;
};

/** Stops the running turn. A lost result shows Result unknown and never stops again on its own. */
export function useSessionStop(): SessionStop {
  const target = useSessionTarget();
  const facts = useSessionFacts();
  const { stopAgentSession } = useAgentOperationsContext();
  const [isStopping, setStopping] = useState(false);
  // One stop at a time. A second stop after the first one ended the turn would fail.
  const stopFlight = useSingleFlight();
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  const available = !target.readOnly && (facts.isWorking || facts.isWaitingInput);
  const { identity } = target;
  // A turn that ended on its own makes an old stop failure obsolete.
  if (!available && failure !== null) setFailure(null);
  const stop = useCallback(() => {
    void stopFlight.start(async () => {
      setStopping(true);
      setFailure(null);
      try {
        await stopAgentSession(identity);
      } catch (cause) {
        setFailure(toCommandFailure(cause, "Session not stopped"));
      } finally {
        setStopping(false);
      }
    });
  }, [identity, stopAgentSession, stopFlight]);
  return { available, isStopping, failure, stop };
}
