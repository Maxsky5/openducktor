import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StartupPresentationContext } from "./startup-presentation-context";
import type { StartupOutputReading } from "./startup-output-reading";

/** Details and reading positions stay with the attempt when its progress changes windows. */
export function StartupPresentationProvider({ children }: PropsWithChildren): ReactElement {
  const [expanded, setExpanded] = useState<Record<string, ReadonlySet<string>>>({});
  const scroll = useRef(new Map<string, number>());
  const readings = useRef(new Map<string, Map<string, StartupOutputReading>>());
  const sheetClosers = useRef(new Map<string, () => void>());
  const attempts = useStartupAttempts();
  useEffect(() => {
    const retained = new Set(attempts.map((attempt) => attempt.id));
    for (const id of scroll.current.keys()) if (!retained.has(id)) scroll.current.delete(id);
    for (const id of readings.current.keys()) if (!retained.has(id)) readings.current.delete(id);
    for (const id of sheetClosers.current.keys())
      if (!retained.has(id)) sheetClosers.current.delete(id);
    setExpanded((current) =>
      Object.keys(current).every((id) => retained.has(id))
        ? current
        : Object.fromEntries(Object.entries(current).filter(([id]) => retained.has(id))),
    );
  }, [attempts]);
  const toggle = useCallback((attemptId: string, stepId: string) => {
    setExpanded((current) => {
      const next = new Set(current[attemptId]);
      if (!next.delete(stepId)) next.add(stepId);
      return { ...current, [attemptId]: next };
    });
  }, []);
  const outputReading = useCallback(
    (attemptId: string, terminalId: string): StartupOutputReading => {
      let terminals = readings.current.get(attemptId);
      if (!terminals) {
        terminals = new Map();
        readings.current.set(attemptId, terminals);
      }
      let reading = terminals.get(terminalId);
      if (!reading) {
        reading = { text: null, textOffset: 0 };
        terminals.set(terminalId, reading);
      }
      return reading;
    },
    [],
  );
  const value = useMemo(
    () => ({
      expanded,
      scroll: scroll.current,
      toggle,
      outputReading,
      sheetClosers: sheetClosers.current,
    }),
    [expanded, toggle, outputReading],
  );
  return <StartupPresentationContext value={value}>{children}</StartupPresentationContext>;
}
