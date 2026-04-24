import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { FatalErrorPage } from "./fatal-error-page";
import type { FatalErrorReport } from "./fatal-error-report";

const noop = (): void => {};

function createReport(overrides: Partial<FatalErrorReport> = {}): FatalErrorReport {
  return {
    title: "Error",
    message: "Something failed",
    stack: undefined,
    source: "error",
    timestamp: "2026-04-01T17:00:00.000Z",
    ...overrides,
  };
}

describe("FatalErrorPage", () => {
  test("shows JavaScript stack details when the stack is meaningful", () => {
    render(
      <FatalErrorPage
        report={createReport({ stack: "Error: boom\n    at renderApp (src/main.tsx:42:7)" })}
        onRetry={noop}
        onNavigateToKanban={noop}
      />,
    );

    fireEvent.click(screen.getByTestId("fatal-error-toggle-details"));

    expect(screen.getByTestId("fatal-error-stack").textContent).toContain("renderApp");
    expect(screen.queryByTestId("fatal-error-location")).toBeNull();
  });

  test("falls back to source location when the stack is low-value", () => {
    render(
      <FatalErrorPage
        report={createReport({ stack: "@", location: "http://localhost:1420/src/main.tsx:42:7" })}
        onRetry={noop}
        onNavigateToKanban={noop}
      />,
    );

    fireEvent.click(screen.getByTestId("fatal-error-toggle-details"));

    expect(screen.queryByTestId("fatal-error-stack")).toBeNull();
    expect(screen.getByTestId("fatal-error-location").textContent).toBe(
      "http://localhost:1420/src/main.tsx:42:7",
    );
  });

  test("shows React component stack when available", () => {
    render(
      <FatalErrorPage
        report={createReport({ componentStack: "\n    at BrokenPanel\n    at App" })}
        onRetry={noop}
        onNavigateToKanban={noop}
      />,
    );

    fireEvent.click(screen.getByTestId("fatal-error-toggle-details"));

    expect(screen.getByTestId("fatal-error-component-stack").textContent).toContain("BrokenPanel");
  });
});
