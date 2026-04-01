import { type ReactElement, useState } from "react";
import type { FatalErrorReport } from "./fatal-error-report";

const SOURCE_LABELS: Record<FatalErrorReport["source"], string> = {
  boundary: "React render error",
  error: "Uncaught runtime error",
  unhandledrejection: "Unhandled promise rejection",
};

interface FatalErrorPageProps {
  report: FatalErrorReport;
  onRetry: () => void;
  onNavigateToKanban: () => void;
}

export function FatalErrorPage({
  report,
  onRetry,
  onNavigateToKanban,
}: FatalErrorPageProps): ReactElement {
  const [showDetails, setShowDetails] = useState(false);
  const detailSections = getDetailSections(report);

  return (
    <div role="alert" className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-7 text-destructive"
              aria-hidden="true"
            >
              <circle cx={12} cy={12} r={10} />
              <line x1={12} y1={8} x2={12} y2={12} />
              <line x1={12} y1={16} x2={12.01} y2={16} />
            </svg>
          </div>

          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An unexpected error caused the application to crash. You can try reloading — your data
            is safe.
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive-muted shadow-sm">
          <p
            className="font-medium text-destructive-surface-foreground"
            data-testid="fatal-error-title"
          >
            {report.title}
          </p>
          <p className="mt-1" data-testid="fatal-error-message">
            {report.message}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-destructive-muted">
            <span>{SOURCE_LABELS[report.source]}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={report.timestamp}>{formatTimestamp(report.timestamp)}</time>
          </div>
        </div>

        {detailSections.length > 0 && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              data-testid="fatal-error-toggle-details"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <div
                className="mt-2 space-y-3 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
                data-testid="fatal-error-details"
              >
                {detailSections.map((section) => (
                  <div key={section.label} className="space-y-1">
                    <p className="font-medium text-foreground">{section.label}</p>
                    {section.kind === "pre" ? (
                      <pre
                        className="overflow-auto whitespace-pre-wrap"
                        data-testid={section.testId}
                      >
                        {section.value}
                      </pre>
                    ) : (
                      <p className="break-all" data-testid={section.testId}>
                        {section.value}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onNavigateToKanban}
            className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            data-testid="fatal-error-go-kanban"
          >
            Go to Kanban
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            data-testid="fatal-error-retry"
          >
            Reload app
          </button>
        </div>
      </div>
    </div>
  );
}

function getDetailSections(report: FatalErrorReport): Array<{
  kind: "pre" | "text";
  label: string;
  value: string;
  testId: string;
}> {
  const sections: Array<{ kind: "pre" | "text"; label: string; value: string; testId: string }> =
    [];

  if (hasMeaningfulStack(report.stack)) {
    sections.push({
      kind: "pre",
      label: "JavaScript stack",
      value: report.stack,
      testId: "fatal-error-stack",
    });
  }

  if (report.componentStack) {
    sections.push({
      kind: "pre",
      label: "React component stack",
      value: report.componentStack,
      testId: "fatal-error-component-stack",
    });
  }

  if (report.location) {
    sections.push({
      kind: "text",
      label: "Location",
      value: report.location,
      testId: "fatal-error-location",
    });
  }

  return sections;
}

function hasMeaningfulStack(stack: string | undefined): stack is string {
  if (!stack) {
    return false;
  }

  const normalized = stack.replace(/\s+/g, "");
  return normalized !== "" && !/^@+$/.test(normalized);
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
