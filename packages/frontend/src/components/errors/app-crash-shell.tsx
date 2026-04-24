import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppErrorBoundary } from "./app-error-boundary";
import { FatalErrorPage } from "./fatal-error-page";
import { buildFatalErrorReport, type FatalErrorReport, logFatalError } from "./fatal-error-report";

interface AppCrashShellProps {
  children: ReactNode;
}

export function AppCrashShell({ children }: AppCrashShellProps): ReactElement {
  const [fatalReport, setFatalReport] = useState<FatalErrorReport | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const reportRef = useRef<FatalErrorReport | null>(null);

  const reportFatal = useCallback(
    (report: FatalErrorReport, rawValue: unknown, componentStack?: string): void => {
      if (reportRef.current !== null) return;
      reportRef.current = report;
      logFatalError(report, rawValue, componentStack);
      setFatalReport(report);
    },
    [],
  );

  useEffect(() => {
    const onError = (event: Event): void => {
      if (reportRef.current !== null) return;
      if (!(event instanceof ErrorEvent) || event.error == null) return;
      event.preventDefault();
      const report = buildFatalErrorReport(event, "error");
      reportFatal(report, event);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      if (reportRef.current !== null) return;
      event.preventDefault();
      const report = buildFatalErrorReport(event, "unhandledrejection");
      reportFatal(report, event);
    };

    window.addEventListener("error", onError as EventListener);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError as EventListener);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [reportFatal]);

  const handleRetry = useCallback(() => {
    reportRef.current = null;
    setFatalReport(null);
    setResetKey((k) => k + 1);
  }, []);

  const handleNavigateToKanban = useCallback(() => {
    window.location.replace("/kanban");
  }, []);

  if (fatalReport) {
    return (
      <FatalErrorPage
        report={fatalReport}
        onRetry={handleRetry}
        onNavigateToKanban={handleNavigateToKanban}
      />
    );
  }

  return (
    <AppErrorBoundary key={resetKey} onCrash={reportFatal}>
      {children}
    </AppErrorBoundary>
  );
}
