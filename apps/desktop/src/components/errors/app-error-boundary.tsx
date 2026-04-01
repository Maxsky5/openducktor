import { Component, type ErrorInfo, type ReactNode } from "react";
import { buildFatalErrorReport, type FatalErrorReport } from "./fatal-error-report";

interface Props {
  children: ReactNode;
  onCrash: (report: FatalErrorReport, error: unknown, componentStack?: string) => void;
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
    this.props.onCrash(report, error, info.componentStack ?? undefined);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
