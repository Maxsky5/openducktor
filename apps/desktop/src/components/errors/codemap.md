# apps/desktop/src/components/errors/

## Responsibility
Crash and fatal-error handling for the desktop UI.

## Design Patterns
`AppCrashShell` wraps the app in an error boundary, captures thrown/unhandled errors, and swaps to a fatal error page/report view.

## Data & Control Flow
Errors bubble into `AppErrorBoundary` or global window handlers, get turned into a fatal report, and drive the fallback screen until the user retries.

## Integration Points
`app-crash-shell.tsx`, `app-error-boundary.tsx`, `fatal-error-page.tsx`, and `fatal-error-report.ts`.
