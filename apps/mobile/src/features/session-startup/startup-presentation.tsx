import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  StartupPresentationActionsContext,
  StartupPresentationStateContext,
} from "./startup-presentation-context";
import type { StartupOutputReading } from "./startup-output-reading";

type PresentationStores = {
  scroll: Map<string, number>;
  notificationPresented: Set<string>;
  readings: Map<string, Map<string, StartupOutputReading>>;
  sheetClosers: Map<string, () => void>;
};

const pruneRecord = <Value,>(
  current: Record<string, Value>,
  retained: ReadonlySet<string>,
): Record<string, Value> =>
  Object.keys(current).every((id) => retained.has(id))
    ? current
    : Object.fromEntries(Object.entries(current).filter(([id]) => retained.has(id)));

/** Details and reading positions stay with the attempt when its progress changes windows. */
export function StartupPresentationProvider({ children }: PropsWithChildren): ReactElement {
  const { startupAttempts } = useClientConnection();
  const [expanded, setExpanded] = useState<Record<string, ReadonlySet<string>>>({});
  const [inlineProgressOverride, setInlineProgressOverride] = useState<Record<string, boolean>>({});
  // Each attempt keeps its positions here until it ends. The containers keep their identity.
  const [stores] = useState<PresentationStores>(() => ({
    scroll: new Map<string, number>(),
    notificationPresented: new Set<string>(),
    readings: new Map<string, Map<string, StartupOutputReading>>(),
    sheetClosers: new Map<string, () => void>(),
  }));
  useEffect(() => {
    const prune = () => {
      const retained = new Set(startupAttempts.getSnapshot().map((attempt) => attempt.id));
      for (const store of [
        stores.scroll,
        stores.notificationPresented,
        stores.readings,
        stores.sheetClosers,
      ]) {
        for (const id of store.keys()) if (!retained.has(id)) store.delete(id);
      }
      setExpanded((current) => pruneRecord(current, retained));
      setInlineProgressOverride((current) => pruneRecord(current, retained));
    };
    prune();
    return startupAttempts.subscribe(prune);
  }, [startupAttempts, stores]);
  const toggle = useCallback((attemptId: string, stepId: string) => {
    setExpanded((current) => {
      const next = new Set(current[attemptId]);
      if (!next.delete(stepId)) next.add(stepId);
      return { ...current, [attemptId]: next };
    });
  }, []);
  const setInlineProgressOpen = useCallback((attemptId: string, open: boolean) => {
    setInlineProgressOverride((current) => ({ ...current, [attemptId]: open }));
  }, []);
  const outputReading = useCallback(
    (attemptId: string, terminalId: string): StartupOutputReading => {
      let terminals = stores.readings.get(attemptId);
      if (!terminals) {
        terminals = new Map();
        stores.readings.set(attemptId, terminals);
      }
      let reading = terminals.get(terminalId);
      if (!reading) {
        reading = { text: null, textOffset: 0 };
        terminals.set(terminalId, reading);
      }
      return reading;
    },
    [stores],
  );
  const actions = useMemo(
    () => ({
      scroll: stores.scroll,
      notificationPresented: stores.notificationPresented,
      toggle,
      setInlineProgressOpen,
      outputReading,
      sheetClosers: stores.sheetClosers,
    }),
    [outputReading, setInlineProgressOpen, stores, toggle],
  );
  const state = useMemo(
    () => ({ expanded, inlineProgressOverride }),
    [expanded, inlineProgressOverride],
  );
  return (
    <StartupPresentationActionsContext value={actions}>
      <StartupPresentationStateContext value={state}>{children}</StartupPresentationStateContext>
    </StartupPresentationActionsContext>
  );
}
