import { Component, type ErrorInfo, type ReactNode } from "react";
import { buildFatalErrorReport, type FatalErrorReport, logFatalError } from "./fatal-error-report";

interface Props {
  children: ReactNode;
  onCrash: (report: FatalErrorReport) => void;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = buildFatalErrorReport(error, "boundary");
    if (info.componentStack) {
      report.componentStack = info.componentStack;
    }
    logFatalError(report, error, info.componentStack ?? undefined);
    this.props.onCrash(report);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
