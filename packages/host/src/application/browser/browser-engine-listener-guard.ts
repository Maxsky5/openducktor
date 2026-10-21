import { Effect } from "effect";
import type { BrowserEnginePort, CdpSession } from "../../ports/browser-engine-port";

type ReportFailure = (operation: string, cause: unknown) => void;

/**
 * Engines deliver events inside their transport handlers, so a listener that throws can end the
 * browser connection. The host reports a listener failure and keeps the connection and the other
 * listeners running.
 */
export const guardBrowserEngineListeners = (
  engine: BrowserEnginePort,
  reportFailure: ReportFailure,
): BrowserEnginePort => ({
  ...engine,
  openSession: (tabId) =>
    engine.openSession(tabId).pipe(Effect.map((session) => guardSession(session, reportFailure))),
  subscribe: (listener) =>
    engine.subscribe(guarded("browser.engine.event", listener, reportFailure)),
});

const guarded =
  <Event>(operation: string, listener: (event: Event) => void, reportFailure: ReportFailure) =>
  (event: Event): void => {
    try {
      listener(event);
    } catch (cause) {
      reportFailure(operation, cause);
    }
  };

const guardSession = (session: CdpSession, reportFailure: ReportFailure): CdpSession => ({
  ...session,
  subscribe: (listener) => session.subscribe(guarded("browser.cdp.event", listener, reportFailure)),
});
