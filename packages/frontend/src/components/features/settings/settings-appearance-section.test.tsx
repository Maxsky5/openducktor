import { describe, expect, mock, test } from "bun:test";
import type { AppearanceSettings, ThemePreference } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import type { HostClient } from "@openducktor/host-client";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { createSettingsSnapshotFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { SettingsAppearanceSection } from "./settings-appearance-section";

const createSettingsConnection = (client: Partial<HostClient> = {}): ClientConnection => {
  const connection = createTestClientConnection({
    client: { systemListOpenInTools: async () => [{ toolId: "finder" }], ...client },
  });
  connection.queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture({ theme: "system" }),
  );
  return connection;
};

const createTestProvider =
  (connection: ClientConnection) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryProvider connection={connection}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryProvider>
  );

const createAppearanceSettings = (
  overrides: Partial<AppearanceSettings> = {},
): AppearanceSettings => ({
  horizontalScrollbarVisibility: "system",
  sidebarSessionGrouping: "task",
  ...overrides,
});

const renderAppearanceSection = (
  appearance = createAppearanceSettings(),
  {
    disabled = false,
    connection = createSettingsConnection(),
  }: { disabled?: boolean; connection?: ClientConnection } = {},
) => {
  let latestAppearance = appearance;
  const onUpdateAppearance = mock(
    (updater: (current: AppearanceSettings) => AppearanceSettings): void => {
      latestAppearance = updater(latestAppearance);
    },
  );

  const section = () => (
    <SettingsAppearanceSection
      appearance={latestAppearance}
      system={{}}
      onUpdateSystem={() => {}}
      disabled={disabled}
      onUpdateAppearance={onUpdateAppearance}
    />
  );
  const rendered = render(section(), { wrapper: createTestProvider(connection) });

  return {
    onUpdateAppearance,
    getLatestAppearance: () => latestAppearance,
    rerenderLatest: () => rendered.rerender(section()),
  };
};

const changeHorizontalScrollbarVisibility = async (
  value: AppearanceSettings["horizontalScrollbarVisibility"],
): Promise<void> => {
  const labelByValue = {
    system: "System default",
    show: "Show",
    hide: "Hide",
  } satisfies Record<AppearanceSettings["horizontalScrollbarVisibility"], string>;

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Horizontal scrollbars" }));
  });

  await act(async () => fireEvent.click(screen.getByRole("option", { name: labelByValue[value] })));
};

describe("settings appearance section", () => {
  test("switches task grouping without changing other appearance settings", () => {
    const { getLatestAppearance, rerenderLatest } = renderAppearanceSection(
      createAppearanceSettings({ horizontalScrollbarVisibility: "hide" }),
    );
    expect(screen.getByRole("radio", { name: "By task" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Ungrouped" }));
    rerenderLatest();
    expect(screen.getByRole("radio", { name: "Ungrouped" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(getLatestAppearance()).toEqual({
      horizontalScrollbarVisibility: "hide",
      sidebarSessionGrouping: "none",
    });
    fireEvent.click(screen.getByRole("radio", { name: "By task" }));
    rerenderLatest();
    expect(getLatestAppearance().sidebarSessionGrouping).toBe("task");
  });

  test("offers the three theme choices and persists a selection at once", async () => {
    const setTheme = mock(async (_theme: ThemePreference) => {});
    const connection = createSettingsConnection({ setTheme });
    renderAppearanceSection(undefined, { connection });

    const themeTrigger = screen.getByRole("button", { name: "Theme" });
    expect(themeTrigger.textContent).toBe("System default");
    expect(
      screen.getByText(
        "System default follows the current operating system appearance. Light and Dark keep the chosen appearance on every system.",
      ),
    ).toBeDefined();

    await act(async () => {
      fireEvent.click(themeTrigger);
    });

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "System default",
      "Light",
      "Dark",
    ]);
    expect(screen.getByRole("combobox").classList.contains("sr-only")).toBe(true);

    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Dark" })));
    await act(async () => Bun.sleep(0));

    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(themeTrigger.textContent).toBe("Dark");
  });

  test("disables theme and scrollbar choices while settings interactions are disabled", () => {
    renderAppearanceSection(undefined, { disabled: true });
    expect(screen.getByRole("button", { name: "Theme" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Horizontal scrollbars" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("starts with the saved scrollbar mode and offers every visibility choice", async () => {
    renderAppearanceSection(createAppearanceSettings({ horizontalScrollbarVisibility: "show" }));

    const trigger = screen.getByRole("button", { name: "Horizontal scrollbars" });
    expect(trigger.textContent).toBe("Show");

    await act(async () => fireEvent.click(trigger));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "System default",
      "Show",
      "Hide",
    ]);
    expect(
      screen.getByText(
        "System default shows horizontal scrollbars on Windows and Linux, and hides them on macOS. Choose Show or Hide to override it on every platform.",
      ),
    ).toBeDefined();
  });

  test("updates the horizontal scrollbar mode without dropping unrelated appearance settings", async () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance, rerenderLatest } =
      renderAppearanceSection(appearance);

    await changeHorizontalScrollbarVisibility("show");
    rerenderLatest();
    await changeHorizontalScrollbarVisibility("hide");
    rerenderLatest();
    await changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).toHaveBeenCalledTimes(3);
    expect(getLatestAppearance()).toEqual({
      horizontalScrollbarVisibility: "system",
      sidebarSessionGrouping: "task",
    });
  });

  test("does not update when clicking the already active option", async () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance } = renderAppearanceSection(appearance);

    await changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).not.toHaveBeenCalled();
    expect(getLatestAppearance()).toEqual(appearance);
  });
});
