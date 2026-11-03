import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { StartupPresentationContext } from "./startup-presentation-context";
import type { StartupOutputReading } from "./startup-output-reading";

/** Details and reading positions stay with the attempt when its progress changes windows. */
export function StartupPresentationProvider({ children }: PropsWithChildren): ReactElement {
  const [expanded, setExpanded] = useState<Record<string, ReadonlySet<string>>>({});
  // Each attempt keeps its positions here until it ends. The containers keep their identity.
  const [stores] = useState(() => ({
    scroll: new Map<string, number>(),
    notificationPresented: new Set<string>(),
    readings: new Map<string, Map<string, StartupOutputReading>>(),
    sheetClosers: new Map<string, () => void>(),
  }));
  const attempts = useStartupAttempts();
  useEffect(() => {
    const retained = new Set(attempts.map((attempt) => attempt.id));
    for (const store of [
      stores.scroll,
      stores.notificationPresented,
      stores.readings,
      stores.sheetClosers,
    ]) {
      for (const id of store.keys()) if (!retained.has(id)) store.delete(id);
    }
    setExpanded((current) =>
      Object.keys(current).every((id) => retained.has(id))
        ? current
        : Object.fromEntries(Object.entries(current).filter(([id]) => retained.has(id))),
    );
  }, [attempts, stores]);
  const toggle = useCallback((attemptId: string, stepId: string) => {
    setExpanded((current) => {
      const next = new Set(current[attemptId]);
      if (!next.delete(stepId)) next.add(stepId);
      return { ...current, [attemptId]: next };
    });
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
  const value = useMemo(
    () => ({
      expanded,
      scroll: stores.scroll,
      notificationPresented: stores.notificationPresented,
      toggle,
      outputReading,
      sheetClosers: stores.sheetClosers,
    }),
    [expanded, outputReading, stores, toggle],
  );
  return <StartupPresentationContext value={value}>{children}</StartupPresentationContext>;
}
