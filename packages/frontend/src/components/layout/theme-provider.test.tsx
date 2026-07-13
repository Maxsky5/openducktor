import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type ReactElement } from "react";
import { hostBridge } from "@/lib/host-client";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { ThemeProvider, useTheme } from "./theme-provider";

enableReactActEnvironment();

const ThemeHarness = (): ReactElement => {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <output aria-label="Current theme">{theme}</output>
      <button type="button" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        Light
      </button>
    </div>
  );
};

const renderThemeProvider = ({ withSettingsSnapshot = true } = {}) => {
  const queryClient = createQueryClient();
  if (withSettingsSnapshot) {
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture({ theme: "light" }),
    );
  } else {
    queryClient.setQueryDefaults(settingsSnapshotQueryOptions().queryKey, { enabled: false });
  }

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return queryClient;
};

const selectThemesRapidly = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  fireEvent.click(screen.getByRole("button", { name: "Light" }));
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
};

const flushQueryUpdates = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light", "dark");
});

describe("ThemeProvider", () => {
  test("updates the controlled theme before the settings snapshot is available", async () => {
    const setTheme = mock(async () => undefined);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;

    try {
      renderThemeProvider({ withSettingsSnapshot: false });

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));

      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("keeps only one theme persistence request in flight during rapid changes", async () => {
    const persistence = createDeferred<void>();
    const setTheme = mock(async () => persistence.promise);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;

    try {
      renderThemeProvider();

      await act(async () => {
        selectThemesRapidly();
        await Promise.resolve();
      });

      expect(setTheme).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });

      await act(async () => {
        persistence.resolve(undefined);
        await persistence.promise;
        await flushQueryUpdates();
      });

      expect(setTheme).toHaveBeenCalledTimes(1);
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("keeps the newest theme when a superseded persistence request fails", async () => {
    const persistenceRequests: ReturnType<typeof createDeferred<void>>[] = [];
    const setTheme = mock(async () => {
      const persistence = createDeferred<void>();
      persistenceRequests.push(persistence);
      return persistence.promise;
    });
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      renderThemeProvider();

      await act(async () => {
        selectThemesRapidly();
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });

      await act(async () => {
        persistenceRequests[0]?.reject(new Error("disk write failed"));
        await Promise.resolve();
      });

      await act(async () => {
        for (const persistence of persistenceRequests.slice(1)) {
          persistence.resolve(undefined);
        }
        await Promise.all(persistenceRequests.slice(1).map(({ promise }) => promise));
        await flushQueryUpdates();
      });

      expect(screen.getByLabelText("Current theme").textContent).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    } finally {
      consoleError.mockRestore();
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("rolls back to the persisted theme when the newest request fails", async () => {
    const persistence = createDeferred<void>();
    const setTheme = mock(async () => persistence.promise);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      renderThemeProvider();

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));
      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });

      await act(async () => {
        persistence.reject(new Error("disk write failed"));
        await Promise.resolve();
      });

      await waitFor(
        () => expect(screen.getByLabelText("Current theme").textContent).toBe("light"),
        { timeout: 1_000 },
      );
      expect(document.documentElement.classList.contains("light")).toBe(true);
    } finally {
      consoleError.mockRestore();
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("accepts the loaded persisted theme after a pre-load request fails", async () => {
    const persistence = createDeferred<void>();
    const setTheme = mock(async () => persistence.promise);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const queryClient = renderThemeProvider({ withSettingsSnapshot: false });

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));
      await act(async () => {
        persistence.reject(new Error("disk write failed"));
        await Promise.resolve();
      });

      act(() => {
        queryClient.setQueryData(
          settingsSnapshotQueryOptions().queryKey,
          createSettingsSnapshotFixture({ theme: "dark" }),
        );
      });

      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });
    } finally {
      consoleError.mockRestore();
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("reconciles an authoritative settings snapshot after persistence succeeds", async () => {
    const setTheme = mock(async () => undefined);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;

    try {
      const queryClient = renderThemeProvider();

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));
      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });

      act(() => {
        queryClient.setQueryData(
          settingsSnapshotQueryOptions().queryKey,
          createSettingsSnapshotFixture({ theme: "light" }),
        );
      });

      await waitFor(
        () => expect(screen.getByLabelText("Current theme").textContent).toBe("light"),
        { timeout: 1_000 },
      );
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });
});
