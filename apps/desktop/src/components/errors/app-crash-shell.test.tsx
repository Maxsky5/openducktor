import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppCrashShell } from "./app-crash-shell";

if (typeof globalThis.PromiseRejectionEvent === "undefined") {
  (globalThis as Record<string, unknown>).PromiseRejectionEvent =
    class PromiseRejectionEvent extends Event {
      readonly reason: unknown;
      readonly promise: Promise<unknown>;
      constructor(type: string, init: { reason?: unknown; promise: Promise<unknown> }) {
        super(type);
        this.reason = init.reason;
        this.promise = init.promise;
      }
    };
}

const originalConsoleError = console.error;
let consoleErrorMock: ReturnType<typeof mock>;

beforeEach(() => {
  consoleErrorMock = mock(() => {});
  console.error = consoleErrorMock as unknown as typeof console.error;
});

afterEach(() => {
  console.error = originalConsoleError;
});

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) {
    throw new Error("Test render explosion");
  }
  return <div data-testid="healthy-app">App is running</div>;
}

describe("AppCrashShell", () => {
  describe("normal operation", () => {
    test("renders children when no error occurs", () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      expect(screen.getByTestId("healthy-app")).toBeDefined();
    });
  });

  describe("React error boundary", () => {
    test("shows fatal error page when child throws during render", async () => {
      render(
        <AppCrashShell>
          <ThrowingChild shouldThrow={true} />
        </AppCrashShell>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(screen.getByTestId("fatal-error-title").textContent).toBe("Error");
      expect(screen.getByTestId("fatal-error-message").textContent).toBe("Test render explosion");
      expect(screen.getByTestId("fatal-error-retry")).toBeDefined();
      expect(screen.getByTestId("fatal-error-go-kanban")).toBeDefined();
    });

    test("retry button remounts children with fresh error boundary", async () => {
      let shouldThrow = true;

      function ControlledThrower(): React.ReactElement {
        if (shouldThrow) {
          throw new Error("First render fails");
        }
        return <div data-testid="recovered-app">Recovered</div>;
      }

      render(
        <AppCrashShell>
          <ControlledThrower />
        </AppCrashShell>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-retry")).toBeDefined();
      });

      shouldThrow = false;
      fireEvent.click(screen.getByTestId("fatal-error-retry"));

      await waitFor(() => {
        expect(screen.getByTestId("recovered-app")).toBeDefined();
      });

      expect(screen.getByTestId("recovered-app").textContent).toBe("Recovered");
    });
  });

  describe("browser error listeners", () => {
    test("captures window error events", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      expect(screen.getByTestId("healthy-app")).toBeDefined();

      act(() => {
        const errorEvent = new ErrorEvent("error", {
          error: new TypeError("Cannot read property 'foo' of null"),
          message: "Uncaught TypeError",
        });
        window.dispatchEvent(errorEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(screen.getByTestId("fatal-error-title").textContent).toBe("TypeError");
    });

    test("captures unhandled rejection events", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        const rejectionEvent = new PromiseRejectionEvent("unhandledrejection", {
          promise: Promise.resolve(),
          reason: new Error("Unhandled async error"),
        });
        window.dispatchEvent(rejectionEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(screen.getByTestId("fatal-error-message").textContent).toBe("Unhandled async error");
    });

    test("ignores duplicate errors when already in fatal state", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        const firstError = new ErrorEvent("error", {
          error: new Error("First error"),
          message: "first",
        });
        window.dispatchEvent(firstError);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-message")).toBeDefined();
      });

      act(() => {
        const secondError = new ErrorEvent("error", {
          error: new Error("Second error should be ignored"),
          message: "second",
        });
        window.dispatchEvent(secondError);
      });

      expect(screen.getByTestId("fatal-error-message").textContent).toBe("First error");
    });
  });

  describe("fatal error page UI", () => {
    test("shows stack trace toggle when stack is present", async () => {
      render(
        <AppCrashShell>
          <ThrowingChild shouldThrow={true} />
        </AppCrashShell>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-toggle-details")).toBeDefined();
      });

      expect(screen.queryByTestId("fatal-error-stack")).toBeNull();

      fireEvent.click(screen.getByTestId("fatal-error-toggle-details"));

      expect(screen.getByTestId("fatal-error-stack")).toBeDefined();
      expect(screen.getByTestId("fatal-error-stack").textContent).toContain(
        "Test render explosion",
      );
    });

    test("go to kanban navigates via location.replace", async () => {
      const originalReplace = window.location.replace;
      const replaceMock = mock(() => {});
      Object.defineProperty(window.location, "replace", {
        value: replaceMock,
        writable: true,
        configurable: true,
      });

      try {
        render(
          <AppCrashShell>
            <ThrowingChild shouldThrow={true} />
          </AppCrashShell>,
        );

        await waitFor(() => {
          expect(screen.getByTestId("fatal-error-go-kanban")).toBeDefined();
        });

        fireEvent.click(screen.getByTestId("fatal-error-go-kanban"));

        expect(replaceMock).toHaveBeenCalledWith("/kanban");
      } finally {
        Object.defineProperty(window.location, "replace", {
          value: originalReplace,
          writable: true,
          configurable: true,
        });
      }
    });
  });
});
