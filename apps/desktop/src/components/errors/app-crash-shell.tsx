import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppErrorBoundary } from "./app-error-boundary";
import { FatalErrorPage } from "./fatal-error-page";
import { buildFatalErrorReport, type FatalErrorReport } from "./fatal-error-report";

interface AppCrashShellProps {
  children: ReactNode;
}

export function AppCrashShell({ children }: AppCrashShellProps): ReactElement {
  const [fatalReport, setFatalReport] = useState<FatalErrorReport | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const reportRef = useRef(fatalReport);
  reportRef.current = fatalReport;

  const handleCrash = useCallback((report: FatalErrorReport) => {
    if (reportRef.current !== null) return;
    console.error("[AppCrashShell] Fatal error captured:", report.title, report.message);
    setFatalReport(report);
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      if (reportRef.current !== null) return;
      const report = buildFatalErrorReport(event, "error");
      console.error("[AppCrashShell] Browser error event:", report.title, report.message);
      setFatalReport(report);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      if (reportRef.current !== null) return;
      const report = buildFatalErrorReport(event, "unhandledrejection");
      console.error("[AppCrashShell] Unhandled rejection:", report.title, report.message);
      setFatalReport(report);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const handleRetry = useCallback(() => {
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
    <AppErrorBoundary key={resetKey} onCrash={handleCrash}>
      {children}
    </AppErrorBoundary>
  );
}
