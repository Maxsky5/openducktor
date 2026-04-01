import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { lazy, Suspense } from "react";
import { ensurePromiseRejectionEventPolyfill } from "@/test-utils/promise-rejection-event-polyfill";
import { AppCrashShell } from "./app-crash-shell";

ensurePromiseRejectionEventPolyfill();

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

    test("captures ErrorEvent with a falsy thrown payload", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        const errorEvent = new ErrorEvent("error", {
          error: 0,
          message: "",
        });
        window.dispatchEvent(errorEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(screen.getByTestId("fatal-error-title").textContent).toBe("Uncaught error");
      expect(screen.getByTestId("fatal-error-message").textContent).toBe("0");
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

    test("prevents default handling for fatal browser error events", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      const errorEvent = new ErrorEvent("error", {
        cancelable: true,
        error: new Error("prevent default"),
        message: "Uncaught Error",
      });

      act(() => {
        window.dispatchEvent(errorEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(errorEvent.defaultPrevented).toBe(true);
    });

    test("prevents default handling for fatal unhandled rejection events", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      const rejectionEvent = new PromiseRejectionEvent("unhandledrejection", {
        cancelable: true,
        promise: Promise.resolve(),
        reason: new Error("prevent duplicate rejection logging"),
      });

      act(() => {
        window.dispatchEvent(rejectionEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(rejectionEvent.defaultPrevented).toBe(true);
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

    test("keeps the first fatal report when multiple errors fire in the same tick", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        window.dispatchEvent(
          new ErrorEvent("error", {
            error: new Error("First same-tick error"),
            message: "first",
          }),
        );
        window.dispatchEvent(
          new ErrorEvent("error", {
            error: new Error("Second same-tick error"),
            message: "second",
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-message")).toBeDefined();
      });

      expect(screen.getByTestId("fatal-error-message").textContent).toBe("First same-tick error");
    });

    test("captures a new fatal event immediately after retry clears the shell", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        window.dispatchEvent(
          new ErrorEvent("error", {
            error: new Error("First fatal event"),
            message: "first",
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-retry")).toBeDefined();
      });

      act(() => {
        fireEvent.click(screen.getByTestId("fatal-error-retry"));
        window.dispatchEvent(
          new ErrorEvent("error", {
            error: new Error("Second fatal event"),
            message: "second",
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-message").textContent).toBe("Second fatal event");
      });
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

  describe("lazy-load failure", () => {
    test("shows fatal error page when a lazy module fails to load", async () => {
      const LazyBroken = lazy(() =>
        Promise.reject(new Error("Failed to fetch dynamically imported module")),
      );

      render(
        <AppCrashShell>
          <Suspense fallback={<div data-testid="loading">Loading...</div>}>
            <LazyBroken />
          </Suspense>
        </AppCrashShell>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      expect(screen.getByTestId("fatal-error-message").textContent).toBe(
        "Failed to fetch dynamically imported module",
      );
      expect(screen.getByTestId("fatal-error-retry")).toBeDefined();
    });
  });

  describe("error listener narrowing", () => {
    test("ignores plain Event (resource load error) dispatched on window", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      expect(screen.getByTestId("healthy-app")).toBeDefined();

      act(() => {
        const resourceError = new Event("error");
        window.dispatchEvent(resourceError);
      });

      expect(screen.getByTestId("healthy-app")).toBeDefined();
      expect(screen.queryByTestId("fatal-error-title")).toBeNull();
    });

    test("ignores ErrorEvent without an error object (cross-origin script error)", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        const crossOriginError = new ErrorEvent("error", {
          message: "Script error.",
        });
        window.dispatchEvent(crossOriginError);
      });

      expect(screen.getByTestId("healthy-app")).toBeDefined();
      expect(screen.queryByTestId("fatal-error-title")).toBeNull();
    });
  });

  describe("listener lifecycle", () => {
    test("removes listeners on unmount", () => {
      const originalRemoveEventListener = window.removeEventListener;
      const removedListeners: string[] = [];
      const removeListenerSpy = mock((type: string, ...args: unknown[]) => {
        removedListeners.push(type);
        return originalRemoveEventListener.call(
          window,
          type,
          ...(args as [EventListenerOrEventListenerObject]),
        );
      });
      window.removeEventListener =
        removeListenerSpy as unknown as typeof window.removeEventListener;

      try {
        const { unmount } = render(
          <AppCrashShell>
            <div>App</div>
          </AppCrashShell>,
        );

        unmount();

        expect(removedListeners).toContain("error");
        expect(removedListeners).toContain("unhandledrejection");
      } finally {
        window.removeEventListener = originalRemoveEventListener;
      }
    });

    test("does not re-register listeners on rerender", () => {
      const originalAddEventListener = window.addEventListener;
      let addCount = 0;
      const addListenerSpy = mock((type: string, ...args: unknown[]) => {
        if (type === "error" || type === "unhandledrejection") {
          addCount++;
        }
        return originalAddEventListener.call(
          window,
          type,
          ...(args as [EventListenerOrEventListenerObject]),
        );
      });
      window.addEventListener = addListenerSpy as unknown as typeof window.addEventListener;

      try {
        const { rerender } = render(
          <AppCrashShell>
            <div>First render</div>
          </AppCrashShell>,
        );

        const countAfterMount = addCount;

        rerender(
          <AppCrashShell>
            <div>Second render</div>
          </AppCrashShell>,
        );

        rerender(
          <AppCrashShell>
            <div>Third render</div>
          </AppCrashShell>,
        );

        expect(addCount).toBe(countAfterMount);
      } finally {
        window.addEventListener = originalAddEventListener;
      }
    });
  });

  describe("structured logging", () => {
    function findStructuredLogCall(
      errorMock: ReturnType<typeof mock>,
      sourceFilter: string,
    ): unknown[] {
      const calls = errorMock.mock.calls as unknown[][];
      const match = calls.find(
        (args) => typeof args[0] === "string" && args[0].includes(sourceFilter),
      );
      if (!match) throw new Error(`No console.error call matching "${sourceFilter}"`);
      return match;
    }

    test("logs structured context with raw value on boundary crash", async () => {
      render(
        <AppCrashShell>
          <ThrowingChild shouldThrow={true} />
        </AppCrashShell>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      const structuredCall = findStructuredLogCall(consoleErrorMock, "[AppCrashShell]");
      const context = structuredCall[structuredCall.length - 1] as Record<string, unknown>;
      expect(context.source).toBe("boundary");
      expect(context.rawValue).toBeInstanceOf(Error);
      expect(context.timestamp).toBeDefined();
    });

    test("logs structured context with raw event on browser error", async () => {
      render(
        <AppCrashShell>
          <div data-testid="healthy-app">App is running</div>
        </AppCrashShell>,
      );

      act(() => {
        const errorEvent = new ErrorEvent("error", {
          error: new Error("async boom"),
          message: "Uncaught Error",
        });
        window.dispatchEvent(errorEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId("fatal-error-title")).toBeDefined();
      });

      const structuredCall = findStructuredLogCall(
        consoleErrorMock,
        "[AppCrashShell] Fatal error (error)",
      );
      const context = structuredCall[structuredCall.length - 1] as Record<string, unknown>;
      expect(context.source).toBe("error");
      expect(context.rawValue).toBeInstanceOf(ErrorEvent);
    });
  });
});
