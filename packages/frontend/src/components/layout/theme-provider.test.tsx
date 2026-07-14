import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SettingsSnapshot, Theme } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type ReactElement, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { hostBridge } from "@/lib/host-client";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { ThemeToggle } from "./sidebar/theme-toggle";
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
      <ThemeToggle />
    </div>
  );
};

const ThemeProviderQueryHarness = ({
  onQueryClient,
  withSettingsSnapshot,
}: {
  onQueryClient: (queryClient: QueryClient) => void;
  withSettingsSnapshot: boolean;
}): ReactElement | null => {
  const queryClient = useQueryClient();
  const [isInitialized, setIsInitialized] = useState(false);

  useLayoutEffect(() => {
    if (withSettingsSnapshot) {
      queryClient.setQueryData(
        settingsSnapshotQueryOptions().queryKey,
        createSettingsSnapshotFixture({ theme: "light" }),
      );
    } else {
      queryClient.setQueryDefaults(settingsSnapshotQueryOptions().queryKey, { enabled: false });
    }
    onQueryClient(queryClient);
    setIsInitialized(true);
  }, [onQueryClient, queryClient, withSettingsSnapshot]);

  if (!isInitialized) {
    return null;
  }

  return (
    <ThemeProvider>
      <ThemeHarness />
    </ThemeProvider>
  );
};

const renderThemeProvider = ({ withSettingsSnapshot = true } = {}) => {
  const queryClientRef: { current: QueryClient | null } = { current: null };

  render(
    <QueryProvider useIsolatedClient>
      <ThemeProviderQueryHarness
        onQueryClient={(client) => {
          queryClientRef.current = client;
        }}
        withSettingsSnapshot={withSettingsSnapshot}
      />
    </QueryProvider>,
  );

  if (queryClientRef.current === null) {
    throw new Error("Query client was not initialized");
  }
  return queryClientRef.current;
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

const expectThemeState = (theme: Theme): void => {
  expect(screen.getByLabelText("Current theme").textContent).toBe(theme);
  expect(document.documentElement.classList.contains(theme)).toBe(true);
  expect(
    screen.getByRole("switch", { name: "Toggle dark mode" }).getAttribute("aria-checked"),
  ).toBe(String(theme === "dark"));
};

const expectCachedTheme = (queryClient: QueryClient, theme: Theme): void => {
  expect(
    queryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryOptions().queryKey)?.theme,
  ).toBe(theme);
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
      expectThemeState("light");

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));

      await waitFor(() => expectThemeState("dark"), { timeout: 1_000 });
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("skips persistence when the selected theme is already authoritative", () => {
    const setTheme = mock(async () => undefined);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;

    try {
      renderThemeProvider();

      fireEvent.click(screen.getByRole("button", { name: "Light" }));

      expect(setTheme).not.toHaveBeenCalled();
      expectThemeState("light");
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("keeps the settings snapshot cache aligned while persistence is in flight", async () => {
    const persistence = createDeferred<void>();
    const setTheme = mock(async () => persistence.promise);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;

    try {
      const queryClient = renderThemeProvider();

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));

      expectCachedTheme(queryClient, "dark");
      expectThemeState("dark");

      await act(async () => {
        persistence.resolve(undefined);
        await persistence.promise;
        await flushQueryUpdates();
      });
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
      await waitFor(() => expectThemeState("dark"), { timeout: 1_000 });

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
    const toastError = spyOn(toast, "error").mockImplementation(() => "toast-id");

    try {
      const queryClient = renderThemeProvider();

      await act(async () => {
        selectThemesRapidly();
        await Promise.resolve();
      });
      expect(setTheme).toHaveBeenCalledTimes(1);
      await waitFor(() => expectThemeState("dark"), { timeout: 1_000 });

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

      expect(setTheme).toHaveBeenCalledTimes(2);
      expect(
        toastError.mock.calls.filter(([message]) => message === "Theme change failed"),
      ).toHaveLength(0);
      expectCachedTheme(queryClient, "dark");
      expectThemeState("dark");
    } finally {
      toastError.mockRestore();
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
    const toastError = spyOn(toast, "error").mockImplementation(() => "toast-id");

    try {
      const queryClient = renderThemeProvider();

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));
      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });

      await act(async () => {
        persistence.reject(new Error("disk write failed"));
        await Promise.resolve();
      });

      await waitFor(() => expectThemeState("light"), { timeout: 1_000 });
      expectCachedTheme(queryClient, "light");
      expect(toastError).toHaveBeenCalledWith("Theme change failed", {
        description: "disk write failed",
      });
    } finally {
      toastError.mockRestore();
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

      await waitFor(() => expectThemeState("dark"), { timeout: 1_000 });
    } finally {
      consoleError.mockRestore();
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("keeps an authoritative theme that loads before a pending request fails", async () => {
    const persistence = createDeferred<void>();
    const setTheme = mock(async () => persistence.promise);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const queryClient = renderThemeProvider({ withSettingsSnapshot: false });

      fireEvent.click(screen.getByRole("button", { name: "Dark" }));
      await waitFor(() => expect(screen.getByLabelText("Current theme").textContent).toBe("dark"), {
        timeout: 1_000,
      });

      await act(async () => {
        queryClient.setQueryData(
          settingsSnapshotQueryOptions().queryKey,
          createSettingsSnapshotFixture({ theme: "dark" }),
        );
        await flushQueryUpdates();
      });

      await act(async () => {
        persistence.reject(new Error("disk write failed"));
        await flushQueryUpdates();
      });

      expectThemeState("dark");
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

      await waitFor(() => expectThemeState("light"), { timeout: 1_000 });
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });
});
