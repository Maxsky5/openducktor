import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppearanceSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { hostBridge } from "@/lib/host-client";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "@/state/operations/host";
import { SettingsAppearanceSection } from "./settings-appearance-section";

enableReactActEnvironment();
const originalList = host.systemListOpenInTools;
beforeEach(() => {
  host.systemListOpenInTools = async () => [{ toolId: "finder" }];
});

function TestProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider useIsolatedClient>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryProvider>
  );
}

const createAppearanceSettings = (
  overrides: Partial<AppearanceSettings> = {},
): AppearanceSettings => ({
  horizontalScrollbarVisibility: "system",
  ...overrides,
});

const renderAppearanceSection = (appearance: AppearanceSettings, disabled = false): void => {
  let latestAppearance = appearance;
  const onUpdateAppearance = mock(
    (updater: (current: AppearanceSettings) => AppearanceSettings): void => {
      latestAppearance = updater(latestAppearance);
    },
  );

  render(
    <SettingsAppearanceSection
      appearance={latestAppearance}
      system={{}}
      onUpdateSystem={() => {}}
      disabled={disabled}
      onUpdateAppearance={onUpdateAppearance}
    />,
    { wrapper: TestProvider },
  );
};

const renderAppearanceSectionWithUpdates = (appearance: AppearanceSettings) => {
  let latestAppearance = appearance;
  const onUpdateAppearance = mock(
    (updater: (current: AppearanceSettings) => AppearanceSettings): void => {
      latestAppearance = updater(latestAppearance);
    },
  );

  const rendered = render(
    <SettingsAppearanceSection
      appearance={latestAppearance}
      system={{}}
      onUpdateSystem={() => {}}
      disabled={false}
      onUpdateAppearance={onUpdateAppearance}
    />,
    { wrapper: TestProvider },
  );

  return {
    onUpdateAppearance,
    getLatestAppearance: () => latestAppearance,
    rerenderLatest: () => {
      rendered.rerender(
        <SettingsAppearanceSection
          appearance={latestAppearance}
          system={{}}
          onUpdateSystem={() => {}}
          disabled={false}
          onUpdateAppearance={onUpdateAppearance}
        />,
      );
    },
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
    fireEvent.click(screen.getByRole("button", { name: "Horizontal Scrollbars" }));
  });

  const matchingLabels = await screen.findAllByText(labelByValue[value]);
  await act(async () => {
    const optionLabel = matchingLabels.at(-1);
    if (!optionLabel) {
      throw new Error(`Expected ${labelByValue[value]} option to be rendered`);
    }
    fireEvent.click(optionLabel);
  });
};

afterEach(() => {
  cleanup();
  host.systemListOpenInTools = originalList;
});

describe("settings appearance section", () => {
  test("offers the three theme choices and persists a selection at once", async () => {
    const setTheme = mock(async () => undefined);
    const originalSetTheme = hostBridge.client.setTheme;
    hostBridge.client.setTheme = setTheme;

    try {
      renderAppearanceSection(createAppearanceSettings());

      const themeTrigger = screen.getByRole("button", { name: "Theme" });
      expect(
        screen.getByText(
          "System default follows the current operating system appearance. Light and Dark keep the chosen appearance on every system.",
        ),
      ).toBeDefined();

      await act(async () => {
        fireEvent.click(themeTrigger);
      });

      await screen.findByText("Dark");
      expect(screen.getAllByText("System default").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Light").length).toBeGreaterThanOrEqual(1);

      const themeOptions = document.querySelectorAll("[data-slot='command-item']");
      expect([...themeOptions].map((option) => option.textContent)).toEqual([
        "System default",
        "Light",
        "Dark",
      ]);
      expect(document.querySelector("[data-slot='command-input']:not(.sr-only)")).toBeNull();
      expect(screen.queryByPlaceholderText("Search theme...")).toBeNull();

      await act(async () => {
        const options = screen.getAllByText("Dark");
        const option = options.at(-1);
        if (!option) {
          throw new Error("Expected the Dark theme option to be rendered");
        }
        fireEvent.click(option);
      });

      expect(setTheme).toHaveBeenCalledWith("dark");
    } finally {
      hostBridge.client.setTheme = originalSetTheme;
    }
  });

  test("disables the theme picker while settings interactions are disabled", () => {
    renderAppearanceSection(createAppearanceSettings(), true);

    expect(screen.getByRole("button", { name: "Theme" }).hasAttribute("disabled")).toBe(true);
  });

  test("renders horizontal scrollbar visibility choices", async () => {
    renderAppearanceSection(createAppearanceSettings());

    expect(screen.getByText("Appearance")).toBeDefined();
    expect(screen.getByText("Horizontal Scrollbars")).toBeDefined();
    expect(screen.getByRole("button", { name: "Horizontal Scrollbars" }).textContent).toContain(
      "System default",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Horizontal Scrollbars" }));
    });

    await screen.findByText("Show");

    expect(screen.getAllByText("System default").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Show")).toBeDefined();
    expect(screen.getByText("Hide")).toBeDefined();
    expect(
      screen.getByText(
        "System default shows horizontal scrollbars on Windows and Linux, and hides them on macOS. Choose Show or Hide to override it on every platform.",
      ),
    ).toBeDefined();
  });

  test("selects the saved visibility mode", () => {
    renderAppearanceSection(createAppearanceSettings({ horizontalScrollbarVisibility: "show" }));

    expect(screen.getByRole("button", { name: "Horizontal Scrollbars" }).textContent).toContain(
      "Show",
    );
  });

  test("disables the select while settings interactions are disabled", () => {
    renderAppearanceSection(createAppearanceSettings(), true);

    expect(
      screen.getByRole("button", { name: "Horizontal Scrollbars" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("updates the horizontal scrollbar mode without dropping unrelated appearance settings", async () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance, rerenderLatest } =
      renderAppearanceSectionWithUpdates(appearance);

    await changeHorizontalScrollbarVisibility("show");
    rerenderLatest();
    await changeHorizontalScrollbarVisibility("hide");
    rerenderLatest();
    await changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).toHaveBeenCalledTimes(3);
    expect(getLatestAppearance()).toEqual({
      horizontalScrollbarVisibility: "system",
    });
  });

  test("does not update when clicking the already active option", async () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance } =
      renderAppearanceSectionWithUpdates(appearance);

    await changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).not.toHaveBeenCalled();
    expect(getLatestAppearance()).toEqual(appearance);
  });
});
