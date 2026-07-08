import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AppearanceSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsAppearanceSection } from "./settings-appearance-section";

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
      disabled={disabled}
      onUpdateAppearance={onUpdateAppearance}
    />,
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
      disabled={false}
      onUpdateAppearance={onUpdateAppearance}
    />,
  );

  return {
    onUpdateAppearance,
    getLatestAppearance: () => latestAppearance,
    rerenderLatest: () => {
      rendered.rerender(
        <SettingsAppearanceSection
          appearance={latestAppearance}
          disabled={false}
          onUpdateAppearance={onUpdateAppearance}
        />,
      );
    },
  };
};

const changeHorizontalScrollbarVisibility = (
  value: AppearanceSettings["horizontalScrollbarVisibility"],
): void => {
  fireEvent.change(screen.getByLabelText("Horizontal Scrollbars"), {
    target: { value },
  });
};

afterEach(() => {
  cleanup();
});

describe("settings appearance section", () => {
  test("renders horizontal scrollbar visibility choices", () => {
    renderAppearanceSection(createAppearanceSettings());

    expect(screen.getByText("Appearance")).toBeDefined();
    expect(screen.getByText("Horizontal Scrollbars")).toBeDefined();
    expect(
      within(screen.getByLabelText("Horizontal Scrollbars"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["System default", "Show", "Hide"]);
    expect(
      screen.getByText(
        "System default shows horizontal scrollbars on Windows and Linux, and hides them on macOS. Choose Show or Hide to override it on every platform.",
      ),
    ).toBeDefined();
  });

  test("selects the saved visibility mode", () => {
    renderAppearanceSection(createAppearanceSettings({ horizontalScrollbarVisibility: "show" }));

    expect((screen.getByLabelText("Horizontal Scrollbars") as HTMLSelectElement).value).toBe(
      "show",
    );
  });

  test("disables the select while settings interactions are disabled", () => {
    renderAppearanceSection(createAppearanceSettings(), true);

    expect(screen.getByLabelText("Horizontal Scrollbars").hasAttribute("disabled")).toBe(true);
  });

  test("updates the horizontal scrollbar mode without dropping unrelated appearance settings", () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance, rerenderLatest } =
      renderAppearanceSectionWithUpdates(appearance);

    changeHorizontalScrollbarVisibility("show");
    rerenderLatest();
    changeHorizontalScrollbarVisibility("hide");
    rerenderLatest();
    changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).toHaveBeenCalledTimes(3);
    expect(getLatestAppearance()).toEqual({
      horizontalScrollbarVisibility: "system",
    });
  });

  test("does not update when clicking the already active option", () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance } =
      renderAppearanceSectionWithUpdates(appearance);

    changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).not.toHaveBeenCalled();
    expect(getLatestAppearance()).toEqual(appearance);
  });
});
